// Core types: RiskLevel, WorkerType, WorkerStage, FailureClass, SideEffectCategory, TaskState, NextAction, Capability, Reference

export type RiskLevel = 'low' | 'medium' | 'high';
export type WorkerType = 'codex' | 'claude_code' | 'google_antigravity';
export type WorkerStage = 'plan' | 'dev' | 'acceptance';
export type FailureClass = 'retryable_transient' | 'retryable_capacity' | 'non_retryable_policy' | 'non_retryable_logic';

/** Side effect categories detected during worker execution */
export type SideEffectCategory =
  | 'network_access'
  | 'workspace_outside_write'
  | 'protected_path_write'
  | 'destructive_tool'
  | 'secret_access'
  | 'external_release';

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

export type NextAction =
  | 'dispatch_dev'
  | 'dispatch_acceptance'
  | 'integrate'
  | 'publish'
  | 'retry'
  | 'failover'
  | 'wait_manual'
  | 'none';

export type Capability =
  | 'plan'
  | 'edit_repo'
  | 'run_tests'
  | 'needs_approval'
  | 'networked'
  | 'produces_patch'
  | 'produces_verdict';

export interface Reference {
  kind: 'url' | 'file' | 'issue' | 'commit' | 'doc' | 'typed_ref';
  value: string;
  label?: string;
}