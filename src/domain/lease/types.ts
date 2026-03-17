export interface LeaseConfig {
  lease_duration_seconds: number;
  heartbeat_grace_multiplier: number;
  heartbeat_interval_seconds?: number;
}

export interface Lease {
  job_id: string;
  lease_owner: string;
  lease_expires_at: string;
  last_heartbeat_at?: string;
  acquired_at: string;
  orphaned_at?: string;
  recovery_action?: 'retry' | 'block' | 'fail';
}

export interface HeartbeatRequest {
  stage: string;
  progress?: number;
  observed_at?: string;
}

export interface HeartbeatResponse {
  lease_expires_at: string;
  next_heartbeat_due_at: string;
  last_heartbeat_at: string;
}

export const DEFAULT_LEASE_CONFIG: LeaseConfig = {
  lease_duration_seconds: 300,
  heartbeat_grace_multiplier: 3,
  heartbeat_interval_seconds: 60,
};