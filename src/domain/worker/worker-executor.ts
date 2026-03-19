import type { WorkerType, WorkerJob, WorkerResult, WorkerStage } from '../../types.js';
import {
  type WorkerAdapter,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
  type WorkerCapabilities,
} from './worker-adapter.js';
import { WorkerPolicy } from './worker-policy.js';
import { getLogger } from '../../monitoring/index.js';

/**
 * Executor event types
 */
export type ExecutorEvent =
  | { type: 'job_submitted'; job_id: string; external_job_id: string; worker_type: WorkerType }
  | { type: 'job_completed'; job_id: string; external_job_id: string; worker_type: WorkerType; result: WorkerResult }
  | { type: 'job_failed'; job_id: string; external_job_id: string; worker_type: WorkerType; error: string }
  | { type: 'job_cancelled'; job_id: string; external_job_id: string; worker_type: WorkerType }
  | { type: 'failover_started'; job_id: string; from_worker: WorkerType; to_worker: WorkerType; reason: string }
  | { type: 'worker_initialized'; worker_type: WorkerType }
  | { type: 'worker_error'; worker_type: WorkerType; error: string };

/**
 * Event listener function
 */
export type ExecutorEventListener = (event: ExecutorEvent) => void;

/**
 * Active job tracking
 */
interface ActiveJob {
  job: WorkerJob;
  external_job_id: string;
  worker_type: WorkerType;
  submitted_at: number;
  failover_count: number;
}

/**
 * WorkerExecutor configuration
 */
export interface WorkerExecutorConfig {
  /** Polling interval for job status (ms) */
  pollIntervalMs?: number;
  /** Maximum poll attempts before considering job stalled */
  maxPollAttempts?: number;
  /** Enable automatic failover for supported stages */
  enableFailover?: boolean;
  /** Callback for job lifecycle events */
  onEvent?: ExecutorEventListener;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<WorkerExecutorConfig> = {
  pollIntervalMs: 5000,
  maxPollAttempts: 120, // 10 minutes at 5s intervals
  enableFailover: true,
  onEvent: () => {},
};

/**
 * WorkerExecutor
 *
 * Coordinates multiple worker adapters, providing a unified interface for
 * job submission, polling, and cancellation. Supports automatic failover
 * for stages that have multiple workers configured.
 */
export class WorkerExecutor {
  private readonly adapters: Map<WorkerType, WorkerAdapter> = new Map();
  private readonly activeJobs: Map<string, ActiveJob> = new Map();
  private readonly config: Required<WorkerExecutorConfig>;
  private readonly logger = getLogger().child({ component: 'WorkerExecutor' });
  private pollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private initialized = false;

  constructor(config: WorkerExecutorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a worker adapter.
   */
  registerAdapter(adapter: WorkerAdapter): void {
    if (this.adapters.has(adapter.workerType)) {
      this.logger.warn({ workerType: adapter.workerType }, 'Overwriting existing adapter');
    }
    this.adapters.set(adapter.workerType, adapter);
    this.logger.info({ workerType: adapter.workerType }, 'Adapter registered');
  }

  /**
   * Get registered adapter for a worker type.
   */
  getAdapter(workerType: WorkerType): WorkerAdapter | undefined {
    return this.adapters.get(workerType);
  }

  /**
   * Initialize all registered adapters.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initPromises = Array.from(this.adapters.entries()).map(async ([workerType, adapter]) => {
      try {
        await adapter.initialize();
        this.emitEvent({ type: 'worker_initialized', worker_type: workerType });
        this.logger.info({ workerType }, 'Adapter initialized');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.emitEvent({ type: 'worker_error', worker_type: workerType, error: errorMsg });
        this.logger.error('Failed to initialize adapter', { workerType, error: errorMsg });
        throw error;
      }
    });

    await Promise.all(initPromises);
    this.initialized = true;
    this.logger.info('WorkerExecutor initialized');
  }

  /**
   * Check if executor is ready.
   */
  async isReady(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    const readyChecks = await Promise.all(
      Array.from(this.adapters.values()).map(adapter => adapter.isReady())
    );

    return readyChecks.every(ready => ready);
  }

  /**
   * Get capabilities of a specific worker.
   */
  async getCapabilities(workerType: WorkerType): Promise<WorkerCapabilities | null> {
    const adapter = this.adapters.get(workerType);
    if (!adapter) {
      return null;
    }
    return adapter.getCapabilities();
  }

  /**
   * Get all registered worker types.
   */
  getRegisteredWorkerTypes(): WorkerType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Submit a job to the appropriate worker.
   */
  async submitJob(job: WorkerJob, workerType?: WorkerType): Promise<JobSubmissionResult> {
    const targetWorker = workerType ?? WorkerPolicy.getDefaultWorker(job.stage);
    const adapter = this.adapters.get(targetWorker);

    if (!adapter) {
      return {
        success: false,
        status: 'rejected',
        error: `No adapter registered for worker type: ${targetWorker}`,
      };
    }

    const result = await adapter.submitJob(job);

    if (result.success && result.external_job_id) {
      this.activeJobs.set(job.job_id, {
        job,
        external_job_id: result.external_job_id,
        worker_type: targetWorker,
        submitted_at: Date.now(),
        failover_count: 0,
      });

      this.emitEvent({
        type: 'job_submitted',
        job_id: job.job_id,
        external_job_id: result.external_job_id,
        worker_type: targetWorker,
      });
    }

    return result;
  }

  /**
   * Poll job status.
   */
  async pollJob(jobId: string): Promise<JobPollResult> {
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob) {
      return {
        external_job_id: jobId,
        status: 'failed',
        error: 'Job not found in active jobs',
      };
    }

    const adapter = this.adapters.get(activeJob.worker_type);
    if (!adapter) {
      return {
        external_job_id: activeJob.external_job_id,
        status: 'failed',
        error: `No adapter for worker type: ${activeJob.worker_type}`,
      };
    }

    const result = await adapter.pollJob(activeJob.external_job_id);

    // Handle terminal states
    if (result.status === 'succeeded' && result.result) {
      this.emitEvent({
        type: 'job_completed',
        job_id: jobId,
        external_job_id: activeJob.external_job_id,
        worker_type: activeJob.worker_type,
        result: result.result,
      });
      this.activeJobs.delete(jobId);
    } else if (result.status === 'failed') {
      const error = result.error ?? 'Unknown error';

      // Try failover if enabled and supported
      if (this.config.enableFailover && WorkerPolicy.canFailover(activeJob.job.stage)) {
        const failoverResult = await this.tryFailover(jobId, activeJob, error);
        if (failoverResult) {
          return failoverResult;
        }
      }

      this.emitEvent({
        type: 'job_failed',
        job_id: jobId,
        external_job_id: activeJob.external_job_id,
        worker_type: activeJob.worker_type,
        error,
      });
      this.activeJobs.delete(jobId);
    }

    return result;
  }

  /**
   * Cancel a job.
   */
  async cancelJob(jobId: string): Promise<CancelResult> {
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found in active jobs',
      };
    }

    const adapter = this.adapters.get(activeJob.worker_type);
    if (!adapter) {
      return {
        success: false,
        status: 'not_found',
        error: `No adapter for worker type: ${activeJob.worker_type}`,
      };
    }

    const result = await adapter.cancelJob(activeJob.external_job_id);

    if (result.success) {
      this.emitEvent({
        type: 'job_cancelled',
        job_id: jobId,
        external_job_id: activeJob.external_job_id,
        worker_type: activeJob.worker_type,
      });
      this.activeJobs.delete(jobId);
      this.stopPolling(jobId);
    }

    return result;
  }

  /**
   * Wait for a job to complete.
   * Returns the final result or throws on failure.
   */
  async waitForJob(jobId: string, timeoutMs?: number): Promise<WorkerResult> {
    const startTime = Date.now();
    const timeout = timeoutMs ?? 600000; // 10 minutes default
    const pollInterval = this.config.pollIntervalMs;

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        await this.cancelJob(jobId);
        throw new Error(`Job ${jobId} timed out after ${elapsed}ms`);
      }

      const pollResult = await this.pollJob(jobId);

      if (pollResult.status === 'succeeded' && pollResult.result) {
        return pollResult.result;
      }

      if (pollResult.status === 'failed') {
        throw new Error(pollResult.error ?? `Job ${jobId} failed`);
      }

      if (pollResult.status === 'cancelled') {
        throw new Error(`Job ${jobId} was cancelled`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Start periodic polling for a job.
   */
  startPolling(jobId: string, callback: (result: JobPollResult) => void): void {
    if (this.pollTimers.has(jobId)) {
      return; // Already polling
    }

    const timer = setInterval(async () => {
      try {
        const result = await this.pollJob(jobId);
        callback(result);

        // Stop polling on terminal states
        if (['succeeded', 'failed', 'cancelled'].includes(result.status)) {
          this.stopPolling(jobId);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Error during polling', { jobId, error: errorMsg });
      }
    }, this.config.pollIntervalMs);

    this.pollTimers.set(jobId, timer);
  }

  /**
   * Stop polling for a job.
   */
  stopPolling(jobId: string): void {
    const timer = this.pollTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(jobId);
    }
  }

  /**
   * Get active job info.
   */
  getActiveJob(jobId: string): ActiveJob | undefined {
    return this.activeJobs.get(jobId);
  }

  /**
   * Get all active jobs.
   */
  getAllActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Shutdown all adapters.
   */
  async shutdown(): Promise<void> {
    // Stop all polling
    for (const jobId of this.pollTimers.keys()) {
      this.stopPolling(jobId);
    }

    // Cancel all active jobs
    for (const jobId of this.activeJobs.keys()) {
      try {
        await this.cancelJob(jobId);
      } catch (error) {
        this.logger.warn({ jobId, error }, 'Failed to cancel job during shutdown');
      }
    }

    // Shutdown all adapters
    await Promise.all(
      Array.from(this.adapters.values()).map(adapter => adapter.shutdown())
    );

    this.adapters.clear();
    this.activeJobs.clear();
    this.initialized = false;
    this.logger.info('WorkerExecutor shutdown complete');
  }

  // --- Private helpers ---

  /**
   * Try to failover to another worker.
   */
  private async tryFailover(
    jobId: string,
    activeJob: ActiveJob,
    error: string,
  ): Promise<JobPollResult | null> {
    const nextWorker = WorkerPolicy.getFailoverWorker(
      activeJob.job.stage,
      activeJob.worker_type
    );

    if (!nextWorker) {
      this.logger.info({ jobId }, 'No more workers to failover to');
      return null;
    }

    const adapter = this.adapters.get(nextWorker);
    if (!adapter) {
      this.logger.warn({ nextWorker }, 'Failover adapter not registered');
      return null;
    }

    this.emitEvent({
      type: 'failover_started',
      job_id: jobId,
      from_worker: activeJob.worker_type,
      to_worker: nextWorker,
      reason: error,
    });

    this.logger.info({
      jobId,
      from: activeJob.worker_type,
      to: nextWorker,
    }, 'Starting failover');

    // Cancel the current job
    const currentAdapter = this.adapters.get(activeJob.worker_type);
    if (currentAdapter) {
      try {
        await currentAdapter.cancelJob(activeJob.external_job_id);
      } catch (error) {
        this.logger.debug('Failed to cancel job during failover', { externalJobId: activeJob.external_job_id, error: String(error) });
      }
    }

    // Submit to new worker
    const result = await adapter.submitJob(activeJob.job);

    if (result.success && result.external_job_id) {
      // Update active job
      this.activeJobs.set(jobId, {
        ...activeJob,
        external_job_id: result.external_job_id,
        worker_type: nextWorker,
        failover_count: activeJob.failover_count + 1,
      });

      this.emitEvent({
        type: 'job_submitted',
        job_id: jobId,
        external_job_id: result.external_job_id,
        worker_type: nextWorker,
      });

      // Return running status to indicate failover succeeded
      return {
        external_job_id: result.external_job_id,
        status: 'running',
        progress: 0,
      };
    }

    // Failover submission failed, try next worker
    return this.tryFailover(jobId, { ...activeJob, worker_type: nextWorker }, error);
  }

  /**
   * Emit an event to the listener.
   */
  private emitEvent(event: ExecutorEvent): void {
    try {
      this.config.onEvent(event);
    } catch (error) {
      this.logger.warn({ event, error }, 'Error in event listener');
    }
  }
}