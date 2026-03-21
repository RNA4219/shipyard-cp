// API request/response types: CreateTaskRequest, DispatchRequest, IntegrateRequest, PublishRequest, etc.

import type { RiskLevel } from './base.js';
import type { WorkerType } from './base.js';
import type { WorkerStage } from './base.js';
import type { TaskState } from './base.js';
import type { NextAction } from './base.js';
import type { Task } from './task.js';
import type { RepoRef } from './task.js';
import type { RepoPolicy } from './task.js';
import type { PublishPlan } from './task.js';
import type { ExternalRef } from './task.js';
import type { Verdict } from './task.js';
import type { StateTransitionEvent } from './event.js';

export interface DispatchRequest {
  target_stage: WorkerStage;
  worker_selection?: WorkerType;
  override_risk_level?: RiskLevel;
}

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

export interface IntegrateRequest {
  expected_state: 'accepted';
  base_sha: string;
  branch_ref?: Record<string, unknown>;
  patch_ref?: Record<string, unknown>;
}

export interface CompleteIntegrateRequest {
  checks_passed: boolean;
  integration_head_sha?: string;
  main_updated_sha?: string;
  /** Whether the integration is a fast-forward merge */
  is_fast_forward?: boolean;
  /** Whether there are merge conflicts */
  has_conflicts?: boolean;
}

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

export interface PublishRequest {
  mode: 'no_op' | 'dry_run' | 'apply';
  idempotency_key: string;
  approval_token?: string;
}

export interface ApprovePublishRequest {
  approval_token: string;
}

export interface CompletePublishRequest {
  external_refs?: ExternalRef[];
  rollback_notes?: string;
}

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

export interface CompleteAcceptanceResponse {
  task_id: string;
  state: TaskState;
  checklist_complete: boolean;
  verdict_outcome?: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
}

export interface PublishResponse {
  task_id: string;
  state: TaskState;
  publish_run_id: string;
  publish_plan?: PublishPlan;
}

export interface ResultApplyResponse {
  task: Task;
  emitted_events: StateTransitionEvent[];
  next_action: NextAction;
  retry_scheduled_at?: string;
  failover_worker?: WorkerType;
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