import { randomUUID } from 'node:crypto';

import type {
  AckDocsRequest,
  AckDocsResponse,
  ApprovalPolicy,
  CompleteIntegrateRequest,
  CompletePublishRequest,
  CreateTaskRequest,
  DispatchRequest,
  ExternalRef,
  IntegrateResponse,
  NextAction,
  PublishRequest,
  ResolveDocsRequest,
  ResolveDocsResponse,
  ResolverRefs,
  ResultApplyResponse,
  StateTransitionEvent,
  Task,
  TaskState,
  TrackerLinkRequest,
  TrackerLinkResponse,
  WorkerJob,
  WorkerResult,
  WorkerStage,
  WorkerType,
} from '../types.js';

const TERMINAL_STATES = new Set<TaskState>(['completed', 'cancelled', 'failed', 'published']);
const TYPED_REF_PATTERN = /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$/;
const DEFAULT_WORKERS: Record<WorkerStage, WorkerType> = {
  plan: 'codex',
  dev: 'codex',
  acceptance: 'claude_code',
};

// Allowed state transitions based on state-machine.md
const ALLOWED_TRANSITIONS = new Map<TaskState, TaskState[]>([
  ['queued', ['queued', 'planning', 'cancelled', 'failed']],
  ['planning', ['planned', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['planned', ['developing', 'cancelled', 'failed']],
  ['developing', ['dev_completed', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['dev_completed', ['accepting', 'cancelled', 'failed']],
  ['accepting', ['accepted', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['rework_required', ['developing', 'cancelled', 'failed']],
  ['accepted', ['integrating', 'cancelled', 'failed']],
  ['integrating', ['integrated', 'blocked', 'cancelled', 'failed']],
  ['integrated', ['publish_pending_approval', 'publishing', 'cancelled', 'failed']],
  ['publish_pending_approval', ['publishing', 'cancelled', 'failed']],
  ['publishing', ['published', 'blocked', 'cancelled', 'failed']],
  ['blocked', ['planning', 'developing', 'accepting', 'integrating', 'publishing', 'cancelled', 'failed']],
]);

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function buildApprovalPolicy(stage: WorkerStage, risk: Task['risk_level']): ApprovalPolicy {
  if (stage === 'plan') {
    return { mode: 'deny', sandbox_profile: 'read_only', operator_approval_required: false };
  }

  if (risk === 'high') {
    return {
      mode: 'ask',
      operator_approval_required: true,
      sandbox_profile: 'workspace_write',
      allowed_side_effect_categories: ['network_access'],
    };
  }

  return {
    mode: 'ask',
    operator_approval_required: false,
    sandbox_profile: 'workspace_write',
  };
}

function capabilityRequirements(stage: WorkerStage): WorkerJob['capability_requirements'] {
  switch (stage) {
    case 'plan':
      return ['plan'];
    case 'dev':
      return ['edit_repo', 'run_tests', 'produces_patch'];
    case 'acceptance':
      return ['run_tests', 'produces_verdict'];
  }
}

function requestedOutputs(stage: WorkerStage): WorkerJob['requested_outputs'] {
  switch (stage) {
    case 'plan':
      return ['plan_notes', 'artifacts'];
    case 'dev':
      return ['patch', 'tests', 'artifacts'];
    case 'acceptance':
      return ['verdict', 'tests', 'artifacts'];
  }
}

export class ControlPlaneStore {
  private readonly tasks = new Map<string, Task>();
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly events = new Map<string, StateTransitionEvent[]>();

  createTask(input: CreateTaskRequest): Task {
    if (!input.objective || input.objective.trim() === '') {
      throw new Error('objective is required');
    }

    if (!input.typed_ref) {
      throw new Error('typed_ref is required');
    }

    if (!TYPED_REF_PATTERN.test(input.typed_ref)) {
      throw new Error(`typed_ref invalid format: ${input.typed_ref}`);
    }

    const timestamp = nowIso();
    const task: Task = {
      task_id: createId('task'),
      title: input.title,
      objective: input.objective,
      typed_ref: input.typed_ref,
      description: input.description,
      state: 'queued',
      risk_level: input.risk_level ?? 'medium',
      repo_ref: input.repo_ref,
      labels: input.labels ?? [],
      publish_plan: input.publish_plan,
      artifacts: [],
      external_refs: input.external_refs ?? [],
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.tasks.set(task.task_id, task);
    this.recordEvent({
      event_id: createId('evt'),
      task_id: task.task_id,
      from_state: 'queued',
      to_state: 'queued',
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: 'task created',
      occurred_at: timestamp,
    });
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getJob(jobId: string): { job?: WorkerJob; latest_result?: WorkerResult } {
    return {
      job: this.jobs.get(jobId),
      latest_result: this.results.get(jobId),
    };
  }

  listEvents(taskId: string): StateTransitionEvent[] {
    return this.events.get(taskId) ?? [];
  }

  dispatch(taskId: string, request: DispatchRequest): WorkerJob {
    const task = this.requireTask(taskId);
    const allowedStage = this.allowedDispatchStage(task.state);
    if (allowedStage !== request.target_stage) {
      throw new Error(`state ${task.state} cannot dispatch ${request.target_stage}`);
    }

    const workerType = request.worker_selection ?? DEFAULT_WORKERS[request.target_stage];
    const riskLevel = request.override_risk_level ?? task.risk_level;

    // Build context with resolver and tracker refs
    const context = {
      objective: task.objective,
      resolver_refs: task.resolver_refs ? {
        doc_refs: task.resolver_refs.doc_refs,
        chunk_refs: task.resolver_refs.chunk_refs,
        contract_refs: task.resolver_refs.contract_refs,
      } : undefined,
      tracker_refs: task.external_refs?.map(ref => ({
        kind: 'typed_ref' as const,
        value: ref.value,
      })),
    };

    const job: WorkerJob = {
      job_id: createId('job'),
      task_id: task.task_id,
      typed_ref: task.typed_ref,
      stage: request.target_stage,
      worker_type: workerType,
      workspace_ref: task.workspace_ref ?? {
        workspace_id: `ws_${task.task_id}`,
        kind: 'container',
        reusable: true,
      },
      input_prompt: this.buildPrompt(task, request.target_stage),
      repo_ref: task.repo_ref,
      capability_requirements: capabilityRequirements(request.target_stage),
      risk_level: riskLevel,
      approval_policy: buildApprovalPolicy(request.target_stage, riskLevel),
      context,
      requested_outputs: requestedOutputs(request.target_stage),
    };

    const nextState = this.stageToActiveState(request.target_stage);
    this.jobs.set(job.job_id, job);
    task.active_job_id = job.job_id;
    task.latest_job_ids = { ...(task.latest_job_ids ?? {}), [request.target_stage]: job.job_id };
    task.workspace_ref = job.workspace_ref;
    this.transitionTask(task, nextState, {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: `dispatched ${request.target_stage} job`,
      job_id: job.job_id,
    });
    return job;
  }

  applyResult(taskId: string, result: WorkerResult): ResultApplyResponse {
    const task = this.requireTask(taskId);
    if (!task.active_job_id || task.active_job_id !== result.job_id) {
      throw new Error('job_id does not match active_job_id');
    }

    // Validate typed_ref matches
    if (result.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${result.typed_ref}`);
    }

    const job = this.jobs.get(result.job_id);
    if (!job) {
      throw new Error('job not found');
    }

    this.results.set(result.job_id, result);
    const emittedEvents: StateTransitionEvent[] = [];
    task.artifacts = [
      ...(task.artifacts ?? []),
      ...result.artifacts.map((artifact) => ({ artifact_id: artifact.artifact_id, kind: artifact.kind === 'html' ? 'other' : artifact.kind })),
    ];

    // Update resolver_refs from result
    if (result.resolver_refs) {
      task.resolver_refs = {
        ...task.resolver_refs,
        ...result.resolver_refs,
      };
    }

    // Update external_refs from result
    if (result.external_refs) {
      const existingValues = new Set(task.external_refs?.map(e => e.value) ?? []);
      const newRefs = result.external_refs.filter(e => !existingValues.has(e.value));
      task.external_refs = [...(task.external_refs ?? []), ...newRefs];
    }

    // Update context_bundle_ref from result
    if (result.context_bundle_ref) {
      task.context_bundle_ref = result.context_bundle_ref;
    }

    // Update rollback_notes from result (for high-risk acceptance)
    if (result.rollback_notes) {
      task.rollback_notes = result.rollback_notes;
    }

    if (result.verdict) {
      task.last_verdict = {
        outcome: result.verdict.outcome,
        reason: result.verdict.reason,
        manual_notes: result.verdict.manual_notes,
      };
    }

    if (result.status === 'blocked') {
      task.blocked_context = {
        resume_state: this.stageToActiveState(job.stage),
        reason: result.summary ?? 'worker blocked',
        waiting_on: 'human',
      };
      emittedEvents.push(this.transitionTask(task, 'blocked', {
        actor_type: 'worker',
        actor_id: job.worker_type,
        reason: result.summary ?? 'worker blocked',
        job_id: job.job_id,
        artifact_ids: result.artifacts.map((artifact) => artifact.artifact_id),
      }));
      return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
    }

    if (result.status === 'failed') {
      emittedEvents.push(this.transitionTask(task, 'rework_required', {
        actor_type: 'worker',
        actor_id: job.worker_type,
        reason: result.summary ?? 'worker failed',
        job_id: job.job_id,
        artifact_ids: result.artifacts.map((artifact) => artifact.artifact_id),
      }));
      return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
    }

    const outcome = this.handleSucceededResult(task, job, result, emittedEvents);
    task.active_job_id = undefined;
    task.updated_at = nowIso();
    return outcome;
  }

  recordTransition(taskId: string, event: StateTransitionEvent): StateTransitionEvent {
    const task = this.requireTask(taskId);
    if (event.task_id !== taskId) {
      throw new Error('task_id mismatch');
    }
    // Validate transition is allowed
    const allowedTargets = ALLOWED_TRANSITIONS.get(task.state);
    if (!allowedTargets || !allowedTargets.includes(event.to_state)) {
      throw new Error(`transition not allowed: ${task.state} -> ${event.to_state}`);
    }
    task.state = event.to_state;
    task.updated_at = nowIso();
    this.recordEvent(event);
    return event;
  }

  integrate(taskId: string, baseSha: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'accepted') {
      throw new Error('task is not accepted');
    }
    task.repo_ref.base_sha = baseSha;
    task.integration = {
      integration_branch: `cp/integrate/${task.task_id}`,
      integration_head_sha: baseSha,
      checks_passed: false,
    };
    this.transitionTask(task, 'integrating', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: 'integrate requested',
    });
    return task;
  }

  completeIntegrate(taskId: string, request: CompleteIntegrateRequest): IntegrateResponse {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw new Error('task is not integrating');
    }

    if (!task.integration) {
      throw new Error('integration state not found');
    }

    task.integration.checks_passed = request.checks_passed;
    if (request.integration_head_sha) {
      task.integration.integration_head_sha = request.integration_head_sha;
    }
    if (request.main_updated_sha) {
      task.integration.main_updated_sha = request.main_updated_sha;
    }

    if (request.checks_passed) {
      this.transitionTask(task, 'integrated', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'integration checks passed',
      });
    } else {
      this.transitionTask(task, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'integration checks failed',
      });
      task.blocked_context = {
        resume_state: 'integrating',
        reason: 'CI checks failed',
        waiting_on: 'github',
      };
    }

    return {
      task_id: task.task_id,
      state: task.state,
      integration_branch: task.integration?.integration_branch ?? '',
      integration_head_sha: task.integration?.integration_head_sha,
    };
  }

  publish(taskId: string, request: PublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrated') {
      throw new Error('task is not integrated');
    }

    task.publish_plan = {
      ...(task.publish_plan ?? {}),
      mode: request.mode,
      idempotency_key: request.idempotency_key,
    };

    const needsApproval = request.mode === 'apply' && task.publish_plan.approval_required && !request.approval_token;
    this.transitionTask(task, needsApproval ? 'publish_pending_approval' : 'publishing', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: needsApproval ? 'publish approval required' : 'publish started',
    });
    return task;
  }

  approvePublish(taskId: string, approvalToken: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publish_pending_approval') {
      throw new Error('task is not pending approval');
    }

    // In production, validate the approval token
    // For now, any non-empty token is accepted
    if (!approvalToken) {
      throw new Error('approval_token is required');
    }

    this.transitionTask(task, 'publishing', {
      actor_type: 'human',
      actor_id: 'operator',
      reason: 'publish approved',
    });

    return task;
  }

  completePublish(taskId: string, request: CompletePublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw new Error('task is not publishing');
    }

    // Update external_refs from result
    if (request.external_refs) {
      const existingValues = new Set(task.external_refs?.map(e => e.value) ?? []);
      const newRefs = request.external_refs.filter(e => !existingValues.has(e.value));
      task.external_refs = [...(task.external_refs ?? []), ...newRefs];
    }

    // Store rollback_notes for high-risk tasks
    if (request.rollback_notes) {
      task.rollback_notes = request.rollback_notes;
    }

    this.transitionTask(task, 'published', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: 'publish completed',
    });

    task.completed_at = nowIso();
    return task;
  }

  cancel(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (TERMINAL_STATES.has(task.state)) {
      throw new Error(`task already terminal: ${task.state}`);
    }
    this.transitionTask(task, 'cancelled', {
      actor_type: 'human',
      actor_id: 'operator',
      reason: 'task cancelled',
    });
    task.completed_at = nowIso();
    return task;
  }

  resolveDocs(taskId: string, request: ResolveDocsRequest): ResolveDocsResponse {
    const task = this.requireTask(taskId);

    // Simulate resolver response - in production this would call memx-resolver
    const docRefs: string[] = [];
    const chunkRefs: string[] = [];
    const contractRefs: string[] = [];

    if (request.feature) {
      docRefs.push(`doc:feature:${request.feature}`);
      chunkRefs.push(`chunk:feature:${request.feature}:1`);
    }
    if (request.topic) {
      docRefs.push(`doc:topic:${request.topic}`);
    }
    if (request.task_seed) {
      docRefs.push(`doc:task:${request.task_seed}`);
    }

    // Default docs if no specific request
    if (docRefs.length === 0) {
      docRefs.push('doc:workflow-cookbook:blueprint');
    }

    const resolverRefs: ResolverRefs = {
      doc_refs: docRefs,
      chunk_refs: chunkRefs,
      contract_refs: contractRefs,
      stale_status: 'fresh',
    };

    task.resolver_refs = resolverRefs;
    task.updated_at = nowIso();

    return {
      typed_ref: task.typed_ref,
      doc_refs: docRefs,
      chunk_refs: chunkRefs,
      contract_refs: contractRefs,
      stale_status: 'fresh',
    };
  }

  ackDocs(taskId: string, request: AckDocsRequest): AckDocsResponse {
    const task = this.requireTask(taskId);

    const ackRef = `ack:${taskId}:${request.doc_id}:${request.version}`;

    if (!task.resolver_refs) {
      task.resolver_refs = {};
    }

    if (!task.resolver_refs.ack_refs) {
      task.resolver_refs.ack_refs = [];
    }

    if (!task.resolver_refs.ack_refs.includes(ackRef)) {
      task.resolver_refs.ack_refs.push(ackRef);
    }

    task.updated_at = nowIso();

    return { ack_ref: ackRef };
  }

  linkTracker(taskId: string, request: TrackerLinkRequest): TrackerLinkResponse {
    const task = this.requireTask(taskId);

    // Validate typed_ref matches
    if (request.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${request.typed_ref}`);
    }

    // Generate sync_event_ref
    const syncEventRef = `sync_evt_${taskId}_${Date.now()}`;

    // Create external refs from the entity_ref
    const externalRefs: ExternalRef[] = [];

    // Parse entity_ref - format could be "tracker_issue:ISSUE-123" or similar
    const entityRefParts = request.entity_ref.split(':');
    if (entityRefParts.length >= 2) {
      const kind = entityRefParts[0];
      const value = entityRefParts.slice(1).join(':');

      // Map entity_ref kind to ExternalRef kind
      let externalKind: ExternalRef['kind'];
      switch (kind) {
        case 'github_issue':
          externalKind = 'github_issue';
          break;
        case 'github_project_item':
          externalKind = 'github_project_item';
          break;
        case 'tracker_issue':
          externalKind = 'tracker_issue';
          break;
        default:
          externalKind = 'entity_link';
      }

      const extRef: ExternalRef = {
        kind: externalKind,
        value: value,
      };

      if (request.connection_ref) {
        extRef.connection_ref = request.connection_ref;
      }

      externalRefs.push(extRef);
    } else {
      // Fallback: treat as entity_link
      const extRef: ExternalRef = {
        kind: 'entity_link',
        value: request.entity_ref,
      };
      if (request.connection_ref) {
        extRef.connection_ref = request.connection_ref;
      }
      externalRefs.push(extRef);
    }

    // Add sync_event to external_refs
    externalRefs.push({
      kind: 'sync_event',
      value: syncEventRef,
      connection_ref: request.connection_ref,
    });

    // Merge with existing external_refs (avoid duplicates)
    const existingValues = new Set(task.external_refs?.map(e => `${e.kind}:${e.value}`) ?? []);
    const newRefs = externalRefs.filter(e => !existingValues.has(`${e.kind}:${e.value}`));
    task.external_refs = [...(task.external_refs ?? []), ...newRefs];
    task.updated_at = nowIso();

    return {
      typed_ref: task.typed_ref,
      external_refs: externalRefs,
      sync_event_ref: syncEventRef,
    };
  }

  private handleSucceededResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    switch (job.stage) {
      case 'plan':
        emittedEvents.push(this.transitionTask(task, 'planned', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'plan completed',
          job_id: job.job_id,
          artifact_ids: result.artifacts.map((artifact) => artifact.artifact_id),
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
      case 'dev':
        emittedEvents.push(this.transitionTask(task, 'dev_completed', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'dev completed',
          job_id: job.job_id,
          artifact_ids: result.artifacts.map((artifact) => artifact.artifact_id),
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_acceptance' };
      case 'acceptance': {
        const regressionOk = task.risk_level !== 'high' || result.test_results.some((test) => test.suite === 'regression' && test.status === 'passed');
        const accepted = result.verdict?.outcome === 'accept' && regressionOk;
        const nextState: TaskState = accepted ? 'accepted' : 'rework_required';
        emittedEvents.push(this.transitionTask(task, nextState, {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: accepted ? 'acceptance passed' : 'acceptance requires rework',
          job_id: job.job_id,
          artifact_ids: result.artifacts.map((artifact) => artifact.artifact_id),
        }));
        return { task, emitted_events: emittedEvents, next_action: accepted ? 'integrate' : 'dispatch_dev' };
      }
    }
  }

  private transitionTask(
    task: Task,
    toState: TaskState,
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): StateTransitionEvent {
    // Validate transition is allowed
    const allowedTargets = ALLOWED_TRANSITIONS.get(task.state);
    if (!allowedTargets || !allowedTargets.includes(toState)) {
      throw new Error(`transition not allowed: ${task.state} -> ${toState}`);
    }

    const event: StateTransitionEvent = {
      event_id: createId('evt'),
      task_id: task.task_id,
      from_state: task.state,
      to_state: toState,
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      reason: input.reason,
      job_id: input.job_id,
      artifact_ids: input.artifact_ids,
      occurred_at: nowIso(),
    };
    task.state = toState;
    task.updated_at = event.occurred_at;
    if (toState === 'completed' || toState === 'published' || toState === 'cancelled' || toState === 'failed') {
      task.completed_at = event.occurred_at;
    }
    if (toState !== 'blocked') {
      task.blocked_context = undefined;
    }
    this.recordEvent(event);
    return event;
  }

  private recordEvent(event: StateTransitionEvent): void {
    const existing = this.events.get(event.task_id) ?? [];
    existing.push(event);
    this.events.set(event.task_id, existing);
  }

  private buildPrompt(task: Task, stage: WorkerStage): string {
    return `${stage.toUpperCase()} task: ${task.title}${task.description ? `\n\n${task.description}` : ''}`;
  }

  private allowedDispatchStage(state: TaskState): WorkerStage {
    switch (state) {
      case 'queued':
        return 'plan';
      case 'planned':
      case 'rework_required':
        return 'dev';
      case 'dev_completed':
        return 'acceptance';
      default:
        throw new Error(`state ${state} cannot dispatch a worker job`);
    }
  }

  private stageToActiveState(stage: WorkerStage): 'planning' | 'developing' | 'accepting' {
    switch (stage) {
      case 'plan':
        return 'planning';
      case 'dev':
        return 'developing';
      case 'acceptance':
        return 'accepting';
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }
}
