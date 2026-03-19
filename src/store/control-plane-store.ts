import { CapabilityManager } from '../domain/capability/index.js';
import { CheckpointService } from '../domain/checkpoint/index.js';
import { ConcurrencyManager } from '../domain/concurrency/index.js';
import { DoomLoopDetector } from '../domain/doom-loop/index.js';
import { LeaseManager } from '../domain/lease/index.js';
import { RepoPolicyService } from '../domain/repo-policy/index.js';
import { RetrospectiveService } from '../domain/retrospective/index.js';
import { RetryManager } from '../domain/retry/index.js';
import { RiskIntegrationService } from '../domain/risk/index.js';
import { ManualChecklistService } from '../domain/checklist/index.js';
import { StateMachine, TERMINAL_STATES } from '../domain/state-machine/index.js';
import { TaskValidator, applyTaskUpdate } from '../domain/task/index.js';
import type { TaskUpdate } from '../domain/task/index.js';
import { RunTimeoutService, RunService } from '../domain/run/index.js';
import { IntegrationOrchestrator } from '../domain/integration/index.js';
import { PublishOrchestrator } from '../domain/publish/index.js';
import { DispatchOrchestrator } from '../domain/dispatch/index.js';
import { SideEffectAnalyzer } from '../domain/side-effect/index.js';
import { StaleDocsValidator } from '../domain/stale-check/index.js';
import { ResultOrchestrator } from '../domain/result/index.js';
import { DocsService } from '../domain/docs/index.js';
import { AcceptanceService } from '../domain/acceptance/index.js';
import { TrackerService } from '../domain/tracker/index.js';
import type {
  AckDocsRequest,
  AckDocsResponse,
  AuditEvent,
  AuditEventType,
  CheckpointRef,
  CompleteAcceptanceRequest,
  CompleteAcceptanceResponse,
  CompleteIntegrateRequest,
  CompletePublishRequest,
  CreateTaskRequest,
  DispatchRequest,
  IntegrationRun,
  IntegrateResponse,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
  PublishRequest,
  PublishRun,
  ResolveDocsRequest,
  ResolveDocsResponse,
  ResultApplyResponse,
  Retrospective,
  RetrospectiveGenerationRequest,
  Run,
  RunStatus,
  StateTransitionEvent,
  StaleCheckRequest,
  StaleCheckResponse,
  Task,
  TaskState,
  TrackerLinkRequest,
  TrackerLinkResponse,
  WorkerJob,
  WorkerResult,
} from '../types.js';
import {
  nowIso,
  createId,
} from './utils.js';

// =============================================================================
// ControlPlaneStore
// =============================================================================

export class ControlPlaneStore {
  private readonly stateMachine = new StateMachine();
  private readonly tasks = new Map<string, Task>();
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly events = new Map<string, StateTransitionEvent[]>();
  private readonly auditEvents = new Map<string, AuditEvent[]>();

  // Track retry counts per task+stage
  private readonly retryTracker = new Map<string, number>();

  // Track idempotency keys for publish operations (key -> task_id)
  private readonly publishIdempotencyKeys = new Map<string, string>();

  // Domain managers for reliability features
  private readonly leaseManager = new LeaseManager();
  private readonly retryManager = new RetryManager();
  private readonly concurrencyManager = new ConcurrencyManager();
  private readonly capabilityManager = new CapabilityManager();
  private readonly doomLoopDetector = new DoomLoopDetector();
  private readonly repoPolicyService = new RepoPolicyService();
  private readonly riskIntegrationService = new RiskIntegrationService();
  private readonly checklistService = new ManualChecklistService();
  private readonly runTimeoutService = new RunTimeoutService();
  private readonly checkpointService = new CheckpointService();
  private readonly retrospectiveService = new RetrospectiveService();
  private readonly sideEffectAnalyzer = new SideEffectAnalyzer();
  private readonly staleDocsValidator = new StaleDocsValidator();

  // Orchestrators
  private readonly integrationOrchestrator = new IntegrationOrchestrator({
    repoPolicyService: this.repoPolicyService,
    riskIntegrationService: this.riskIntegrationService,
    checklistService: this.checklistService,
  });
  private readonly publishOrchestrator = new PublishOrchestrator({
    repoPolicyService: this.repoPolicyService,
  });
  private readonly dispatchOrchestrator = new DispatchOrchestrator({
    capabilityManager: this.capabilityManager,
    concurrencyManager: this.concurrencyManager,
    leaseManager: this.leaseManager,
    retryManager: this.retryManager,
    doomLoopDetector: this.doomLoopDetector,
    stateMachine: this.stateMachine,
  });

  // Services
  private readonly resultOrchestrator = new ResultOrchestrator({
    retryManager: this.retryManager,
    doomLoopDetector: this.doomLoopDetector,
    leaseManager: this.leaseManager,
    concurrencyManager: this.concurrencyManager,
    sideEffectAnalyzer: this.sideEffectAnalyzer,
    stateMachine: this.stateMachine,
  });
  private readonly docsService = new DocsService();
  private readonly acceptanceService = new AcceptanceService({
    checklistService: this.checklistService,
    checkpointService: this.checkpointService,
    staleDocsValidator: this.staleDocsValidator,
  });
  private readonly runService = new RunService({
    checkpointService: this.checkpointService,
  });

  // ---------------------------------------------------------------------------
  // State Storage
  // ---------------------------------------------------------------------------

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
      repo_policy: input.repo_policy,
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

  requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  touchTask(task: Task): void {
    task.version += 1;
    task.updated_at = nowIso();
  }

  /**
   * Apply a TaskUpdate to a task immutably.
   * Creates a new task object and stores it.
   */
  updateTask(taskId: string, update: TaskUpdate): void {
    const task = this.requireTask(taskId);
    const updatedTask = applyTaskUpdate(task, update);
    this.tasks.set(taskId, updatedTask);
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  dispatch(taskId: string, request: DispatchRequest): WorkerJob {
    const task = this.requireTask(taskId);
    const { job, nextState } = this.dispatchOrchestrator.dispatch(
      task,
      request,
      this.jobs,
      this.retryTracker,
      {
        requireTask: (id) => this.requireTask(id),
        transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
      },
    );

    // Create updated task with dispatch info
    const updatedTask: Task = {
      ...task,
      active_job_id: job.job_id,
      latest_job_ids: { ...(task.latest_job_ids ?? {}), [request.target_stage]: job.job_id },
      workspace_ref: job.workspace_ref,
    };

    this.transitionTask(updatedTask, nextState, {
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

  // ---------------------------------------------------------------------------
  // Result Handling
  // ---------------------------------------------------------------------------

  applyResult(taskId: string, result: WorkerResult): ResultApplyResponse {
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

    // Store result
    this.results.set(result.job_id, result);

    // Apply result through orchestrator (returns immutable updates)
    const response = this.resultOrchestrator.applyResult(
      result,
      task,
      job,
      this.retryTracker,
      {
        transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
        emitAuditEvent: (tid, eventType, payload, options) => this.emitAuditEvent(tid, eventType, payload, options),
      },
    );

    // Update the task in store with the returned task
    this.tasks.set(response.task.task_id, response.task);

    return response;
  }

  // ---------------------------------------------------------------------------
  // Acceptance
  // ---------------------------------------------------------------------------

  completeAcceptance(taskId: string, request: CompleteAcceptanceRequest): CompleteAcceptanceResponse {
    return this.acceptanceService.completeAcceptance(taskId, request, {
      requireTask: (id) => this.requireTask(id),
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
      updateTask: (id, update) => this.updateTask(id, update),
      emitAuditEvent: (tid, eventType, payload) => this.emitAuditEvent(tid, eventType, payload),
    });
  }

  // ---------------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------------

  integrate(taskId: string, baseSha: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'accepted') {
      throw new Error('task is not accepted');
    }

    return this.integrationOrchestrator.startIntegration(task, baseSha, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });
  }

  completeIntegrate(taskId: string, request: CompleteIntegrateRequest): IntegrateResponse {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw new Error('task is not integrating');
    }

    if (!task.integration) {
      throw new Error('integration state not found');
    }

    const result = this.integrationOrchestrator.completeIntegration(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });

    // Emit audit event for main update
    if (request.main_updated_sha) {
      this.emitAuditEvent(task.task_id, 'run.main_updated', {
        main_updated_sha: request.main_updated_sha,
        integration_head_sha: request.integration_head_sha,
        checks_passed: request.checks_passed,
      });

      // Record code checkpoint for integration
      this.checkpointService.recordCheckpoint({
        task_id: task.task_id,
        run_id: task.task_id,
        checkpoint_type: 'code',
        stage: 'integrate',
        ref: request.main_updated_sha,
        summary: `Main updated to ${request.main_updated_sha.substring(0, 7)}`,
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  publish(taskId: string, request: PublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrated') {
      throw new Error('task is not integrated');
    }

    // Idempotency check: if same key was used before, return the existing task
    if (request.idempotency_key) {
      const existingTaskId = this.publishIdempotencyKeys.get(request.idempotency_key);
      if (existingTaskId) {
        const existingTask = this.tasks.get(existingTaskId);
        if (existingTask) {
          // Emit audit event for idempotent request
          this.emitAuditEvent(task.task_id, 'run.publishIdempotent', {
            idempotency_key: request.idempotency_key,
            existing_task_id: existingTaskId,
            mode: request.mode,
          });
          return existingTask;
        }
      }
      // Store the idempotency key for future requests
      this.publishIdempotencyKeys.set(request.idempotency_key, task.task_id);
    }

    const result = this.publishOrchestrator.startPublish(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });

    // Emit audit event for publish request
    this.emitAuditEvent(task.task_id, 'run.publishRequested', {
      mode: request.mode,
      idempotency_key: request.idempotency_key,
      approval_required: task.publish_plan?.approval_required,
    });

    return result;
  }

  approvePublish(taskId: string, approvalToken: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publish_pending_approval') {
      throw new Error('task is not pending approval');
    }

    const result = this.publishOrchestrator.approvePublish(task, approvalToken, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });

    // Record approval checkpoint for publish
    this.checkpointService.recordCheckpoint({
      task_id: task.task_id,
      run_id: task.task_id,
      checkpoint_type: 'approval',
      stage: 'publish',
      ref: `approval:${task.task_id}:publish`,
      summary: 'Publish approved',
      actor: 'operator',
    });

    return result;
  }

  completePublish(taskId: string, request: CompletePublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw new Error('task is not publishing');
    }

    const result = this.publishOrchestrator.completePublish(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });

    // Emit audit event for publish completion
    this.emitAuditEvent(task.task_id, 'run.publishCompleted', {
      external_refs: request.external_refs,
      rollback_notes: request.rollback_notes,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Timeout Management
  // ---------------------------------------------------------------------------

  checkTimeouts(): Task[] {
    return this.runTimeoutService.checkTimeouts(this.tasks.values(), {
      transitionTask: (task, toState, input) => this.transitionTask(task, toState, input),
    });
  }

  updateIntegrationProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw new Error('task is not integrating');
    }
    this.runTimeoutService.updateIntegrationProgress(task, progress);
    return task;
  }

  updatePublishProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw new Error('task is not publishing');
    }
    this.runTimeoutService.updatePublishProgress(task, progress);
    return task;
  }

  getActiveRuns(): Array<{ task: Task; run: IntegrationRun | PublishRun; type: 'integration' | 'publish' }> {
    return this.runTimeoutService.getActiveRuns(this.tasks.values());
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

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
    // Return the updated task from store
    return this.requireTask(taskId);
  }

  // ---------------------------------------------------------------------------
  // Docs Operations
  // ---------------------------------------------------------------------------

  private getTaskUpdateContext() {
    return {
      requireTask: (id: string) => this.requireTask(id),
      updateTask: (id: string, update: TaskUpdate) => this.updateTask(id, update),
    };
  }

  resolveDocs(taskId: string, request: ResolveDocsRequest): ResolveDocsResponse {
    return this.docsService.resolveDocs(taskId, request, this.getTaskUpdateContext());
  }

  ackDocs(taskId: string, request: AckDocsRequest): AckDocsResponse {
    return this.docsService.ackDocs(taskId, request, this.getTaskUpdateContext());
  }

  async staleCheck(taskId: string, request: StaleCheckRequest): Promise<StaleCheckResponse> {
    return this.docsService.staleCheck(taskId, request, this.getTaskUpdateContext());
  }

  async getChunks(request: import('../domain/resolver/index.js').GetChunksRequest): Promise<import('../domain/resolver/index.js').GetChunksResponse> {
    return this.docsService.getChunks(request);
  }

  async resolveContracts(request: import('../domain/resolver/index.js').ResolveContractsRequest): Promise<import('../domain/resolver/index.js').ResolveContractsResponse> {
    return this.docsService.resolveContracts(request);
  }

  // ---------------------------------------------------------------------------
  // Tracker Operations
  // ---------------------------------------------------------------------------

  linkTracker(taskId: string, request: TrackerLinkRequest): TrackerLinkResponse {
    return TrackerService.linkTracker(taskId, request, this.getTaskUpdateContext());
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  recordTransition(taskId: string, event: StateTransitionEvent): StateTransitionEvent {
    const task = this.requireTask(taskId);

    // Validate event integrity
    TaskValidator.validateTransitionEvent(event, taskId, task.state);

    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, event.to_state);

    // Create updated task immutably
    const updatedTask: Task = {
      ...task,
      state: event.to_state,
      version: task.version + 1,
      updated_at: nowIso(),
    };

    // Store the updated task
    this.tasks.set(updatedTask.task_id, updatedTask);
    this.recordEvent(event);
    return event;
  }

  private transitionTask(
    task: Task,
    toState: TaskState,
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): { event: StateTransitionEvent; task: Task } {
    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, toState);

    const timestamp = nowIso();
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
      occurred_at: timestamp,
    };

    // Create updated task immutably
    const updatedTask: Task = {
      ...task,
      state: toState,
      version: task.version + 1,
      updated_at: timestamp,
    };

    if (this.stateMachine.isTerminal(toState)) {
      updatedTask.completed_at = timestamp;
    }
    if (toState !== 'blocked') {
      updatedTask.blocked_context = undefined;
    }

    // Store the updated task
    this.tasks.set(updatedTask.task_id, updatedTask);
    this.recordEvent(event);
    return { event, task: updatedTask };
  }

  private recordEvent(event: StateTransitionEvent): void {
    const existing = this.events.get(event.task_id) ?? [];
    existing.push(event);
    this.events.set(event.task_id, existing);
  }

  // ---------------------------------------------------------------------------
  // Audit Events
  // ---------------------------------------------------------------------------

  private emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options: {
      runId?: string;
      jobId?: string;
      actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
      actorId?: string;
    } = {},
  ): AuditEvent {
    const event: AuditEvent = {
      event_id: createId('audit'),
      event_type: eventType,
      task_id: taskId,
      run_id: options.runId,
      job_id: options.jobId,
      actor_type: options.actorType ?? 'control_plane',
      actor_id: options.actorId ?? 'control_plane',
      payload,
      occurred_at: nowIso(),
    };

    const existing = this.auditEvents.get(taskId) ?? [];
    existing.push(event);
    this.auditEvents.set(taskId, existing);
    return event;
  }

  listAuditEvents(taskId: string): AuditEvent[] {
    return this.auditEvents.get(taskId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Run Read Model
  // ---------------------------------------------------------------------------

  private getRunContext() {
    return {
      getTask: (id: string) => this.tasks.get(id),
      getEvents: (id: string) => this.events.get(id) ?? [],
      getAuditEvents: (id: string) => this.auditEvents.get(id) ?? [],
    };
  }

  listRuns(options?: { limit?: number; offset?: number; status?: RunStatus[] }): Run[] {
    return this.runService.listRuns(this.tasks.values(), this.getRunContext(), options);
  }

  getRun(runId: string): Run | undefined {
    return this.runService.getRun(runId, this.getRunContext());
  }

  getRunTimeline(runId: string): StateTransitionEvent[] {
    return this.runService.getRunTimeline(runId, this.getRunContext());
  }

  getRunAuditSummary(runId: string): { event_counts: Record<string, number>; latest_events: AuditEvent[]; total_events: number } {
    return this.runService.getRunAuditSummary(runId, this.getRunContext());
  }

  getRunCheckpoints(runId: string): CheckpointRef[] {
    return this.runService.getRunCheckpoints(runId);
  }

  getTaskCheckpoints(taskId: string): CheckpointRef[] {
    return this.runService.getTaskCheckpoints(taskId);
  }

  // ---------------------------------------------------------------------------
  // Retrospective
  // ---------------------------------------------------------------------------

  generateRetrospective(runId: string, request: RetrospectiveGenerationRequest = {}): Retrospective {
    const task = this.tasks.get(runId);
    if (!task) {
      throw new Error(`run not found: ${runId}`);
    }

    const ctx = this.getRunContext();
    const run = this.runService.taskToRun(task, ctx);
    const events = ctx.getEvents(task.task_id);
    const auditEvents = ctx.getAuditEvents(task.task_id);
    const checkpoints = this.getTaskCheckpoints(task.task_id);
    const jobs = this.getJobsForTask(task.task_id);

    const result = this.retrospectiveService.generateRetrospective({
      run, task, events, jobs, auditEvents, checkpoints, request,
    });

    return result.retrospective;
  }

  getRetrospective(runId: string): Retrospective | undefined {
    return this.retrospectiveService.getRetrospective(runId);
  }

  getRetrospectiveHistory(runId: string): Retrospective[] {
    return this.retrospectiveService.getRetrospectiveHistory(runId);
  }

  getRetrospectivesForTask(taskId: string): Retrospective[] {
    return this.retrospectiveService.getRetrospectivesForTask(taskId);
  }

  private getJobsForTask(taskId: string): WorkerJob[] {
    return Array.from(this.jobs.values()).filter(j => j.task_id === taskId);
  }

  // Reset concurrency state (useful for testing)
  resetConcurrency(): void {
    this.concurrencyManager.reset();
  }
}