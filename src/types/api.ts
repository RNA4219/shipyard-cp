/**
 * API Request/Response types
 */

import type {
  RiskLevel,
  RepoRef,
  RepoPolicy,
  WorkerType,
  WorkerStage,
  ExternalRef,
  Verdict,
  PublishPlan,
} from './common.js';
import type { Task, TaskState } from './task.js';
import type { StateTransitionEvent, WorkerType as WT } from './worker.js';

// Dispatch request
export interface DispatchRequest {
  target_stage: WorkerStage;
  worker_selection?: WorkerType;
  override_risk_level?: RiskLevel;
}

// Create task request
export interface CreateTaskRequest {
  title: string;
  objective: string;
  typed_ref: string;
  description?: string;
  repo_ref: RepoRef;
  repo_policy?: RepoPolicy;
  risk_level?: RiskLevel;
  labels?: string[];
  publish_plan?: PublishPlan;
  external_refs?: ExternalRef[];
}

// Integrate request
export interface IntegrateRequest {
  expected_state: 'accepted';
  base_sha: string;
  branch_ref?: Record<string, unknown>;
  patch_ref?: Record<string, unknown>;
}

// Complete integrate request
export interface CompleteIntegrateRequest {
  checks_passed: boolean;
  integration_head_sha?: string;
  main_updated_sha?: string;
  /** Whether the integration is a fast-forward merge */
  is_fast_forward?: boolean;
  /** Whether there are merge conflicts */
  has_conflicts?: boolean;
}

// Integrate response
export interface IntegrateResponse {
  task_id: string;
  state: TaskState;
  integration_branch: string;
  integration_head_sha?: string;
  // Policy gate fields
  requires_pr?: boolean;
  can_fast_forward?: boolean;
  policy_warnings?: string[];
  /** Indicates rebase is needed due to base SHA change */
  needs_rebase?: boolean;
}

// Publish request
export interface PublishRequest {
  mode: 'no_op' | 'dry_run' | 'apply';
  idempotency_key: string;
  approval_token?: string;
}

// Approve publish request
export interface ApprovePublishRequest {
  approval_token: string;
}

// Complete publish request
export interface CompletePublishRequest {
  external_refs?: ExternalRef[];
  rollback_notes?: string;
}

// Complete acceptance request
export interface CompleteAcceptanceRequest {
  /** Checklist item IDs that are checked */
  checked_items?: Array<{
    id: string;
    checked_by?: string;
    notes?: string;
  }>;
  /** Override verdict if needed */
  verdict?: Verdict;
}

// Complete acceptance response
export interface CompleteAcceptanceResponse {
  task_id: string;
  state: TaskState;
  checklist_complete: boolean;
  verdict_outcome?: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
}

// Publish response
export interface PublishResponse {
  task_id: string;
  state: TaskState;
  publish_run_id: string;
  publish_plan?: PublishPlan;
}

// Heartbeat types
export interface JobHeartbeatRequest {
  worker_id: string;
  stage: string;
  progress?: number;
  observed_at?: string;
}

export interface JobHeartbeatResponse {
  job_id: string;
  lease_expires_at: string;
  next_heartbeat_due_at: string;
  last_heartbeat_at: string;
}

// Lease types
export interface Lease {
  job_id: string;
  lease_owner: string;
  lease_expires_at: string;
  last_heartbeat_at?: string;
  acquired_at: string;
  orphaned_at?: string;
  recovery_action?: 'retry' | 'block' | 'fail';
}