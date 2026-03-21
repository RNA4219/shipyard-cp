// Run and checkpoint types: Run, RunStatus, CheckpointRef, IntegrationState, IntegrationRun, PublishRun, BlockedContext

import type { RiskLevel } from './base.js';
import type { TaskState } from './base.js';
import type { WorkerStage } from './base.js';
import type { Capability } from './base.js';
import type { ExternalRef } from './task.js';

export interface BlockedContext {
  resume_state: 'planning' | 'developing' | 'accepting' | 'integrating' | 'integrated' | 'publishing';
  reason: string;
  waiting_on?: 'litellm' | 'worker' | 'human' | 'policy' | 'github' | 'environment' | 'resolver' | 'tracker_bridge' | 'agent_taskstate';
  capability_missing?: Capability[];
  lock_conflict?: string;
  loop_fingerprint?: string;
  orphaned_run?: boolean;
}

export interface IntegrationState {
  integration_branch?: string;
  integration_head_sha?: string;
  main_updated_sha?: string;
  checks_passed?: boolean;
  /** Original base SHA captured at integration start for immutability validation */
  original_base_sha?: string;
}

/**
 * Integration run metadata for progress monitoring
 */
export interface IntegrationRun {
  run_id: string;
  started_at: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout';
  progress?: number;
  timeout_at: string;
  completed_at?: string;
  error?: string;
}

/**
 * Publish run metadata for progress monitoring
 */
export interface PublishRun {
  run_id: string;
  started_at: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout';
  progress?: number;
  timeout_at: string;
  completed_at?: string;
  error?: string;
  external_refs?: ExternalRef[];
}

/** Run status for visualization */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled';

/** Run read model for visualization and retrospective */
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

/** Checkpoint reference for stage boundaries */
export interface CheckpointRef {
  checkpoint_id: string;
  checkpoint_type: 'code' | 'approval';
  stage: WorkerStage | 'integrate' | 'publish';
  ref: string;  // commit SHA, branch, tag, or approval reference
  created_at: string;
}