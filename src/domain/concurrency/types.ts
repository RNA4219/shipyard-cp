export interface ConcurrencyConfig {
  max_concurrent_per_worker: number;
  max_concurrent_global: number;
  /** Default lock duration in seconds */
  default_lock_duration_seconds?: number;
}

export interface CanAcceptParams {
  worker_id: string;
  stage: string;
}

export interface CanAcceptResult {
  accepted: boolean;
  reason?: 'worker_capacity_exceeded' | 'global_capacity_exceeded';
}

export interface JobRecord {
  job_id: string;
  worker_id: string;
  stage: string;
  started_at: string;
}

export interface EnqueueParams {
  job_id: string;
  worker_id: string;
  stage: string;
}

export interface WorkerStats {
  worker_id: string;
  active_jobs: number;
  max_concurrent: number;
  utilization: number;
  queued_jobs: number;
}

export interface GlobalStats {
  total_active_jobs: number;
  total_capacity: number;
  active_workers: number;
  global_utilization: number;
}

// =============================================================================
// Resource Lock Types (ADD_REQUIREMENTS.md Section 5)
// =============================================================================

/** Resource type for lock classification */
export type ResourceLockType = 'task' | 'repo_branch' | 'environment' | 'publish_target';

/** Lock record for tracking resource locks */
export interface LockRecord {
  lock_id: string;
  resource_key: string;
  resource_type: ResourceLockType;
  owner_job_id: string;
  owner_task_id: string;
  acquired_at: string;
  expires_at: string;
}

/** Request to acquire a resource lock */
export interface AcquireLockParams {
  resource_key: string;
  resource_type: ResourceLockType;
  job_id: string;
  task_id: string;
  /** Lock duration in seconds (optional, uses default if not specified) */
  duration_seconds?: number;
}

/** Result of lock acquisition attempt */
export interface AcquireLockResult {
  acquired: boolean;
  lock?: LockRecord;
  conflict_with?: string;
  conflict_expires_at?: string;
}

/** Parameters for releasing a lock */
export interface ReleaseLockParams {
  resource_key: string;
  job_id: string;
}

/** Parameters for optimistic lock check */
export interface OptimisticLockParams {
  task_id: string;
  expected_version: number;
}

/** Result of optimistic lock check */
export interface OptimisticLockResult {
  valid: boolean;
  current_version?: number;
}

/** Metrics for lock operations */
export interface LockMetrics {
  resource_lock_conflict_total: Record<ResourceLockType, number>;
  state_update_conflict_total: number;
  active_locks_count: number;
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  max_concurrent_per_worker: 20,
  max_concurrent_global: 200,
  default_lock_duration_seconds: 300,
};

// =============================================================================
// Resource Key Builders
// =============================================================================

/**
 * Build a task-level lock key
 */
export function buildTaskLockKey(taskId: string): string {
  return `task:${taskId}`;
}

/**
 * Build a repo_branch lock key
 */
export function buildRepoBranchLockKey(repoRef: string, branch: string): string {
  return `repo_branch:${repoRef}:${branch}`;
}

/**
 * Build an environment lock key
 */
export function buildEnvironmentLockKey(environmentName: string): string {
  return `environment:${environmentName}`;
}

/**
 * Build a publish_target lock key
 */
export function buildPublishTargetLockKey(provider: string, targetId: string): string {
  return `publish_target:${provider}:${targetId}`;
}