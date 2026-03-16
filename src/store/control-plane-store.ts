import { randomUUID } from 'node:crypto';

import type {
  ApprovalPolicy,
  CreateTaskRequest,
  DispatchRequest,
  NextAction,
  PublishRequest,
  ResultApplyResponse,
  StateTransitionEvent,
  Task,
  TaskState,
  WorkerJob,
  WorkerResult,
  WorkerStage,
  WorkerType,
} from '../types.js';

const TERMINAL_STATES = new Set<TaskState>(['completed', 'cancelled', 'failed']);
const DEFAULT_WORKERS: Record<WorkerStage, WorkerType> = {
  plan: 'codex',
  dev: 'codex',
  acceptance: 'claude_code',
};

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
    const timestamp = nowIso();
    const task: Task = {
      task_id: createId('task'),
      title: input.title,
      description: input.description,
      state: 'queued',
      risk_level: input.risk_level ?? 'medium',
      repo_ref: input.repo_ref,
      labels: input.labels ?? [],
      publish_plan: input.publish_plan,
      artifacts: [],
      external_refs: [],
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
    const job: WorkerJob = {
      job_id: createId('job'),
      task_id: task.task_id,
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

  private stageToActiveState(stage: WorkerStage): TaskState {
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
