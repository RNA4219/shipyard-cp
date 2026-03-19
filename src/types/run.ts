/**
 * Run and Checkpoint types
 */

import type { RiskLevel, WorkerStage, TaskState } from './common.js';

// Run status for visualization
export type RunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled';

// Checkpoint reference for stage boundaries
export interface CheckpointRef {
  checkpoint_id: string;
  checkpoint_type: 'code' | 'approval';
  stage: WorkerStage | 'integrate' | 'publish';
  ref: string;  // commit SHA, branch, tag, or approval reference
  created_at: string;
}

// Run read model for visualization and retrospective
export interface Run {
  run_id: string;
  task_id: string;
  run_sequence: number;
  status: RunStatus;
  current_stage?: WorkerStage;
  current_state: TaskState;
  started_at: string;
  ended_at?: string;
  last_event_at: string;
  /** Version of the projection for optimistic concurrency */
  projection_version: number;
  /** Cursor position in event stream for incremental updates */
  source_event_cursor: string;
  /** Risk level inherited from task */
  risk_level: RiskLevel;
  /** Objective summary */
  objective?: string;
  /** Blocked reason if status is blocked */
  blocked_reason?: string;
  /** Associated job IDs */
  job_ids: string[];
  /** Checkpoint references */
  checkpoints: CheckpointRef[];
  /** Created timestamp */
  created_at: string;
  /** Updated timestamp */
  updated_at: string;
}