import type {
  ConcurrencyConfig,
  CanAcceptParams,
  CanAcceptResult,
  JobRecord,
  EnqueueParams,
  WorkerStats,
  GlobalStats,
  LockRecord,
  AcquireLockParams,
  AcquireLockResult,
  ReleaseLockParams,
  OptimisticLockParams,
  OptimisticLockResult,
  LockMetrics,
  ResourceLockType,
} from './types.js';
import { DEFAULT_CONCURRENCY_CONFIG, buildTaskLockKey } from './types.js';
import { randomUUID } from 'crypto';

interface QueuedJob extends EnqueueParams {
  enqueued_at: string;
}

export class ConcurrencyManager {
  private readonly config: ConcurrencyConfig;
  private readonly activeJobs = new Map<string, JobRecord>();
  private readonly workerJobs = new Map<string, Set<string>>();
  private readonly jobQueue = new Map<string, QueuedJob[]>();

  // Resource locks (ADD_REQUIREMENTS.md Section 5)
  private readonly resourceLocks = new Map<string, LockRecord>();
  private readonly taskVersions = new Map<string, number>();

  // Metrics counters
  private readonly lockConflictCounts: Record<ResourceLockType, number> = {
    task: 0,
    repo_branch: 0,
    environment: 0,
    publish_target: 0,
  };
  private stateUpdateConflictCount = 0;

  constructor(config: Partial<ConcurrencyConfig> = {}) {
    // Read env vars here (not at module load time) so tests can override
    const envConfig: ConcurrencyConfig = {
      max_concurrent_per_worker: parseInt(process.env.CONCURRENCY_PER_WORKER ?? String(DEFAULT_CONCURRENCY_CONFIG.max_concurrent_per_worker), 10),
      max_concurrent_global: parseInt(process.env.CONCURRENCY_GLOBAL ?? String(DEFAULT_CONCURRENCY_CONFIG.max_concurrent_global), 10),
      default_lock_duration_seconds: parseInt(process.env.DEFAULT_LOCK_DURATION_SECONDS ?? String(DEFAULT_CONCURRENCY_CONFIG.default_lock_duration_seconds ?? 300), 10),
    };
    this.config = { ...envConfig, ...config };
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

  // ===========================================================================
  // Resource Lock Methods (ADD_REQUIREMENTS.md Section 5)
  // ===========================================================================

  /**
   * Acquire a resource lock
   *
   * Returns acquired=true if the lock was successfully obtained.
   * Returns acquired=false with conflict info if the resource is already locked.
   */
  acquireLock(params: AcquireLockParams): AcquireLockResult {
    const { resource_key, resource_type, job_id, task_id, duration_seconds } = params;

    // Clean up expired locks first
    this.cleanupExpiredLocks();

    // Check if resource is already locked
    const existingLock = this.resourceLocks.get(resource_key);
    if (existingLock) {
      // Increment conflict counter
      this.lockConflictCounts[resource_type]++;

      return {
        acquired: false,
        conflict_with: existingLock.owner_job_id,
        conflict_expires_at: existingLock.expires_at,
      };
    }

    // Create new lock
    const now = new Date();
    const duration = duration_seconds ?? this.config.default_lock_duration_seconds ?? 300;
    const expiresAt = new Date(now.getTime() + duration * 1000);

    const lock: LockRecord = {
      lock_id: randomUUID(),
      resource_key,
      resource_type,
      owner_job_id: job_id,
      owner_task_id: task_id,
      acquired_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    this.resourceLocks.set(resource_key, lock);

    return { acquired: true, lock };
  }

  /**
   * Release a resource lock
   *
   * Returns true if the lock was released, false if it didn't exist or was owned by another job.
   */
  releaseLock(params: ReleaseLockParams): boolean {
    const { resource_key, job_id } = params;

    const lock = this.resourceLocks.get(resource_key);
    if (!lock) {
      return false;
    }

    // Only the owner can release the lock
    if (lock.owner_job_id !== job_id) {
      return false;
    }

    this.resourceLocks.delete(resource_key);
    return true;
  }

  /**
   * Release all locks owned by a job
   */
  releaseLocksForJob(job_id: string): number {
    let released = 0;
    for (const [key, lock] of this.resourceLocks.entries()) {
      if (lock.owner_job_id === job_id) {
        this.resourceLocks.delete(key);
        released++;
      }
    }
    return released;
  }

  /**
   * Check if a resource is locked
   */
  isLocked(resource_key: string): boolean {
    this.cleanupExpiredLocks();
    return this.resourceLocks.has(resource_key);
  }

  /**
   * Get lock info for a resource
   */
  getLock(resource_key: string): LockRecord | null {
    this.cleanupExpiredLocks();
    return this.resourceLocks.get(resource_key) ?? null;
  }

  /**
   * Acquire a task-level lock
   *
   * This ensures that a single task cannot have multiple active jobs simultaneously.
   */
  acquireTaskLock(task_id: string, job_id: string, duration_seconds?: number): AcquireLockResult {
    const resource_key = buildTaskLockKey(task_id);
    return this.acquireLock({
      resource_key,
      resource_type: 'task',
      job_id,
      task_id,
      duration_seconds,
    });
  }

  /**
   * Release a task-level lock
   */
  releaseTaskLock(task_id: string, job_id: string): boolean {
    const resource_key = buildTaskLockKey(task_id);
    return this.releaseLock({ resource_key, job_id });
  }

  /**
   * Check if a task is currently locked (has an active job)
   */
  isTaskLocked(task_id: string): boolean {
    const resource_key = buildTaskLockKey(task_id);
    return this.isLocked(resource_key);
  }

  // ===========================================================================
  // Optimistic Lock Methods (ADD_REQUIREMENTS.md Section 5)
  // ===========================================================================

  /**
   * Set the current version for a task (used for optimistic locking)
   */
  setTaskVersion(task_id: string, version: number): void {
    this.taskVersions.set(task_id, version);
  }

  /**
   * Get the current version for a task
   */
  getTaskVersion(task_id: string): number | undefined {
    return this.taskVersions.get(task_id);
  }

  /**
   * Validate optimistic lock for a task update
   *
   * Returns valid=true if the version matches.
   * Returns valid=false with current_version if there's a conflict.
   */
  validateOptimisticLock(params: OptimisticLockParams): OptimisticLockResult {
    const { task_id, expected_version } = params;

    const currentVersion = this.taskVersions.get(task_id);

    // If no version is tracked, allow the update
    if (currentVersion === undefined) {
      return { valid: true };
    }

    if (currentVersion !== expected_version) {
      this.stateUpdateConflictCount++;
      return {
        valid: false,
        current_version: currentVersion,
      };
    }

    return { valid: true };
  }

  /**
   * Update task version after a successful update
   */
  updateTaskVersion(task_id: string, new_version: number): void {
    this.taskVersions.set(task_id, new_version);
  }

  /**
   * Check optimistic lock and update version atomically
   *
   * Returns true if the update succeeded, false if there was a conflict.
   */
  checkAndUpdateVersion(task_id: string, expected_version: number, new_version: number): boolean {
    const result = this.validateOptimisticLock({ task_id, expected_version });
    if (!result.valid) {
      return false;
    }
    this.updateTaskVersion(task_id, new_version);
    return true;
  }

  // ===========================================================================
  // Lock Cleanup
  // ===========================================================================

  /**
   * Clean up expired locks
   */
  cleanupExpiredLocks(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [key, lock] of this.resourceLocks.entries()) {
      const expiresAt = new Date(lock.expires_at);
      if (now >= expiresAt) {
        this.resourceLocks.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * Get lock metrics
   */
  getLockMetrics(): LockMetrics {
    this.cleanupExpiredLocks();

    return {
      resource_lock_conflict_total: { ...this.lockConflictCounts },
      state_update_conflict_total: this.stateUpdateConflictCount,
      active_locks_count: this.resourceLocks.size,
    };
  }

  /**
   * Reset conflict counters (for testing or periodic resets)
   */
  resetConflictCounters(): void {
    for (const key of Object.keys(this.lockConflictCounts) as ResourceLockType[]) {
      this.lockConflictCounts[key] = 0;
    }
    this.stateUpdateConflictCount = 0;
  }

  /**
   * Get all active locks (for debugging/monitoring)
   */
  getActiveLocks(): LockRecord[] {
    this.cleanupExpiredLocks();
    return Array.from(this.resourceLocks.values());
  }

  /**
   * Get locks by task ID
   */
  getLocksByTask(task_id: string): LockRecord[] {
    this.cleanupExpiredLocks();
    return Array.from(this.resourceLocks.values()).filter(
      lock => lock.owner_task_id === task_id
    );
  }

  /** Reset all state (useful for testing) */
  reset(): void {
    this.activeJobs.clear();
    this.workerJobs.clear();
    this.jobQueue.clear();
    this.resourceLocks.clear();
    this.taskVersions.clear();
    this.resetConflictCounters();
  }
}