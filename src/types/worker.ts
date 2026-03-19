/**
 * Worker domain types
 */

import type {
  WorkerType,
  WorkerStage,
  RiskLevel,
  RepoRef,
  WorkspaceRef,
  FailureClass,
  SideEffectCategory,
  Capability,
  Reference,
} from './common.js';
import type { ResolverRefs, Task } from './task.js';
import type { ExternalRef } from './common.js';
import type { Verdict } from './common.js';

// Worker job context
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

// Approval policy for worker execution
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

// Retry policy
export interface RetryPolicy {
  max_retries: number;
  backoff_base_seconds: number;
  max_backoff_seconds: number;
  jitter_enabled: boolean;
}

// Worker job
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

// Test result
export interface TestResult {
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'not_run';
  passed?: number;
  failed?: number;
  skipped?: number;
  duration_ms?: number;
  artifact_id?: string;
}

// Requested escalation
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

// Worker result
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

// State transition event
export interface StateTransitionEvent {
  event_id: string;
  task_id: string;
  from_state: Task['state'];
  to_state: Task['state'];
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
  actor_id: string;
  reason: string;
  job_id?: string;
  artifact_ids?: string[];
  occurred_at: string;
}

// Result apply response
export interface ResultApplyResponse {
  task: Task;
  emitted_events: StateTransitionEvent[];
  next_action: Task['state'] extends 'blocked' ? 'wait_manual' : 'none' | 'dispatch_dev' | 'dispatch_acceptance' | 'integrate' | 'publish' | 'retry' | 'failover';
  retry_scheduled_at?: string;
  failover_worker?: WorkerType;
}