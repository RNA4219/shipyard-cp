export interface ConcurrencyConfig {
  max_concurrent_per_worker: number;
  max_concurrent_global: number;
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

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  max_concurrent_per_worker: 3,
  max_concurrent_global: 10,
};