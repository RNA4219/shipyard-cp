/**
 * Task domain types
 */

import type {
  TaskState,
  RiskLevel,
  RepoRef,
  RepoPolicy,
  WorkspaceRef,
  PublishPlan,
  Verdict,
  ManualChecklistItem,
  ArtifactRef,
  ExternalRef,
  WorkerStage,
  FailureClass,
  SideEffectCategory,
  Capability,
} from './common.js';

// Blocked context for task waiting
export interface BlockedContext {
  resume_state: 'planning' | 'developing' | 'accepting' | 'integrating' | 'integrated' | 'publishing';
  reason: string;
  waiting_on?: 'litellm' | 'worker' | 'human' | 'policy' | 'github' | 'environment' | 'resolver' | 'tracker_bridge' | 'agent_taskstate';
  capability_missing?: Capability[];
  lock_conflict?: string;
  loop_fingerprint?: string;
  orphaned_run?: boolean;
}

// Integration state tracking
export interface IntegrationState {
  integration_branch?: string;
  integration_head_sha?: string;
  main_updated_sha?: string;
  checks_passed?: boolean;
  /** Original base SHA captured at integration start for immutability validation */
  original_base_sha?: string;
}

// Integration run metadata for progress monitoring
export interface IntegrationRun {
  run_id: string;
  started_at: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout';
  progress?: number;
  timeout_at: string;
  completed_at?: string;
  error?: string;
}

// Publish run metadata for progress monitoring
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

// Resolver references
export interface ResolverRefs {
  doc_refs?: string[];
  chunk_refs?: string[];
  ack_refs?: string[];
  contract_refs?: string[];
  stale_status?: 'fresh' | 'stale' | 'unknown';
  /** Document importance classification from memx-resolver */
  importance?: Record<string, 'required' | 'recommended' | 'optional'>;
  /** Reason for each document inclusion */
  reason?: Record<string, string>;
}

// Core Task entity
export interface Task {
  task_id: string;
  title: string;
  objective: string;
  typed_ref: string;
  description?: string;
  state: TaskState;
  version: number;
  risk_level: RiskLevel;
  repo_ref: RepoRef;
  repo_policy?: RepoPolicy;
  active_job_id?: string;
  latest_job_ids?: Partial<Record<WorkerStage, string>>;
  last_verdict?: Verdict;
  workspace_ref?: WorkspaceRef;
  publish_plan?: PublishPlan;
  /** Token required for publish approval (set when entering publish_pending_approval) */
  pending_approval_token?: string;
  /** Expiration time for the approval token */
  pending_approval_expires_at?: string;
  blocked_context?: BlockedContext;
  integration?: IntegrationState;
  /** Integration run metadata for progress monitoring */
  integration_run?: IntegrationRun;
  /** Publish run metadata for progress monitoring */
  publish_run?: PublishRun;
  artifacts?: ArtifactRef[];
  manual_checklist?: ManualChecklistItem[];
  resolver_refs?: ResolverRefs;
  labels?: string[];
  external_refs?: ExternalRef[];
  context_bundle_ref?: string;
  rollback_notes?: string;
  /** Retry counts per stage */
  retry_counts?: Partial<Record<WorkerStage, number>>;
  /** Last failure class from worker result */
  last_failure_class?: FailureClass;
  /** Detected side effect categories from worker execution */
  detected_side_effects?: SideEffectCategory[];
  /** Loop fingerprint for cycle detection */
  loop_fingerprint?: string;
  /** File change statistics from worker execution */
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}