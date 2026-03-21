import type {
  Task,
  TaskState,
  WorkerJob,
  WorkerResult,
  DispatchRequest,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
} from '../../types.js';
import { DispatchOrchestrator } from '../../domain/dispatch/index.js';
import { LeaseManager } from '../../domain/lease/index.js';
import { RetryManager } from '../../domain/retry/index.js';
import { ConcurrencyManager } from '../../domain/concurrency/index.js';
import { CapabilityManager } from '../../domain/capability/index.js';
import { DoomLoopDetector } from '../../domain/doom-loop/index.js';
import { WorkerExecutor, GLM5Adapter } from '../../domain/worker/index.js';
import { StateMachine } from '../../domain/state-machine/index.js';
import { getMetricsCollector } from '../../monitoring/metrics/index.js';
import { getLogger } from '../../monitoring/index.js';
import { createId } from '../utils.js';

const logger = getLogger().child({ component: 'JobService' });

/**
 * Context interface for job operations that require store coordination.
 */
export interface JobOperationContext {
  requireTask: (taskId: string) => Task;
  transitionTask: (task: Task, toState: TaskState, input: {
    actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
    actor_id: string;
    reason: string;
    job_id?: string;
    artifact_ids?: string[];
  }) => { event: import('../../types.js').StateTransitionEvent; task: Task };
  emitAuditEvent: (taskId: string, eventType: import('../../types.js').AuditEventType, payload: Record<string, unknown>, options?: {
    runId?: string;
    jobId?: string;
    actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
    actorId?: string;
  }) => import('../../types.js').AuditEvent;
  applyResult: (taskId: string, result: WorkerResult) => import('../../types.js').ResultApplyResponse;
  setTask: (taskId: string, task: Task) => void;
}

/**
 * Dependencies for JobService.
 */
export interface JobServiceDeps {
  leaseManager: LeaseManager;
  retryManager: RetryManager;
  concurrencyManager: ConcurrencyManager;
  capabilityManager: CapabilityManager;
  doomLoopDetector: DoomLoopDetector;
  stateMachine: StateMachine;
}

/**
 * Service for Job dispatch, heartbeat, and polling.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class JobService {
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly retryTracker = new Map<string, number>();

  // Orchestrators and managers
  private readonly dispatchOrchestrator: DispatchOrchestrator;
  private readonly workerExecutor: WorkerExecutor;

  // Worker initialization state
  private workerInitialized = false;

  constructor(private readonly deps: JobServiceDeps) {
    this.dispatchOrchestrator = new DispatchOrchestrator({
      capabilityManager: deps.capabilityManager,
      concurrencyManager: deps.concurrencyManager,
      leaseManager: deps.leaseManager,
      retryManager: deps.retryManager,
      doomLoopDetector: deps.doomLoopDetector,
      stateMachine: deps.stateMachine,
    });

    this.workerExecutor = new WorkerExecutor({
      pollIntervalMs: 5000,
      enableFailover: true,
    });
  }

  /**
   * Initialize the worker executor with GLM-5 adapter.
   */
  async initialize(): Promise<void> {
    if (this.workerInitialized) return;

    const glm5Adapter = new GLM5Adapter({ workerType: 'claude_code' });
    this.workerExecutor.registerAdapter(glm5Adapter);
    await this.workerExecutor.initialize();
    this.workerInitialized = true;
  }

  /**
   * Dispatch a job for a task.
   */
  async dispatch(
    taskId: string,
    request: DispatchRequest,
    ctx: JobOperationContext,
  ): Promise<WorkerJob> {
    // Ensure worker is initialized
    await this.initialize();

    const task = ctx.requireTask(taskId);
    const dispatchResult = this.dispatchOrchestrator.dispatch(
      task,
      request,
      this.jobs,
      this.retryTracker,
      {
        requireTask: (id) => ctx.requireTask(id),
        transitionTask: (t, toState, input) => ctx.transitionTask(t, toState, input),
        emitAuditEvent: (tid, eventType, payload, options) => ctx.emitAuditEvent(tid, eventType, payload, options),
      },
    );

    // Handle blocked dispatch (capability mismatch)
    if (!dispatchResult.success) {
      // Transition task to blocked state with capability missing info
      const blockedTask: Task = {
        ...task,
        blocked_context: {
          resume_state: dispatchResult.resume_state,
          reason: 'insufficient_capability',
          capability_missing: dispatchResult.missing_capabilities,
          waiting_on: 'worker',
        },
      };
      ctx.transitionTask(blockedTask, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: `capability mismatch for ${request.target_stage}: missing [${dispatchResult.missing_capabilities.join(', ')}]`,
      });

      // Record capability mismatch metrics
      const metrics = getMetricsCollector();
      for (const capability of dispatchResult.missing_capabilities) {
        metrics.recordCapabilityMismatch(request.target_stage, capability);
      }

      throw new Error(`cannot dispatch: missing capabilities [${dispatchResult.missing_capabilities.join(', ')}]`);
    }

    const { job, nextState } = dispatchResult;

    // Submit job to worker executor (GLM-5)
    const submissionResult = await this.workerExecutor.submitJob(job, 'claude_code');

    if (!submissionResult.success) {
      throw new Error(`Failed to submit job: ${submissionResult.error}`);
    }

    // Start polling for job completion in background (skip in test environment)
    // In tests, results are submitted manually via the results endpoint
    if (process.env.VITEST !== 'true') {
      this.pollJobCompletion(job.job_id, ctx);
    }

    // Create updated task with dispatch info
    const updatedTask: Task = {
      ...task,
      active_job_id: job.job_id,
      latest_job_ids: { ...(task.latest_job_ids ?? {}), [request.target_stage]: job.job_id },
      workspace_ref: job.workspace_ref,
    };

    ctx.transitionTask(updatedTask, nextState, {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: `dispatched ${request.target_stage} job`,
      job_id: job.job_id,
    });
    return job;
  }

  /**
   * Poll for job completion and apply results.
   */
  private async pollJobCompletion(jobId: string, ctx: JobOperationContext): Promise<void> {
    try {
      const result = await this.workerExecutor.waitForJob(jobId, 600000);
      // Apply result when job completes
      ctx.applyResult(this.jobs.get(jobId)?.task_id || '', result);
    } catch (error) {
      logger.error(error as Error, 'Job failed', { jobId });
    }
  }

  /**
   * Process a heartbeat for a job.
   */
  heartbeat(jobId: string, request: JobHeartbeatRequest): JobHeartbeatResponse {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`job not found: ${jobId}`);
    }

    const response = this.deps.leaseManager.heartbeat(jobId, request.worker_id, {
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

  /**
   * Get a job by ID with its latest result.
   */
  getJob(jobId: string): { job?: WorkerJob; latest_result?: WorkerResult } {
    return {
      job: this.jobs.get(jobId),
      latest_result: this.results.get(jobId),
    };
  }

  /**
   * Get all jobs for a task.
   */
  getJobsForTask(taskId: string): WorkerJob[] {
    return Array.from(this.jobs.values()).filter(j => j.task_id === taskId);
  }

  /**
   * Store a job.
   */
  setJob(jobId: string, job: WorkerJob): void {
    this.jobs.set(jobId, job);
  }

  /**
   * Store a result.
   */
  setResult(jobId: string, result: WorkerResult): void {
    this.results.set(jobId, result);
  }

  /**
   * Get a result by job ID.
   */
  getResult(jobId: string): WorkerResult | undefined {
    return this.results.get(jobId);
  }

  /**
   * Get the jobs map for use by DispatchOrchestrator.
   */
  getJobsMap(): Map<string, WorkerJob> {
    return this.jobs;
  }

  /**
   * Get the retry tracker for use by DispatchOrchestrator.
   */
  getRetryTracker(): Map<string, number> {
    return this.retryTracker;
  }

  /**
   * Get the lease manager.
   */
  getLeaseManager(): LeaseManager {
    return this.deps.leaseManager;
  }

  /**
   * Check if a job can be dispatched with a valid lease.
   */
  canDispatchWithLease(taskId: string, targetStage: 'plan' | 'dev' | 'acceptance', getTask: (id: string) => Task | undefined): boolean {
    const task = getTask(taskId);
    if (!task) return false;

    // For developing stage, ensure lease is acquired first
    if (targetStage === 'dev' && task.state === 'planned') {
      const jobId = task.active_job_id;
      if (!jobId) return false;

      const lease = this.deps.leaseManager.getLease(jobId);
      if (!lease || this.deps.leaseManager.isExpired(jobId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clear all jobs and results (useful for testing).
   */
  clear(): void {
    this.jobs.clear();
    this.results.clear();
    this.retryTracker.clear();
  }
}