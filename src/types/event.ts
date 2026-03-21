// Event types: StateTransitionEvent, AuditEvent, AuditEventType

import type { TaskState } from './base.js';

export interface StateTransitionEvent {
  event_id: string;
  task_id: string;
  from_state: TaskState;
  to_state: TaskState;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
  actor_id: string;
  reason: string;
  job_id?: string;
  artifact_ids?: string[];
  occurred_at: string;
}

/** Audit event types for run monitoring */
export type AuditEventType =
  | 'state_transition'
  | 'job_started'
  | 'job_completed'
  | 'retry_triggered'
  | 'heartbeat_missed'
  | 'orphan_detected'
  | 'lock_conflict'
  | 'capability_mismatch'
  | 'doom_loop_detected'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'run.main_updated'
  | 'run.publishRequested'
  | 'run.publishCompleted'
  | 'run.publishIdempotent'
  | 'run.workerFailover'
  | 'run.litellmFailed'
  | 'task.verdictSubmitted'
  | 'run.permissionEscalated';

/** Audit event for run monitoring */
export interface AuditEvent {
  event_id: string;
  event_type: AuditEventType;
  task_id: string;
  run_id?: string;
  job_id?: string;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
  actor_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}