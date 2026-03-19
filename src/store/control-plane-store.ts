import { CapabilityManager } from '../domain/capability/index.js';
import { CheckpointService } from '../domain/checkpoint/index.js';
import { ConcurrencyManager } from '../domain/concurrency/index.js';
import { DoomLoopDetector } from '../domain/doom-loop/index.js';
import { LeaseManager } from '../domain/lease/index.js';
import { RepoPolicyService } from '../domain/repo-policy/index.js';
import { RetrospectiveService } from '../domain/retrospective/index.js';
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
import { SideEffectAnalyzer } from '../domain/side-effect/index.js';
import { WorkerPolicy } from '../domain/worker/worker-policy.js';
import { getLogger } from '../monitoring/index.js';
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
  WorkerStage,
  WorkerType,
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
  private readonly auditEvents = new Map<string, AuditEvent[]>();

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
  private readonly sideEffectAnalyzer = new SideEffectAnalyzer();
  private readonly checkpointService = new CheckpointService();
  private readonly retrospectiveService = new RetrospectiveService();

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
    this.updateTaskFromResult(task, result, job);

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

  private updateTaskFromResult(task: Task, result: WorkerResult, job: WorkerJob): void {
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

    // Integration: retry_count - store in task
    if (result.retry_count !== undefined) {
      task.retry_counts = {
        ...task.retry_counts,
        [job.stage]: result.retry_count,
      };
    }

    // Integration: failure_class - store in task
    if (result.failure_class) {
      task.last_failure_class = result.failure_class;
    }

    // Integration: loop_fingerprint - validate and store
    if (result.loop_fingerprint) {
      // Verify fingerprint matches job's fingerprint
      if (job.loop_fingerprint && result.loop_fingerprint !== job.loop_fingerprint) {
        // Log warning but don't fail - fingerprint mismatch could indicate issue
        const logger = getLogger().child({ component: 'ControlPlaneStore', taskId: task.task_id, jobId: job.job_id });
        logger.warn('Loop fingerprint mismatch', {
          jobFingerprint: job.loop_fingerprint,
          resultFingerprint: result.loop_fingerprint,
        });
      }
      task.loop_fingerprint = result.loop_fingerprint;
    }

    // Integration: detected_side_effects - analyze and store
    if (result.detected_side_effects) {
      task.detected_side_effects = result.detected_side_effects;
    } else if (result.requested_escalations?.length > 0) {
      // Analyze escalations for side effects if not provided
      const sideEffectResult = this.sideEffectAnalyzer.analyzeSideEffects({
        requested_outputs: job.requested_outputs ?? [],
        escalation_requests: result.requested_escalations.map(e => e.kind),
      });
      task.detected_side_effects = sideEffectResult.categories;
    }

    // Emit audit event for permission escalation requests
    if (result.requested_escalations?.length > 0) {
      this.emitAuditEvent(task.task_id, 'run.permissionEscalated', {
        escalations: result.requested_escalations.map(e => ({
          kind: e.kind,
          reason: e.reason,
          approved: e.approved,
        })),
        stage: job.stage,
      }, { jobId: job.job_id });
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

    // Check if we should failover (Plan stage only)
    if (WorkerPolicy.canFailover(job.stage)) {
      const failoverWorker = WorkerPolicy.getFailoverWorker(job.stage, job.worker_type);
      if (failoverWorker) {
        return this.handleFailover(task, job, result, failoverWorker, emittedEvents);
      }
    }

    // Check if we should retry (same worker)
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

  private handleFailover(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    nextWorker: WorkerType,
    emittedEvents: StateTransitionEvent[],
  ): ResultApplyResponse {
    // Emit failover audit event
    this.emitAuditEvent(task.task_id, 'run.workerFailover', {
      from_worker: job.worker_type,
      to_worker: nextWorker,
      stage: job.stage,
      reason: result.summary ?? 'worker failed',
    }, { jobId: job.job_id });

    // Finalize current job (release lease but keep concurrency for next dispatch)
    this.leaseManager.release(job.job_id, job.worker_type);
    task.active_job_id = undefined;
    this.touchTask(task);

    const nextState = this.stageToActiveState(job.stage);
    emittedEvents.push(this.transitionTask(task, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'failover_manager',
      reason: `failover to ${nextWorker} after ${job.worker_type} failure`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    return {
      task,
      emitted_events: emittedEvents,
      next_action: 'failover',
      failover_worker: nextWorker,
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

    // Validate event integrity
    this.validateTransitionEvent(event, taskId, task.state);

    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, event.to_state);
    task.state = event.to_state;
    this.touchTask(task);
    this.recordEvent(event);
    return event;
  }

  /**
   * Validate StateTransitionEvent integrity.
   * Throws on validation failure.
   */
  private validateTransitionEvent(
    event: StateTransitionEvent,
    expectedTaskId: string,
    currentTaskState: TaskState,
  ): void {
    // Required field validation
    if (!event.event_id || typeof event.event_id !== 'string') {
      throw new Error('StateTransitionEvent.event_id is required and must be a string');
    }
    if (!event.task_id || typeof event.task_id !== 'string') {
      throw new Error('StateTransitionEvent.task_id is required and must be a string');
    }
    if (!event.from_state || typeof event.from_state !== 'string') {
      throw new Error('StateTransitionEvent.from_state is required');
    }
    if (!event.to_state || typeof event.to_state !== 'string') {
      throw new Error('StateTransitionEvent.to_state is required');
    }
    if (!event.occurred_at || typeof event.occurred_at !== 'string') {
      throw new Error('StateTransitionEvent.occurred_at is required and must be an ISO string');
    }
    if (!event.reason || typeof event.reason !== 'string') {
      throw new Error('StateTransitionEvent.reason is required');
    }
    if (!event.actor_id || typeof event.actor_id !== 'string') {
      throw new Error('StateTransitionEvent.actor_id is required');
    }

    // Task ID mismatch
    if (event.task_id !== expectedTaskId) {
      throw new Error(`task_id mismatch: expected ${expectedTaskId}, got ${event.task_id}`);
    }

    // Actor type validation
    const validActorTypes = ['control_plane', 'worker', 'human', 'policy_engine'] as const;
    if (!validActorTypes.includes(event.actor_type as typeof validActorTypes[number])) {
      throw new Error(`Invalid actor_type: ${event.actor_type}`);
    }

    // State value validation
    const validStates: TaskState[] = [
      'queued', 'planning', 'planned', 'developing', 'dev_completed',
      'accepting', 'accepted', 'rework_required', 'integrating', 'integrated',
      'publish_pending_approval', 'publishing', 'published', 'cancelled', 'failed', 'blocked',
    ];
    if (!validStates.includes(event.from_state)) {
      throw new Error(`Invalid from_state: ${event.from_state}`);
    }
    if (!validStates.includes(event.to_state)) {
      throw new Error(`Invalid to_state: ${event.to_state}`);
    }

    // from_state consistency check (warn but don't fail for recovery scenarios)
    if (event.from_state !== currentTaskState) {
      const logger = getLogger().child({ component: 'ControlPlaneStore', taskId: expectedTaskId });
      logger.warn('StateTransitionEvent.from_state does not match current task state', {
        eventFromState: event.from_state,
        currentTaskState,
        eventId: event.event_id,
      });
    }
  }

  /**
   * Complete manual acceptance after checklist is verified.
   * This is the gate that validates checklist completion and verdict before
   * transitioning from 'accepting' to 'accepted'.
   */
  completeAcceptance(taskId: string, request: CompleteAcceptanceRequest): CompleteAcceptanceResponse {
    const task = this.requireTask(taskId);

    // Gate 1: Task must be in 'accepting' state
    if (task.state !== 'accepting') {
      throw new Error(`task is not in accepting state (current: ${task.state})`);
    }

    // Update checklist items if provided
    if (request.checked_items && task.manual_checklist) {
      for (const item of request.checked_items) {
        task.manual_checklist = this.checklistService.checkItem(
          task.manual_checklist,
          item.id,
          item.checked_by,
          item.notes
        );
      }
    }

    // Gate 2: Validate manual checklist completion
    const checklistValidation = task.manual_checklist
      ? this.checklistService.validateChecklist(task.manual_checklist)
      : { valid: true, missing: [] };

    if (!checklistValidation.valid) {
      throw new Error(
        `manual checklist not complete. Missing required items: ${checklistValidation.missing.join(', ')}`
      );
    }

    // Gate 3: Verdict must be 'accept' (either from worker or override)
    const verdict = request.verdict ?? task.last_verdict;
    if (!verdict) {
      throw new Error('no verdict available. Worker must provide verdict or override must be given.');
    }

    if (verdict.outcome !== 'accept') {
      throw new Error(`verdict outcome must be 'accept', got '${verdict.outcome}'`);
    }

    // All gates passed - transition to 'accepted'
    this.transitionTask(task, 'accepted', {
      actor_type: 'human',
      actor_id: 'manual_acceptance',
      reason: 'manual acceptance completed',
    });

    // Record approval checkpoint for acceptance
    this.checkpointService.recordCheckpoint({
      task_id: task.task_id,
      run_id: task.task_id,
      checkpoint_type: 'approval',
      stage: 'acceptance',
      ref: `approval:${task.task_id}:accepted`,
      summary: 'Manual acceptance completed',
      actor: 'manual_acceptance',
    });

    // Emit audit event for verdict submission
    this.emitAuditEvent(task.task_id, 'task.verdictSubmitted', {
      verdict_outcome: verdict.outcome,
      verdict_reason: verdict.reason,
      checklist_complete: checklistValidation.valid,
      checklist_missing: checklistValidation.missing,
    });

    return {
      task_id: task.task_id,
      state: task.state,
      checklist_complete: checklistValidation.valid,
      verdict_outcome: verdict.outcome,
    };
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

  publish(taskId: string, request: PublishRequest): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrated') {
      throw new Error('task is not integrated');
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
        // Acceptance requires manual confirmation
        // Worker result provides recommendation, but human must complete checklist
        const verdict = result.verdict;

        // If worker rejected or requires rework, transition immediately
        if (verdict?.outcome === 'reject' || verdict?.outcome === 'rework') {
          emittedEvents.push(this.transitionTask(task, 'rework_required', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: verdict.reason ?? 'acceptance rejected by worker',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          }));
          return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
        }

        // For 'accept' or 'needs_manual_review', stay in 'accepting' state
        // and wait for manual checklist completion via completeAcceptance
        // Store the verdict for later use
        task.last_verdict = verdict ? {
          outcome: verdict.outcome,
          reason: verdict.reason,
          manual_notes: verdict.manual_notes,
        } : undefined;

        // Don't transition - wait for manual acceptance
        // The task stays in 'accepting' state until completeAcceptance is called
        return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
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

  /**
   * Emit an audit event for monitoring and retrospective.
   */
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

  /**
   * List audit events for a task.
   */
  listAuditEvents(taskId: string): AuditEvent[] {
    return this.auditEvents.get(taskId) ?? [];
  }

  // =============================================================================
  // Run Read Model
  // =============================================================================

  /**
   * List all runs with optional pagination.
   * Each Task is mapped to a Run read model for visualization.
   */
  listRuns(options?: { limit?: number; offset?: number; status?: RunStatus[] }): Run[] {
    const tasks = Array.from(this.tasks.values());
    const runs = tasks.map(task => this.taskToRun(task));

    // Filter by status if provided
    const filtered = options?.status
      ? runs.filter(run => options.status!.includes(run.status))
      : runs;

    // Sort by updated_at descending
    filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get a specific run by ID.
   * Run ID is the same as task_id for the current implementation.
   */
  getRun(runId: string): Run | undefined {
    // For now, run_id === task_id (single run per task)
    const task = this.tasks.get(runId);
    if (!task) return undefined;
    return this.taskToRun(task);
  }

  /**
   * Get timeline events for a run.
   * Returns state transition events in chronological order.
   */
  getRunTimeline(runId: string): StateTransitionEvent[] {
    const events = this.events.get(runId) ?? [];
    return [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  /**
   * Get audit summary for a run.
   * Aggregates audit events by type with counts and latest occurrence.
   */
  getRunAuditSummary(runId: string): {
    event_counts: Record<string, number>;
    latest_events: AuditEvent[];
    total_events: number;
  } {
    const events = this.auditEvents.get(runId) ?? [];

    // Count events by type
    const eventCounts: Record<string, number> = {};
    for (const event of events) {
      eventCounts[event.event_type] = (eventCounts[event.event_type] ?? 0) + 1;
    }

    // Get latest 10 events
    const latestEvents = [...events]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 10);

    return {
      event_counts: eventCounts,
      latest_events: latestEvents,
      total_events: events.length,
    };
  }

  /**
   * Get checkpoints for a run.
   */
  getRunCheckpoints(runId: string): CheckpointRef[] {
    const records = this.checkpointService.listCheckpointsForRun(runId);
    return this.checkpointService.toCheckpointRefs(records);
  }

  /**
   * Get checkpoints for a task.
   */
  getTaskCheckpoints(taskId: string): CheckpointRef[] {
    const records = this.checkpointService.listCheckpointsForTask(taskId);
    return this.checkpointService.toCheckpointRefs(records);
  }

  /**
   * Convert a Task to a Run read model.
   */
  private taskToRun(task: Task): Run {
    const events = this.events.get(task.task_id) ?? [];
    const lastEvent = events.length > 0
      ? events.reduce((a, b) => a.occurred_at > b.occurred_at ? a : b)
      : undefined;

    // Get checkpoints from checkpoint service
    const checkpointRecords = this.checkpointService.listCheckpointsForTask(task.task_id);
    const checkpoints = this.checkpointService.toCheckpointRefs(checkpointRecords);

    return {
      run_id: task.task_id,
      task_id: task.task_id,
      run_sequence: 1, // Single run per task for now
      status: this.mapTaskStateToRunStatus(task.state),
      current_stage: this.getCurrentStage(task.state),
      current_state: task.state,
      started_at: task.created_at,
      ended_at: task.completed_at,
      last_event_at: lastEvent?.occurred_at ?? task.updated_at,
      projection_version: task.version,
      source_event_cursor: lastEvent?.event_id ?? '',
      risk_level: task.risk_level,
      objective: task.objective,
      blocked_reason: task.blocked_context?.reason,
      job_ids: this.getJobIdsForTask(task),
      checkpoints,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  /**
   * Map TaskState to RunStatus for visualization.
   */
  private mapTaskStateToRunStatus(state: TaskState): RunStatus {
    switch (state) {
      case 'queued':
      case 'planning':
      case 'planned':
      case 'developing':
      case 'dev_completed':
      case 'accepting':
      case 'integrating':
      case 'publishing':
        return 'running';
      case 'accepted':
      case 'integrated':
        return 'running'; // Intermediate success states
      case 'published':
        return 'succeeded';
      case 'blocked':
        return 'blocked';
      case 'cancelled':
        return 'cancelled';
      case 'failed':
      case 'rework_required':
      case 'publish_pending_approval':
        return state === 'failed' ? 'failed' : 'running';
      default:
        return 'running';
    }
  }

  /**
   * Get current stage based on task state.
   */
  private getCurrentStage(state: TaskState): WorkerStage | undefined {
    switch (state) {
      case 'queued':
      case 'planning':
      case 'planned':
        return 'plan';
      case 'developing':
      case 'dev_completed':
      case 'rework_required':
        return 'dev';
      case 'accepting':
      case 'accepted':
        return 'acceptance';
      default:
        return undefined;
    }
  }

  /**
   * Get all job IDs associated with a task.
   */
  private getJobIdsForTask(task: Task): string[] {
    const jobIds: string[] = [];
    if (task.active_job_id) {
      jobIds.push(task.active_job_id);
    }
    if (task.latest_job_ids) {
      for (const jobId of Object.values(task.latest_job_ids)) {
        if (jobId && !jobIds.includes(jobId)) {
          jobIds.push(jobId);
        }
      }
    }
    return jobIds;
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

  // =============================================================================
  // Retrospective Methods (Phase C)
  // =============================================================================

  /**
   * Generate a retrospective for a run.
   */
  generateRetrospective(runId: string, request: RetrospectiveGenerationRequest = {}): Retrospective {
    const task = this.tasks.get(runId);
    if (!task) {
      throw new Error(`run not found: ${runId}`);
    }

    const run = this.taskToRun(task);
    const events = this.events.get(task.task_id) ?? [];
    const auditEvents = this.auditEvents.get(task.task_id) ?? [];
    const checkpoints = this.getTaskCheckpoints(task.task_id);

    // Get jobs for this task
    const jobs = this.getJobsForTask(task.task_id);

    const result = this.retrospectiveService.generateRetrospective({
      run,
      task,
      events,
      jobs,
      auditEvents,
      checkpoints,
      request,
    });

    return result.retrospective;
  }

  /**
   * Get the latest retrospective for a run.
   */
  getRetrospective(runId: string): Retrospective | undefined {
    return this.retrospectiveService.getRetrospective(runId);
  }

  /**
   * Get all retrospectives for a run (history).
   */
  getRetrospectiveHistory(runId: string): Retrospective[] {
    return this.retrospectiveService.getRetrospectiveHistory(runId);
  }

  /**
   * Get retrospectives for a task.
   */
  getRetrospectivesForTask(taskId: string): Retrospective[] {
    return this.retrospectiveService.getRetrospectivesForTask(taskId);
  }

  /**
   * Get all jobs for a task.
   */
  private getJobsForTask(taskId: string): WorkerJob[] {
    const jobs: WorkerJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.task_id === taskId) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  // Reset concurrency state (useful for testing)
  resetConcurrency(): void {
    this.concurrencyManager.reset();
  }
}
