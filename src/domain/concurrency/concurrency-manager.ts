import type {
  ConcurrencyConfig,
  CanAcceptParams,
  CanAcceptResult,
  JobRecord,
  EnqueueParams,
  WorkerStats,
  GlobalStats,
} from './types.js';
import { DEFAULT_CONCURRENCY_CONFIG } from './types.js';

interface QueuedJob extends EnqueueParams {
  enqueued_at: string;
}

export class ConcurrencyManager {
  private readonly config: ConcurrencyConfig;
  private readonly activeJobs = new Map<string, JobRecord>();
  private readonly workerJobs = new Map<string, Set<string>>();
  private readonly jobQueue = new Map<string, QueuedJob[]>();

  constructor(config: Partial<ConcurrencyConfig> = {}) {
    this.config = { ...DEFAULT_CONCURRENCY_CONFIG, ...config };
  }

  canAccept(params: CanAcceptParams): CanAcceptResult {
    const { worker_id } = params;

    // Check global capacity first
    if (this.activeJobs.size >= this.config.max_concurrent_global) {
      return { accepted: false, reason: 'global_capacity_exceeded' };
    }

    // Check worker capacity
    const workerActive = this.workerJobs.get(worker_id)?.size ?? 0;
    if (workerActive >= this.config.max_concurrent_per_worker) {
      return { accepted: false, reason: 'worker_capacity_exceeded' };
    }

    return { accepted: true };
  }

  recordStart(params: EnqueueParams): void {
    const { job_id, worker_id, stage } = params;

    const record: JobRecord = {
      job_id,
      worker_id,
      stage,
      started_at: new Date().toISOString(),
    };

    this.activeJobs.set(job_id, record);

    if (!this.workerJobs.has(worker_id)) {
      this.workerJobs.set(worker_id, new Set());
    }
    this.workerJobs.get(worker_id)?.add(job_id);
  }

  recordComplete(params: { job_id: string; worker_id: string }): void {
    const { job_id, worker_id } = params;

    this.activeJobs.delete(job_id);

    const workerJobSet = this.workerJobs.get(worker_id);
    if (workerJobSet) {
      workerJobSet.delete(job_id);
    }
  }

  getStats(worker_id: string): WorkerStats {
    const active_jobs = this.workerJobs.get(worker_id)?.size ?? 0;
    const queue = this.jobQueue.get(worker_id) ?? [];
    const max_concurrent = this.config.max_concurrent_per_worker;

    return {
      worker_id,
      active_jobs,
      max_concurrent,
      utilization: active_jobs / max_concurrent,
      queued_jobs: queue.length,
    };
  }

  getGlobalStats(): GlobalStats {
    const total_active_jobs = this.activeJobs.size;
    const active_workers = this.workerJobs.size;

    return {
      total_active_jobs,
      total_capacity: this.config.max_concurrent_global,
      active_workers,
      global_utilization: total_active_jobs / this.config.max_concurrent_global,
    };
  }

  enqueue(params: EnqueueParams): void {
    const { worker_id } = params;

    if (!this.jobQueue.has(worker_id)) {
      this.jobQueue.set(worker_id, []);
    }

    const queue = this.jobQueue.get(worker_id);
    if (queue) {
      queue.push({
        ...params,
        enqueued_at: new Date().toISOString(),
      });
    }
  }

  getQueuePosition(job_id: string): number {
    for (const queue of this.jobQueue.values()) {
      const index = queue.findIndex(job => job.job_id === job_id);
      if (index >= 0) {
        return index + 1;
      }
    }
    return 0;
  }

  dequeue(worker_id: string): EnqueueParams | null {
    const queue = this.jobQueue.get(worker_id);
    if (!queue || queue.length === 0) {
      return null;
    }

    const job = queue.shift();
    if (!job) {
      return null;
    }
    return {
      job_id: job.job_id,
      worker_id: job.worker_id,
      stage: job.stage,
    };
  }

  /** Reset all state (useful for testing) */
  reset(): void {
    this.activeJobs.clear();
    this.workerJobs.clear();
    this.jobQueue.clear();
  }
}