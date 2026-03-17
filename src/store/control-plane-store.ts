import { randomUUID } from 'node:crypto';

import { CapabilityManager } from '../domain/capability/index.js';
import { ConcurrencyManager } from '../domain/concurrency/index.js';
import { DoomLoopDetector } from '../domain/doom-loop/index.js';
import { LeaseManager } from '../domain/lease/index.js';
import { RetryManager } from '../domain/retry/index.js';
import { ResolverService } from '../domain/resolver/index.js';
import { StateMachine, TERMINAL_STATES } from '../domain/state-machine/index.js';
import { TaskValidator } from '../domain/task/index.js';
import { TrackerService } from '../domain/tracker/index.js';
import { WorkerPolicy } from '../domain/worker/index.js';
import type {
  AckDocsRequest,
  AckDocsResponse,
  CompleteIntegrateRequest,
  CompletePublishRequest,
  CreateTaskRequest,
  DispatchRequest,
  ExternalRef,
  IntegrateResponse,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
  PublishRequest,
  ResolveDocsRequest,
  ResolveDocsResponse,
  ResultApplyResponse,
  StateTransitionEvent,
  StaleCheckRequest,
  StaleCheckResponse,
  Task,
  TaskState,
  TrackerLinkRequest,
  TrackerLinkResponse,
  WorkerJob,
  WorkerResult,
  WorkerStage,
  WorkerType,
  FailureClass,
} from '../types.js';

// =============================================================================
// Utility Functions
// =============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function generateLoopFingerprint(taskId: string, stage: WorkerStage): string {
  const timestamp = new Date().toISOString();
  const hash = simpleHash(`${taskId}:${stage}:${timestamp}`);
  return `loop:${taskId}:${stage}:${hash}`;
}

function mergeExternalRefs(existing: ExternalRef[] | undefined, newRefs: ExternalRef[]): ExternalRef[] {
  const existingValues = new Set(existing?.map(e => e.value) ?? []);
  const uniqueNew = newRefs.filter(e => !existingValues.has(e.value));
  return [...(existing ?? []), ...uniqueNew];
}

function getArtifactIds(result: WorkerResult): string[] {
  return result.artifacts.map(a => a.artifact_id);
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_WORKER_CAPABILITIES: Record<WorkerType, string[]> = {
  codex: ['read', 'write', 'execute', 'test', 'analyze'],
  claude_code: ['read', 'write', 'execute', 'test', 'analyze', 'git', 'publish'],
  google_antigravity: ['read', 'analyze'],
};

// =============================================================================
// ControlPlaneStore
// =============================================================================

export class ControlPlaneStore {
  private readonly stateMachine = new StateMachine();
  private readonly tasks = new Map<string, Task>();
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly events = new Map<string, StateTransitionEvent[]>();

  // Track retry counts per task+stage
  private readonly retryTracker = new Map<string, number>();

  // Domain managers for reliability features
  private readonly leaseManager = new LeaseManager();
  private readonly retryManager = new RetryManager();
  private readonly concurrencyManager = new ConcurrencyManager();
  private readonly capabilityManager = new CapabilityManager();
  private readonly doomLoopDetector = new DoomLoopDetector();

  createTask(input: CreateTaskRequest): Task {
    TaskValidator.validateCreateRequest(input);

    const timestamp = nowIso();
    const task: Task = {
      task_id: createId('task'),
      title: input.title,
      objective: input.objective,
      typed_ref: input.typed_ref,
      description: input.description,
      state: 'queued',
      version: 0,
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

    const workerType = request.worker_selection ?? WorkerPolicy.getDefaultWorker(request.target_stage);
    const riskLevel = request.override_risk_level ?? task.risk_level;

    // Capability check before dispatch
    const workerCapabilities = this.capabilityManager.getWorkerCapabilities(workerType);
    const capabilityResult = this.capabilityManager.validateCapabilities({
      stage: request.target_stage,
      worker_capabilities: workerCapabilities,
    });
    if (!capabilityResult.valid) {
      // Auto-register default capabilities for known worker types
      this.registerDefaultCapabilities(workerType);
    }

    // Concurrency check
    const concurrencyResult = this.concurrencyManager.canAccept({
      worker_id: workerType,
      stage: request.target_stage,
    });
    if (!concurrencyResult.accepted) {
      throw new Error(`cannot dispatch: ${concurrencyResult.reason}`);
    }

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

    // Generate loop fingerprint for this task+stage combination
    const loopFingerprint = generateLoopFingerprint(task.task_id, request.target_stage);

    // Get or initialize retry count
    const retryKey = `${task.task_id}:${request.target_stage}`;
    const retryCount = this.retryTracker.get(retryKey) ?? 0;

    // Get default retry policy for stage
    const maxRetries = this.retryManager.getDefaultMaxRetries(request.target_stage);

    // Issue lease for the job
    const lease = this.leaseManager.acquire(createId('job'), workerType);

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
      capability_requirements: WorkerPolicy.getCapabilityRequirements(request.target_stage),
      risk_level: riskLevel,
      approval_policy: WorkerPolicy.buildApprovalPolicy(request.target_stage, riskLevel),
      retry_policy: {
        max_retries: maxRetries,
        backoff_base_seconds: 2,
        max_backoff_seconds: 60,
        jitter_enabled: true,
      },
      retry_count: retryCount,
      loop_fingerprint: loopFingerprint,
      lease_owner: lease.lease_owner,
      lease_expires_at: lease.lease_expires_at,
      context,
      requested_outputs: WorkerPolicy.getRequestedOutputs(request.target_stage),
    };

    const nextState = this.stageToActiveState(request.target_stage);
    this.jobs.set(job.job_id, job);

    // Record concurrency
    this.concurrencyManager.recordStart({
      job_id: job.job_id,
      worker_id: workerType,
      stage: request.target_stage,
    });

    // Record transition for doom-loop detection
    this.doomLoopDetector.recordTransition({
      job_id: job.job_id,
      from_state: task.state,
      to_state: nextState,
      stage: request.target_stage,
    });

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

  heartbeat(jobId: string, request: JobHeartbeatRequest): JobHeartbeatResponse {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`job not found: ${jobId}`);
    }

    const response = this.leaseManager.heartbeat(jobId, request.worker_id, {
      stage: request.stage,
      progress: request.progress,
      observed_at: request.observed_at,
    });

    if (!response) {
      throw new Error('heartbeat rejected: not lease owner or job orphaned');
    }

    return {
      job_id: jobId,
      lease_expires_at: response.lease_expires_at,
      next_heartbeat_due_at: response.next_heartbeat_due_at,
      last_heartbeat_at: response.last_heartbeat_at,
    };
  }

  private registerDefaultCapabilities(workerType: WorkerType): void {
    const caps = DEFAULT_WORKER_CAPABILITIES[workerType] ?? ['read'];
    this.capabilityManager.registerWorkerCapabilities(workerType, caps as any);
  }

  // ---------------------------------------------------------------------------
  // Result Handling
  // ---------------------------------------------------------------------------

  applyResult(taskId: string, result: WorkerResult): ResultApplyResponse {
    const { task, job } = this.validateResult(taskId, result);

    this.results.set(result.job_id, result);
    const emittedEvents: StateTransitionEvent[] = [];

    // Update task metadata from result
    this.updateTaskFromResult(task, result);

    // Handle by status
    switch (result.status) {
      case 'blocked':
        return this.handleBlockedResult(task, job, result, emittedEvents);
      case 'failed':
        return this.handleFailedResult(task, job, result, emittedEvents);
      default:
        return this.handleSucceededResultFinal(task, job, result, emittedEvents);
    }
  }

  private validateResult(taskId: string, result: WorkerResult): { task: Task; job: WorkerJob } {
    const task = this.requireTask(taskId);
    if (!task.active_job_id || task.active_job_id !== result.job_id) {
      throw new Error('job_id does not match active_job_id');
    }

    if (result.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${result.typed_ref}`);
    }

    const job = this.jobs.get(result.job_id);
    if (!job) {
      throw new Error('job not found');
    }

    return { task, job };
  }

  private updateTaskFromResult(task: Task, result: WorkerResult): void {
    // Merge artifacts
    task.artifacts = [
      ...(task.artifacts ?? []),
      ...result.artifacts.map((a) => ({
        artifact_id: a.artifact_id,
        kind: a.kind === 'html' ? 'other' as const : a.kind,
      })),
    ];

    // Merge resolver refs
    if (result.resolver_refs) {
      task.resolver_refs = { ...task.resolver_refs, ...result.resolver_refs };
    }

    // Merge external refs
    if (result.external_refs) {
      task.external_refs = mergeExternalRefs(task.external_refs, result.external_refs);
    }

    // Update other fields
    if (result.context_bundle_ref) {
      task.context_bundle_ref = result.context_bundle_ref;
    }
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
  }

  private handleBlockedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
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
      artifact_ids: getArtifactIds(result),
    }));
    return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
  }

  private handleFailedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    const failureClass = result.failure_class ?? this.retryManager.classifyFromResult(result);
    const retryKey = `${task.task_id}:${job.stage}`;
    const currentRetryCount = result.retry_count ?? this.retryTracker.get(retryKey) ?? 0;
    const maxRetries = job.retry_policy?.max_retries ?? this.retryManager.getDefaultMaxRetries(job.stage);

    // Check for doom loop first
    const loopResult = this.doomLoopDetector.detectLoop(job.job_id);
    if (loopResult) {
      return this.handleDoomLoop(task, job, result, loopResult, emittedEvents);
    }

    // Check if we should retry
    if (this.retryManager.shouldRetry({ failure_class: failureClass, retry_count: currentRetryCount, max_retries: maxRetries })) {
      return this.handleRetry(task, job, result, retryKey, currentRetryCount, maxRetries, failureClass, emittedEvents);
    }

    // Max retries reached or non-retryable failure
    return this.handleFinalFailure(task, job, result, retryKey, failureClass, emittedEvents);
  }

  private handleDoomLoop(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    loopResult: { loop_type: string },
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    task.blocked_context = {
      resume_state: this.stageToActiveState(job.stage),
      reason: `Doom loop detected: ${loopResult.loop_type}`,
      waiting_on: 'policy',
      loop_fingerprint: job.loop_fingerprint,
    };
    emittedEvents.push(this.transitionTask(task, 'blocked', {
      actor_type: 'policy_engine',
      actor_id: 'doom_loop_detector',
      reason: `doom loop detected: ${loopResult.loop_type}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));
    this.finalizeJob(task, job, false);
    return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
  }

  private handleRetry(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    currentRetryCount: number,
    maxRetries: number,
    failureClass: FailureClass,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    this.retryTracker.set(retryKey, currentRetryCount + 1);

    const nextState = this.stageToActiveState(job.stage);
    emittedEvents.push(this.transitionTask(task, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'retry_manager',
      reason: `retry ${currentRetryCount + 1}/${maxRetries} after ${failureClass}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    // Release lease but keep concurrency for retry
    this.leaseManager.release(job.job_id, job.worker_type);
    task.active_job_id = undefined;
    task.version += 1;
    task.updated_at = nowIso();

    const backoffSeconds = this.retryManager.calculateBackoff(
      currentRetryCount,
      job.retry_policy ?? { max_retries: maxRetries, backoff_base_seconds: 2, max_backoff_seconds: 60, jitter_enabled: true }
    );

    return {
      task,
      emitted_events: emittedEvents,
      next_action: 'retry',
      retry_scheduled_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
    };
  }

  private handleFinalFailure(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    failureClass: FailureClass,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    emittedEvents.push(this.transitionTask(task, 'rework_required', {
      actor_type: 'worker',
      actor_id: job.worker_type,
      reason: result.summary ?? `failed (${failureClass}, retries exhausted)`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    this.retryTracker.delete(retryKey);
    this.finalizeJob(task, job, true);
    return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
  }

  private handleSucceededResultFinal(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    const outcome = this.handleSucceededResult(task, job, result, emittedEvents);
    this.finalizeJob(task, job, true);
    return outcome;
  }

  private finalizeJob(task: Task, job: WorkerJob, releaseConcurrency: boolean): void {
    this.leaseManager.release(job.job_id, job.worker_type);
    if (releaseConcurrency) {
      this.concurrencyManager.recordComplete({
        job_id: job.job_id,
        worker_id: job.worker_type,
      });
    }
    task.active_job_id = undefined;
    task.version += 1;
    task.updated_at = nowIso();
  }

  recordTransition(taskId: string, event: StateTransitionEvent): StateTransitionEvent {
    const task = this.requireTask(taskId);
    if (event.task_id !== taskId) {
      throw new Error('task_id mismatch');
    }
    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, event.to_state);
    task.state = event.to_state;
    task.version += 1;
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
      task.external_refs = mergeExternalRefs(task.external_refs, request.external_refs);
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

    const response = ResolverService.resolveDocs(task.typed_ref, request);

    task.resolver_refs = {
      doc_refs: response.doc_refs,
      chunk_refs: response.chunk_refs,
      contract_refs: response.contract_refs,
      stale_status: response.stale_status,
    };
    task.version += 1;
    task.updated_at = nowIso();

    return response;
  }

  ackDocs(taskId: string, request: AckDocsRequest): AckDocsResponse {
    const task = this.requireTask(taskId);

    const ackRef = ResolverService.buildAckRef(taskId, request.doc_id, request.version);

    if (!task.resolver_refs) {
      task.resolver_refs = {};
    }

    if (!task.resolver_refs.ack_refs) {
      task.resolver_refs.ack_refs = [];
    }

    if (!task.resolver_refs.ack_refs.includes(ackRef)) {
      task.resolver_refs.ack_refs.push(ackRef);
    }

    task.version += 1;
    task.updated_at = nowIso();

    return { ack_ref: ackRef };
  }

  staleCheck(taskId: string, request: StaleCheckRequest): StaleCheckResponse {
    const task = this.requireTask(taskId);

    // Get current document versions from the resolver
    // In a real implementation, this would call the memx-resolver service
    const getCurrentVersions = (docIds: string[]) => {
      return docIds.map(docId => ({
        doc_id: docId,
        version: this.getCurrentDocVersion(docId),
        exists: this.docExists(docId),
      }));
    };

    const response = ResolverService.checkStale(
      taskId,
      task.resolver_refs,
      request,
      getCurrentVersions,
    );

    // Update stale_status if any stale documents found
    if (response.stale.length > 0) {
      if (!task.resolver_refs) {
        task.resolver_refs = {};
      }
      task.resolver_refs.stale_status = 'stale';
      task.version += 1;
      task.updated_at = nowIso();
    }

    return response;
  }

  /**
   * Get the current version of a document.
   * In a real implementation, this would query the memx-resolver service.
   * For now, we simulate versions based on timestamps.
   */
  private getCurrentDocVersion(docId: string): string {
    // Simulate version check - in production this calls memx-resolver
    // Return a recent date as the current version
    return new Date().toISOString().split('T')[0] ?? 'unknown';
  }

  /**
   * Check if a document exists.
   * In a real implementation, this would query the memx-resolver service.
   */
  private docExists(docId: string): boolean {
    // Simulate existence check - most docs exist
    return !docId.includes('missing');
  }

  linkTracker(taskId: string, request: TrackerLinkRequest): TrackerLinkResponse {
    const task = this.requireTask(taskId);

    // Validate typed_ref matches
    if (request.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${request.typed_ref}`);
    }

    // Generate sync_event_ref
    const syncEventRef = TrackerService.generateSyncEventRef(taskId);

    // Create external refs from the entity_ref
    const entityRef = TrackerService.parseEntityRef(
      request.entity_ref,
      request.connection_ref,
      request.link_role,
      request.metadata_json
    );
    const syncEventExtRef = TrackerService.buildSyncEventRef(syncEventRef, request.connection_ref);
    const externalRefs = [entityRef, syncEventExtRef];

    // Merge with existing external_refs (avoid duplicates)
    task.external_refs = TrackerService.mergeExternalRefs(task.external_refs, externalRefs);
    task.version += 1;
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
    const artifactIds = getArtifactIds(result);

    switch (job.stage) {
      case 'plan':
        emittedEvents.push(this.transitionTask(task, 'planned', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'plan completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };

      case 'dev':
        emittedEvents.push(this.transitionTask(task, 'dev_completed', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'dev completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_acceptance' };

      case 'acceptance': {
        const regressionOk = task.risk_level !== 'high' ||
          result.test_results.some(t => t.suite === 'regression' && t.status === 'passed');
        const accepted = result.verdict?.outcome === 'accept' && regressionOk;
        const nextState: TaskState = accepted ? 'accepted' : 'rework_required';

        emittedEvents.push(this.transitionTask(task, nextState, {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: accepted ? 'acceptance passed' : 'acceptance requires rework',
          job_id: job.job_id,
          artifact_ids: artifactIds,
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
    this.stateMachine.validateTransition(task.state, toState);

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
    task.version += 1;
    task.updated_at = event.occurred_at;
    if (this.stateMachine.isTerminal(toState)) {
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
    return this.stateMachine.getAllowedDispatchStage(state);
  }

  private stageToActiveState(stage: WorkerStage): 'planning' | 'developing' | 'accepting' {
    return this.stateMachine.stageToActiveState(stage);
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  // Reset concurrency state (useful for testing)
  resetConcurrency(): void {
    // Create a new ConcurrencyManager to reset state
    (this as any).concurrencyManager = new ConcurrencyManager();
  }
}
