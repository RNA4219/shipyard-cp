// Worker job types: WorkerJob, WorkerJobContext, ApprovalPolicy, RetryPolicy, WorkerResult, TestResult, RequestedEscalation

import type { RiskLevel } from './base.js';
import type { WorkerType } from './base.js';
import type { WorkerStage } from './base.js';
import type { FailureClass } from './base.js';
import type { SideEffectCategory } from './base.js';
import type { Capability } from './base.js';
import type { Reference } from './base.js';
import type { RepoRef } from './task.js';
import type { WorkspaceRef } from './task.js';
import type { Verdict } from './task.js';
import type { ResolverRefs } from './task.js';
import type { ExternalRef } from './task.js';

export interface WorkerJobContext {
  objective?: string;
  acceptance_criteria?: string[];
  references?: Reference[];
  constraints?: string[];
  resolver_refs?: {
    doc_refs?: string[];
    chunk_refs?: string[];
    contract_refs?: string[];
  };
  tracker_refs?: Reference[];
}

export interface ApprovalPolicy {
  mode: 'deny' | 'ask' | 'allow';
  allowed_side_effect_categories?: Array<
    | 'network_access'
    | 'workspace_outside_write'
    | 'protected_path_write'
    | 'destructive_tool'
    | 'external_release'
    | 'secret_access'
  >;
  operator_approval_required?: boolean;
  sandbox_profile?: 'read_only' | 'workspace_write' | 'full_auto' | 'custom';
}

export interface RetryPolicy {
  max_retries: number;
  backoff_base_seconds: number;
  max_backoff_seconds: number;
  jitter_enabled: boolean;
}

export interface WorkerJob {
  job_id: string;
  task_id: string;
  typed_ref: string;
  stage: WorkerStage;
  worker_type: WorkerType;
  workspace_ref: WorkspaceRef;
  input_prompt: string;
  repo_ref: RepoRef;
  capability_requirements: Capability[];
  risk_level: RiskLevel;
  approval_policy: ApprovalPolicy;
  retry_policy?: RetryPolicy;
  retry_count?: number;
  loop_fingerprint?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  context?: WorkerJobContext;
  requested_outputs?: Array<'patch' | 'branch' | 'tests' | 'verdict' | 'artifacts' | 'plan_notes' | 'resolver_refs'>;
  timeouts?: {
    queue_timeout_sec?: number;
    run_timeout_sec?: number;
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TestResult {
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'not_run';
  passed?: number;
  failed?: number;
  skipped?: number;
  duration_ms?: number;
  artifact_id?: string;
}

export interface RequestedEscalation {
  kind:
    | 'network_access'
    | 'workspace_outside_write'
    | 'protected_path_write'
    | 'destructive_tool'
    | 'secret_access'
    | 'human_verdict';
  reason: string;
  approved?: boolean;
}

export interface WorkerResult {
  job_id: string;
  typed_ref: string;
  status: 'succeeded' | 'failed' | 'blocked';
  summary?: string;
  patch_ref?: { format: 'unified_diff' | 'git_apply_patch' | 'url'; content: string; base_sha?: string };
  branch_ref?: { name: string; head_sha?: string; remote_url?: string };
  artifacts: Array<{ artifact_id: string; kind: 'log' | 'screenshot' | 'report' | 'trace' | 'json' | 'html' | 'other'; uri: string }>;
  test_results: TestResult[];
  verdict?: Verdict & { checklist_completed?: boolean };
  requested_escalations: RequestedEscalation[];
  retry_count?: number;
  failure_class?: FailureClass;
  failure_code?: string;
  /** Human-readable summary of the failure for debugging and auditing */
  failure_summary?: string;
  /** Timestamp when retry is scheduled (if retry was scheduled) */
  retry_scheduled_at?: string;
  resolver_refs?: ResolverRefs;
  external_refs?: ExternalRef[];
  context_bundle_ref?: string;
  rollback_notes?: string;
  /** Loop fingerprint from worker for cycle detection */
  loop_fingerprint?: string;
  /** Detected side effect categories during execution */
  detected_side_effects?: SideEffectCategory[];
  raw_outputs?: Array<{ channel: 'stdout' | 'stderr' | 'json' | 'event_stream'; artifact_id: string }>;
  timestamps?: {
    started_at?: string;
    finished_at?: string;
  };
  usage: {
    runtime_ms: number;
    exit_code?: number;
    litellm?: {
      model?: string;
      provider?: string;
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      fallback_used?: boolean;
    };
  };
  metadata?: Record<string, string | number | boolean | null>;
}