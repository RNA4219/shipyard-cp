import { CapabilityManager } from '../domain/capability/index.js';
import { ConcurrencyManager } from '../domain/concurrency/index.js';
import { DoomLoopDetector } from '../domain/doom-loop/index.js';
import { LeaseManager } from '../domain/lease/index.js';
import { RepoPolicyService } from '../domain/repo-policy/index.js';
import { RetryManager } from '../domain/retry/index.js';
import { ResolverService, getMemxResolverClient } from '../domain/resolver/index.js';
import { RiskIntegrationService } from '../domain/risk/index.js';
import { ManualChecklistService } from '../domain/checklist/index.js';
import { StateMachine, TERMINAL_STATES } from '../domain/state-machine/index.js';
import { TaskValidator } from '../domain/task/index.js';
import { TrackerService } from '../domain/tracker/index.js';
import { RunTimeoutService } from '../domain/run/index.js';
import { IntegrationOrchestrator } from '../domain/integration/index.js';
import { PublishOrchestrator } from '../domain/publish/index.js';
import { DispatchOrchestrator } from '../domain/dispatch/index.js';
import type {
  AckDocsRequest,
  AckDocsResponse,
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
  FailureClass,
} from '../types.js';
import {
  nowIso,
  createId,
  mergeExternalRefs,
  getArtifactIds,
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

  // Track retry counts per task+stage
  private readonly retryTracker = new Map<string, number>();

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
        stageToActiveState: (stage) => this.stageToActiveState(stage),
        allowedDispatchStage: (state) => this.allowedDispatchStage(state),
        buildPrompt: (t, stage) => this.buildPrompt(t, stage),
      },
    );

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
    this.touchTask(task);

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
    this.touchTask(task);
  }

  recordTransition(taskId: string, event: StateTransitionEvent): StateTransitionEvent {
    const task = this.requireTask(taskId);
    if (event.task_id !== taskId) {
      throw new Error('task_id mismatch');
    }
    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, event.to_state);
    task.state = event.to_state;
    this.touchTask(task);
    this.recordEvent(event);
    return event;
  }

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

    return this.integrationOrchestrator.completeIntegration(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });
  }

  publish(taskId: string, request: PublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrated') {
      throw new Error('task is not integrated');
    }

    return this.publishOrchestrator.startPublish(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });
  }

  approvePublish(taskId: string, approvalToken: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publish_pending_approval') {
      throw new Error('task is not pending approval');
    }

    return this.publishOrchestrator.approvePublish(task, approvalToken, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });
  }

  completePublish(taskId: string, request: CompletePublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw new Error('task is not publishing');
    }

    return this.publishOrchestrator.completePublish(task, request, {
      transitionTask: (t, toState, input) => this.transitionTask(t, toState, input),
    });
  }

  /**
   * Check for timed-out integration/publish runs and mark them as timeout.
   * Returns list of tasks that have timed out.
   */
  checkTimeouts(): Task[] {
    return this.runTimeoutService.checkTimeouts(this.tasks.values(), {
      transitionTask: (task, toState, input) => this.transitionTask(task, toState, input),
    });
  }

  /**
   * Update progress for an integration run.
   */
  updateIntegrationProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw new Error('task is not integrating');
    }
    this.runTimeoutService.updateIntegrationProgress(task, progress);
    return task;
  }

  /**
   * Update progress for a publish run.
   */
  updatePublishProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw new Error('task is not publishing');
    }
    this.runTimeoutService.updatePublishProgress(task, progress);
    return task;
  }

  /**
   * Get all tasks currently in integrating or publishing state with run metadata.
   */
  getActiveRuns(): Array<{ task: Task; run: IntegrationRun | PublishRun; type: 'integration' | 'publish' }> {
    return this.runTimeoutService.getActiveRuns(this.tasks.values());
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
    this.touchTask(task);

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

    this.touchTask(task);

    return { ack_ref: ackRef };
  }

  async staleCheck(taskId: string, request: StaleCheckRequest): Promise<StaleCheckResponse> {
    const task = this.requireTask(taskId);

    // Use memx-resolver client if configured, otherwise use fallback
    const client = getMemxResolverClient();

    const response = await ResolverService.checkStale(
      taskId,
      task.resolver_refs,
      request,
      client ? undefined : this.getFallbackVersions.bind(this),
    );

    // Update stale_status if any stale documents found
    if (response.stale.length > 0) {
      if (!task.resolver_refs) {
        task.resolver_refs = {};
      }
      task.resolver_refs.stale_status = 'stale';
      this.touchTask(task);
    }

    return response;
  }

  /**
   * Fallback version checker when memx-resolver is not configured.
   * Uses the last ack'd version as current (assumes no changes).
   */
  private getFallbackVersions(docIds: string[]): Array<{ doc_id: string; version: string; exists: boolean }> {
    return docIds.map(docId => ({
      doc_id: docId,
      version: new Date().toISOString().split('T')[0] ?? 'unknown',
      exists: !docId.includes('missing'),
    }));
  }

  /**
   * @deprecated Use async staleCheck instead. This method is kept for backwards compatibility.
   */
  staleCheckSync(taskId: string, request: StaleCheckRequest): StaleCheckResponse {
    const task = this.requireTask(taskId);

    const response = ResolverService.checkStaleSync(
      taskId,
      task.resolver_refs,
      request,
      this.getFallbackVersions.bind(this),
    );

    if (response.stale.length > 0) {
      if (!task.resolver_refs) {
        task.resolver_refs = {};
      }
      task.resolver_refs.stale_status = 'stale';
      this.touchTask(task);
    }

    return response;
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
    this.touchTask(task);

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

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  private touchTask(task: Task): void {
    task.version += 1;
    task.updated_at = nowIso();
  }

  // Reset concurrency state (useful for testing)
  resetConcurrency(): void {
    this.concurrencyManager.reset();
  }
}
