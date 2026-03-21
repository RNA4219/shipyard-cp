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
import { StateMachine } from '../domain/state-machine/index.js';
import type { TaskUpdate } from '../domain/task/index.js';
import { RunTimeoutService, RunService } from '../domain/run/index.js';
import { IntegrationOrchestrator } from '../domain/integration/index.js';
import { PublishOrchestrator } from '../domain/publish/index.js';
import { SideEffectAnalyzer } from '../domain/side-effect/index.js';
import { StaleDocsValidator } from '../domain/stale-check/index.js';
import { ResultOrchestrator } from '../domain/result/index.js';
import { DocsService } from '../domain/docs/index.js';
import { AcceptanceService } from '../domain/acceptance/index.js';
import { TrackerService } from '../domain/tracker/index.js';
import { OrphanScanner, DEFAULT_ORPHAN_CONFIG, type OrphanScanContext, type JobInfo } from '../domain/orphan/index.js';
import { getMetricsCollector } from '../monitoring/metrics/index.js';
import { getLogger } from '../monitoring/index.js';
import { ORPHAN_SCAN_INTERVAL_MS, ShipyardError, ErrorCodes } from '../constants/index.js';
import type { Decision, OpenQuestion, ContextBundle } from 'agent-taskstate-js';
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
import { AuditService } from './services/audit-service.js';
import { TaskService, type TaskOperationContext } from './services/task-service.js';
import { JobService, type JobOperationContext } from './services/job-service.js';
import { DecisionService } from './services/decision-service.js';

// =============================================================================
// ControlPlaneStore
// =============================================================================

const logger = getLogger().child({ component: 'ControlPlane' });

export class ControlPlaneStore {
  // Event storage (kept here for coordination)
  private readonly events = new Map<string, StateTransitionEvent[]>();

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
  private readonly stateMachine = new StateMachine();

  // Orchestrators
  private readonly integrationOrchestrator = new IntegrationOrchestrator({
    repoPolicyService: this.repoPolicyService,
    riskIntegrationService: this.riskIntegrationService,
    checklistService: this.checklistService,
  });
  private readonly publishOrchestrator = new PublishOrchestrator({
    repoPolicyService: this.repoPolicyService,
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

  // Extracted services
  private readonly auditService = new AuditService();
  private readonly taskService = new TaskService();
  private readonly jobService = new JobService({
    leaseManager: this.leaseManager,
    retryManager: this.retryManager,
    concurrencyManager: this.concurrencyManager,
    capabilityManager: this.capabilityManager,
    doomLoopDetector: this.doomLoopDetector,
    stateMachine: this.stateMachine,
  });
  private readonly decisionService = new DecisionService();

  // Orphan scanner for detecting and recovering orphaned jobs
  private orphanScanner?: OrphanScanner;

  // ---------------------------------------------------------------------------
  // Context Builders for Service Coordination
  // ---------------------------------------------------------------------------

  private getTaskOperationContext(): TaskOperationContext {
    return {
      emitAuditEvent: (taskId, eventType, payload, options) =>
        this.auditService.emitAuditEvent(taskId, eventType, payload, options),
      recordEvent: (event) => this.recordEvent(event),
    };
  }

  private getJobOperationContext(): JobOperationContext {
    return {
      requireTask: (taskId) => this.taskService.requireTask(taskId),
      transitionTask: (task, toState, input) =>
        this.taskService.transitionTask(task, toState, input, this.getTaskOperationContext()),
      emitAuditEvent: (taskId, eventType, payload, options) =>
        this.auditService.emitAuditEvent(taskId, eventType, payload, options),
      applyResult: (taskId, result) => this.applyResult(taskId, result),
      setTask: (taskId, task) => this.taskService.setTask(taskId, task),
    };
  }

  private recordEvent(event: StateTransitionEvent): void {
    const existing = this.events.get(event.task_id) ?? [];
    existing.push(event);
    this.events.set(event.task_id, existing);
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the worker executor with GLM-5 adapter
   */
  async initialize(): Promise<void> {
    await this.jobService.initialize();
  }

  /**
   * Start the orphan scanner for periodic lease expiry checks.
   */
  startOrphanScanner(intervalMs: number = ORPHAN_SCAN_INTERVAL_MS): void {
    if (this.orphanScanner) {
      return; // Already running
    }

    const metrics = getMetricsCollector();

    const orphanContext: OrphanScanContext = {
      getActiveJobs: () => this.getActiveJobsForOrphanScan(),
      retryJob: (taskId: string, stage: 'plan' | 'dev' | 'acceptance') => this.retryOrphanedJob(taskId, stage),
      blockTask: (taskId: string, reason: string, resumeState: string, orphanedRun: boolean) =>
        this.blockOrphanedTask(taskId, reason, resumeState, orphanedRun),
      emitAuditEvent: (taskId: string, eventType: string, payload: Record<string, unknown>) =>
        this.auditService.emitAuditEvent(taskId, eventType as AuditEventType, payload),
      recordLeaseExpired: (stage: string) => metrics.recordLeaseExpired(stage),
      recordOrphanRecovered: (stage: string, recoveryAction: 'retry' | 'block' | 'fail') =>
        metrics.recordOrphanRecovered(stage, recoveryAction),
    };

    this.orphanScanner = new OrphanScanner(orphanContext, DEFAULT_ORPHAN_CONFIG);
    this.orphanScanner.start(intervalMs);
  }

  /**
   * Stop the orphan scanner.
   */
  stopOrphanScanner(): void {
    if (this.orphanScanner) {
      this.orphanScanner.stop();
      this.orphanScanner = undefined;
    }
  }

  /**
   * Get active jobs for orphan scanning.
   */
  private getActiveJobsForOrphanScan(): JobInfo[] {
    const activeStates: TaskState[] = ['planning', 'developing', 'accepting', 'integrating', 'publishing'];
    const jobs: JobInfo[] = [];

    for (const task of this.taskService.getAllTasks()) {
      if (!activeStates.includes(task.state) || !task.active_job_id) {
        continue;
      }

      const job = this.jobService.getJob(task.active_job_id).job;
      if (!job || !job.lease_expires_at) {
        continue;
      }

      const lease = this.leaseManager.getLease(task.active_job_id);
      if (!lease) {
        continue;
      }

      jobs.push({
        job_id: task.active_job_id,
        task_id: task.task_id,
        stage: this.taskStateToStage(task.state),
        lease_expires_at: lease.lease_expires_at,
        last_heartbeat_at: lease.last_heartbeat_at,
        retry_count: task.retry_counts?.[job.stage] ?? 0,
      });
    }

    return jobs;
  }

  /**
   * Map task state to stage for orphan detection.
   */
  private taskStateToStage(state: TaskState): 'plan' | 'dev' | 'acceptance' | 'integrating' | 'publishing' {
    const mapping: Record<TaskState, 'plan' | 'dev' | 'acceptance' | 'integrating' | 'publishing'> = {
      queued: 'plan',
      planning: 'plan',
      planned: 'plan',
      developing: 'dev',
      dev_completed: 'dev',
      accepting: 'acceptance',
      accepted: 'acceptance',
      rework_required: 'dev',
      integrating: 'integrating',
      integrated: 'integrating',
      publish_pending_approval: 'publishing',
      publishing: 'publishing',
      published: 'publishing',
      cancelled: 'plan',
      failed: 'plan',
      blocked: 'plan',
    };
    return mapping[state];
  }

  /**
   * Retry an orphaned job.
   */
  private async retryOrphanedJob(taskId: string, stage: 'plan' | 'dev' | 'acceptance'): Promise<void> {
    const task = this.taskService.getTask(taskId);
    if (!task) return;

    // Dispatch a new job for the task
    this.dispatch(taskId, { target_stage: stage }).catch(error => {
      logger.error(error, 'Failed to retry orphaned job', { taskId });
    });
  }

  /**
   * Block an orphaned task.
   */
  private blockOrphanedTask(taskId: string, reason: string, resumeState: string, orphanedRun: boolean): void {
    const task = this.taskService.getTask(taskId);
    if (!task) return;

    // Transition to blocked state
    this.taskService.transitionTask(task, 'blocked', {
      actor_type: 'control_plane',
      actor_id: 'orphan_scanner',
      reason: reason,
    }, this.getTaskOperationContext());

    // Update blocked context
    const updatedTask = this.taskService.getTask(taskId);
    if (updatedTask) {
      this.taskService.updateTask(taskId, {
        blocked_context: {
          resume_state: resumeState as 'planning' | 'developing' | 'accepting' | 'integrating' | 'integrated' | 'publishing',
          reason: reason,
          orphaned_run: orphanedRun,
        },
      });
    }
  }

  /**
   * Perform a manual orphan scan.
   */
  scanForOrphans(): { scanned: number; orphans_detected: number; recovery_actions: Array<{ job_id: string; task_id: string; action: 'retry' | 'block'; reason: string }> } {
    const metrics = getMetricsCollector();

    if (!this.orphanScanner) {
      // Create a temporary scanner for one-time scan
      const orphanContext: OrphanScanContext = {
        getActiveJobs: () => this.getActiveJobsForOrphanScan(),
        retryJob: (taskId: string, stage: 'plan' | 'dev' | 'acceptance') => this.retryOrphanedJob(taskId, stage),
        blockTask: (taskId: string, reason: string, resumeState: string, orphanedRun: boolean) =>
          this.blockOrphanedTask(taskId, reason, resumeState, orphanedRun),
        emitAuditEvent: (taskId: string, eventType: string, payload: Record<string, unknown>) =>
          this.auditService.emitAuditEvent(taskId, eventType as AuditEventType, payload),
        recordLeaseExpired: (stage: string) => metrics.recordLeaseExpired(stage),
        recordOrphanRecovered: (stage: string, recoveryAction: 'retry' | 'block' | 'fail') =>
          metrics.recordOrphanRecovered(stage, recoveryAction),
      };

      const scanner = new OrphanScanner(orphanContext, DEFAULT_ORPHAN_CONFIG);
      return scanner.scan();
    }

    return this.orphanScanner.scan();
  }

  /**
   * Check if a job can be dispatched (has valid lease for developing state).
   */
  canDispatchWithLease(taskId: string, targetStage: 'plan' | 'dev' | 'acceptance'): boolean {
    return this.jobService.canDispatchWithLease(taskId, targetStage, (id) => this.taskService.getTask(id));
  }

  // ---------------------------------------------------------------------------
  // State Storage - Task Operations (delegated to TaskService)
  // ---------------------------------------------------------------------------

  createTask(input: CreateTaskRequest): Task {
    return this.taskService.createTask(input, this.getTaskOperationContext());
  }

  getTask(taskId: string): Task | undefined {
    return this.taskService.getTask(taskId);
  }

  listTasks(options?: { limit?: number; offset?: number; state?: TaskState[] }): Task[] {
    return this.taskService.listTasks(options);
  }

  requireTask(taskId: string): Task {
    return this.taskService.requireTask(taskId);
  }

  touchTask(task: Task): void {
    this.taskService.touchTask(task);
  }

  updateTask(taskId: string, update: TaskUpdate): void {
    this.taskService.updateTask(taskId, update);
  }

  // ---------------------------------------------------------------------------
  // State Storage - Job Operations (delegated to JobService)
  // ---------------------------------------------------------------------------

  getJob(jobId: string): { job?: WorkerJob; latest_result?: WorkerResult } {
    return this.jobService.getJob(jobId);
  }

  listEvents(taskId: string): StateTransitionEvent[] {
    return this.events.get(taskId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Dispatch (delegated to JobService)
  // ---------------------------------------------------------------------------

  async dispatch(taskId: string, request: DispatchRequest): Promise<WorkerJob> {
    return this.jobService.dispatch(taskId, request, this.getJobOperationContext());
  }

  heartbeat(jobId: string, request: JobHeartbeatRequest): JobHeartbeatResponse {
    return this.jobService.heartbeat(jobId, request);
  }

  // ---------------------------------------------------------------------------
  // Result Handling
  // ---------------------------------------------------------------------------

  applyResult(taskId: string, result: WorkerResult): ResultApplyResponse {
    const task = this.requireTask(taskId);

    // Idempotent handling: if job already completed (no active_job_id or different job),
    // return current task state without error
    if (!task.active_job_id) {
      // Job already completed by another process, return current state
      return {
        task,
        emitted_events: [],
        next_action: 'none',
      };
    }

    if (task.active_job_id !== result.job_id) {
      // Different job is now active, this result is stale - return success idempotently
      return {
        task,
        emitted_events: [],
        next_action: 'none',
      };
    }

    if (result.typed_ref !== task.typed_ref) {
      throw ShipyardError.fromCode(ErrorCodes.TYPED_REF_MISMATCH, { expected: task.typed_ref, actual: result.typed_ref });
    }

    const job = this.jobService.getJob(result.job_id).job;
    if (!job) {
      throw ShipyardError.fromCode(ErrorCodes.JOB_NOT_FOUND);
    }

    // Store result
    this.jobService.setResult(result.job_id, result);

    // Apply result through orchestrator (returns immutable updates)
    const response = this.resultOrchestrator.applyResult(
      result,
      task,
      job,
      this.jobService.getRetryTracker(),
      {
        transitionTask: (t, toState, input) =>
          this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
        emitAuditEvent: (tid, eventType, payload, options) =>
          this.auditService.emitAuditEvent(tid, eventType, payload, options),
        setTask: (taskId, task) => this.taskService.setTask(taskId, task),
        completeAcceptance: (taskId, request) => {
          this.completeAcceptance(taskId, request);
          return this.requireTask(taskId);
        },
      },
    );

    // Update the task in store with the returned task
    this.taskService.setTask(response.task.task_id, response.task);

    return response;
  }

  // ---------------------------------------------------------------------------
  // Acceptance
  // ---------------------------------------------------------------------------

  completeAcceptance(taskId: string, request: CompleteAcceptanceRequest): CompleteAcceptanceResponse {
    return this.acceptanceService.completeAcceptance(taskId, request, {
      requireTask: (id) => this.requireTask(id),
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
      updateTask: (id, update) => this.updateTask(id, update),
      emitAuditEvent: (tid, eventType, payload) =>
        this.auditService.emitAuditEvent(tid, eventType, payload),
    });
  }

  // ---------------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------------

  integrate(taskId: string, baseSha: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'accepted') {
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'accepted', current: task.state });
    }

    return this.integrationOrchestrator.startIntegration(task, baseSha, {
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
    });
  }

  completeIntegrate(taskId: string, request: CompleteIntegrateRequest): IntegrateResponse {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'integrating', current: task.state });
    }

    if (!task.integration) {
      throw ShipyardError.fromCode(ErrorCodes.INTEGRATION_STATE_NOT_FOUND);
    }

    const result = this.integrationOrchestrator.completeIntegration(task, request, {
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
    });

    // Emit audit event for main update
    if (request.main_updated_sha) {
      this.auditService.emitAuditEvent(task.task_id, 'run.main_updated', {
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
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'integrated', current: task.state });
    }

    // Idempotency check: if same key was used before, return the existing task
    if (request.idempotency_key) {
      const existingTaskId = this.publishIdempotencyKeys.get(request.idempotency_key);
      if (existingTaskId) {
        const existingTask = this.taskService.getTask(existingTaskId);
        if (existingTask) {
          // Emit audit event for idempotent request
          this.auditService.emitAuditEvent(task.task_id, 'run.publishIdempotent', {
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
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
    });

    // Emit audit event for publish request
    this.auditService.emitAuditEvent(task.task_id, 'run.publishRequested', {
      mode: request.mode,
      idempotency_key: request.idempotency_key,
      approval_required: task.publish_plan?.approval_required,
    });

    return result;
  }

  approvePublish(taskId: string, approvalToken: string): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publish_pending_approval') {
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'publish_pending_approval', current: task.state });
    }

    const result = this.publishOrchestrator.approvePublish(task, approvalToken, {
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
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
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'publishing', current: task.state });
    }

    const result = this.publishOrchestrator.completePublish(task, request, {
      transitionTask: (t, toState, input) =>
        this.taskService.transitionTask(t, toState, input, this.getTaskOperationContext()),
    });

    // Emit audit event for publish completion
    this.auditService.emitAuditEvent(task.task_id, 'run.publishCompleted', {
      external_refs: request.external_refs,
      rollback_notes: request.rollback_notes,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Timeout Management
  // ---------------------------------------------------------------------------

  checkTimeouts(): Task[] {
    return this.runTimeoutService.checkTimeouts(this.taskService.getAllTasks(), {
      transitionTask: (task, toState, input) =>
        this.taskService.transitionTask(task, toState, input, this.getTaskOperationContext()),
    });
  }

  updateIntegrationProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'integrating') {
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'integrating', current: task.state });
    }
    this.runTimeoutService.updateIntegrationProgress(task, progress);
    return task;
  }

  updatePublishProgress(taskId: string, progress: number): Task {
    const task = this.requireTask(taskId);
    if (task.state !== 'publishing') {
      throw ShipyardError.fromCode(ErrorCodes.TASK_INVALID_STATE, { expected: 'publishing', current: task.state });
    }
    this.runTimeoutService.updatePublishProgress(task, progress);
    return task;
  }

  getActiveRuns(): Array<{ task: Task; run: IntegrationRun | PublishRun; type: 'integration' | 'publish' }> {
    return this.runTimeoutService.getActiveRuns(this.taskService.getAllTasks());
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  cancel(taskId: string): Task {
    return this.taskService.cancel(taskId, this.getTaskOperationContext());
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

  async linkTracker(taskId: string, request: TrackerLinkRequest): Promise<TrackerLinkResponse> {
    return TrackerService.linkTracker(taskId, request, this.getTaskUpdateContext());
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  recordTransition(taskId: string, event: StateTransitionEvent): StateTransitionEvent {
    return this.taskService.recordTransition(taskId, event, this.getTaskOperationContext());
  }

  // ---------------------------------------------------------------------------
  // Audit Events (delegated to AuditService)
  // ---------------------------------------------------------------------------

  listAuditEvents(taskId: string): AuditEvent[] {
    return this.auditService.listAuditEvents(taskId);
  }

  // ---------------------------------------------------------------------------
  // Run Read Model (delegated to RunService)
  // ---------------------------------------------------------------------------

  private getRunContext() {
    return {
      getTask: (id: string) => this.taskService.getTask(id),
      getEvents: (id: string) => this.events.get(id) ?? [],
      getAuditEvents: (id: string) => this.auditService.getAuditEvents(id),
    };
  }

  listRuns(options?: { limit?: number; offset?: number; status?: RunStatus[] }): Run[] {
    return this.runService.listRuns(this.taskService.getAllTasks(), this.getRunContext(), options);
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
    const task = this.taskService.getTask(runId);
    if (!task) {
      throw ShipyardError.fromCode(ErrorCodes.RUN_NOT_FOUND, { runId });
    }

    const ctx = this.getRunContext();
    const run = this.runService.taskToRun(task, ctx);
    const events = ctx.getEvents(task.task_id);
    const auditEvents = ctx.getAuditEvents(task.task_id);
    const checkpoints = this.getTaskCheckpoints(task.task_id);
    const jobs = this.jobService.getJobsForTask(task.task_id);

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

  // Reset concurrency state (useful for testing)
  resetConcurrency(): void {
    this.concurrencyManager.reset();
  }

  // ---------------------------------------------------------------------------
  // Decision & Question Management (delegated to DecisionService)
  // ---------------------------------------------------------------------------

  /**
   * Create a decision for a task
   */
  async createDecision(taskId: string, question: string, options: string[]): Promise<Decision> {
    this.requireTask(taskId); // Validate task exists
    return this.decisionService.createDecision(taskId, question, options);
  }

  /**
   * Get all decisions for a task
   */
  async getDecisions(taskId: string): Promise<Decision[]> {
    return this.decisionService.getDecisions(taskId);
  }

  /**
   * Resolve a decision
   */
  async resolveDecision(decisionId: string, chosen: string, rationale?: string): Promise<Decision> {
    return this.decisionService.resolveDecision(decisionId, chosen, rationale);
  }

  /**
   * Reject a decision
   */
  async rejectDecision(decisionId: string, rationale: string): Promise<Decision> {
    return this.decisionService.rejectDecision(decisionId, rationale);
  }

  /**
   * Create an open question for a task
   */
  async createOpenQuestion(taskId: string, question: string): Promise<OpenQuestion> {
    this.requireTask(taskId); // Validate task exists
    return this.decisionService.createOpenQuestion(taskId, question);
  }

  /**
   * Get all open questions for a task
   */
  async getOpenQuestions(taskId: string): Promise<OpenQuestion[]> {
    return this.decisionService.getOpenQuestions(taskId);
  }

  /**
   * Answer an open question
   */
  async answerOpenQuestion(questionId: string, answer: string): Promise<OpenQuestion> {
    return this.decisionService.answerOpenQuestion(questionId, answer);
  }

  /**
   * Defer an open question
   */
  async deferOpenQuestion(questionId: string): Promise<OpenQuestion> {
    return this.decisionService.deferOpenQuestion(questionId);
  }

  /**
   * Generate a context bundle for task recovery
   */
  async generateContextBundle(
    taskId: string,
    purpose: 'continue_work' | 'review_prepare' | 'resume_after_block' | 'decision_support' | 'other',
  ): Promise<ContextBundle> {
    const task = this.requireTask(taskId);
    return this.decisionService.generateContextBundle(taskId, purpose, task);
  }

  /**
   * Get the latest context bundle for a task
   */
  async getLatestContextBundle(taskId: string): Promise<ContextBundle | null> {
    return this.decisionService.getLatestContextBundle(taskId);
  }
}
