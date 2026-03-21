// Task-related types: Task, RepoRef, WorkspaceRef, RepoPolicy, PublishPlan, Verdict, ManualChecklistItem, ArtifactRef, ExternalRef, ResolverRefs, etc.

import type { RiskLevel } from './base.js';
import type { TaskState } from './base.js';
import type { FailureClass } from './base.js';
import type { SideEffectCategory } from './base.js';
import type { WorkerStage } from './base.js';
import type { IntegrationState } from './run.js';
import type { IntegrationRun } from './run.js';
import type { PublishRun } from './run.js';
import type { BlockedContext } from './run.js';

export interface RepoRef {
  provider: 'github';
  owner: string;
  name: string;
  default_branch: string;
  base_sha?: string;
}

export interface WorkspaceRef {
  workspace_id: string;
  kind: 'container' | 'volume' | 'host_path';
  reusable?: boolean;
}

export interface PublishPlan {
  mode?: 'no_op' | 'dry_run' | 'apply';
  idempotency_key?: string;
  targets?: Array<'deployment' | 'release' | 'package_publish' | 'external_api'>;
  approval_required?: boolean;
  policy_warnings?: string[];
}

export interface RepoPolicy {
  update_strategy: 'direct_push' | 'pull_request' | 'fast_forward_only';
  main_push_actor: 'bot' | 'human' | 'any';
  require_ci_pass: boolean;
  integration_branch_prefix?: string;
  protected_branches?: string[];
  allowed_merge_methods?: ('merge' | 'squash' | 'rebase')[];
}

export interface Verdict {
  outcome: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
  reason?: string;
  manual_notes?: string;
}

export interface ManualChecklistItem {
  id: string;
  description: string;
  required: boolean;
  checked?: boolean;
  checked_by?: string;
  checked_at?: string;
  notes?: string;
}

export interface ArtifactRef {
  artifact_id: string;
  kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
}

export type LinkRole = 'primary' | 'related' | 'duplicate' | 'blocks' | 'caused_by';

export interface ExternalRef {
  kind: 'github_issue' | 'github_project_item' | 'release' | 'deployment' | 'tag' | 'tracker_issue' | 'sync_event' | 'entity_link';
  value: string;
  connection_ref?: string;
  link_role?: LinkRole;
  metadata_json?: string;
}

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
  /** Counts of stale documents by category */
  stale_doc_counts?: { fresh: number; stale: number; unknown: number };
}

export interface ResolveDocsRequest {
  feature?: string;
  topic?: string;
  task_seed?: string;
}

export interface ResolveDocsResponse {
  typed_ref: string;
  doc_refs: string[];
  chunk_refs: string[];
  contract_refs: string[];
  stale_status: 'fresh' | 'stale' | 'unknown';
}

export interface AckDocsRequest {
  doc_id: string;
  version: string;
}

export interface AckDocsResponse {
  ack_ref: string;
}

export interface StaleCheckRequest {
  doc_ids?: string[];
}

export interface StaleDocItem {
  task_id: string;
  doc_id: string;
  previous_version: string;
  current_version: string;
  reason: 'version_mismatch' | 'document_missing';
  detected_at: string;
}

export interface StaleCheckResponse {
  task_id: string;
  stale: StaleDocItem[];
}

export interface TrackerLinkRequest {
  typed_ref: string;
  connection_ref?: string;
  entity_ref: string;
  link_role?: LinkRole;
  metadata_json?: string;
}

export interface TrackerLinkResponse {
  typed_ref: string;
  external_refs: ExternalRef[];
  sync_event_ref: string;
}

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