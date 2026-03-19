/**
 * Common type definitions used across domains
 */

// Risk levels
export type RiskLevel = 'low' | 'medium' | 'high';

// Worker types and stages
export type WorkerType = 'codex' | 'claude_code' | 'google_antigravity';
export type WorkerStage = 'plan' | 'dev' | 'acceptance';

// Failure classification
export type FailureClass =
  | 'retryable_transient'
  | 'retryable_capacity'
  | 'non_retryable_policy'
  | 'non_retryable_logic';

// Side effect categories detected during worker execution
export type SideEffectCategory =
  | 'network_access'
  | 'workspace_outside_write'
  | 'protected_path_write'
  | 'destructive_tool'
  | 'secret_access'
  | 'external_release';

// Task state machine states
export type TaskState =
  | 'queued'
  | 'planning'
  | 'planned'
  | 'developing'
  | 'dev_completed'
  | 'accepting'
  | 'accepted'
  | 'rework_required'
  | 'integrating'
  | 'integrated'
  | 'publish_pending_approval'
  | 'publishing'
  | 'published'
  | 'cancelled'
  | 'failed'
  | 'blocked';

// Next action hints
export type NextAction =
  | 'dispatch_dev'
  | 'dispatch_acceptance'
  | 'integrate'
  | 'publish'
  | 'retry'
  | 'failover'
  | 'wait_manual'
  | 'none';

// Link role types for entity relationships
export type LinkRole = 'primary' | 'related' | 'duplicate' | 'blocks' | 'caused_by';

// Capabilities
export type Capability =
  | 'plan'
  | 'edit_repo'
  | 'run_tests'
  | 'needs_approval'
  | 'networked'
  | 'produces_patch'
  | 'produces_verdict';

// Repository reference
export interface RepoRef {
  provider: 'github';
  owner: string;
  name: string;
  default_branch: string;
  base_sha?: string;
}

// Workspace reference
export interface WorkspaceRef {
  workspace_id: string;
  kind: 'container' | 'volume' | 'host_path';
  reusable?: boolean;
}

// Publish plan configuration
export interface PublishPlan {
  mode?: 'no_op' | 'dry_run' | 'apply';
  idempotency_key?: string;
  targets?: Array<'deployment' | 'release' | 'package_publish' | 'external_api'>;
  approval_required?: boolean;
  policy_warnings?: string[];
}

// Repository policy
export interface RepoPolicy {
  update_strategy: 'direct_push' | 'pull_request' | 'fast_forward_only';
  main_push_actor: 'bot' | 'human' | 'any';
  require_ci_pass: boolean;
  integration_branch_prefix?: string;
  protected_branches?: string[];
  allowed_merge_methods?: ('merge' | 'squash' | 'rebase')[];
}

// Verdict from acceptance
export interface Verdict {
  outcome: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
  reason?: string;
  manual_notes?: string;
}

// Manual checklist item
export interface ManualChecklistItem {
  id: string;
  description: string;
  required: boolean;
  checked?: boolean;
  checked_by?: string;
  checked_at?: string;
  notes?: string;
}

// Artifact reference
export interface ArtifactRef {
  artifact_id: string;
  kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
}

// External reference
export interface ExternalRef {
  kind: 'github_issue' | 'github_project_item' | 'release' | 'deployment' | 'tag' | 'tracker_issue' | 'sync_event' | 'entity_link';
  value: string;
  connection_ref?: string;
  link_role?: LinkRole;
  metadata_json?: string;
}

// Reference for context
export interface Reference {
  kind: 'url' | 'file' | 'issue' | 'commit' | 'doc' | 'typed_ref';
  value: string;
  label?: string;
}