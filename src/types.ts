export type RiskLevel = 'low' | 'medium' | 'high';
export type WorkerType = 'codex' | 'claude_code' | 'google_antigravity';
export type WorkerStage = 'plan' | 'dev' | 'acceptance';
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
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'blocked';

export type NextAction =
  | 'dispatch_dev'
  | 'dispatch_acceptance'
  | 'integrate'
  | 'publish'
  | 'wait_manual'
  | 'none';

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
}

export interface Verdict {
  outcome: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
  reason?: string;
  manual_notes?: string;
}

export interface ArtifactRef {
  artifact_id: string;
  kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
}

export interface ExternalRef {
  kind: 'github_issue' | 'github_project_item' | 'release' | 'deployment' | 'tag';
  value: string;
}

export interface BlockedContext {
  resume_state: 'planning' | 'developing' | 'accepting' | 'integrating' | 'publishing';
  reason: string;
  waiting_on?: 'litellm' | 'worker' | 'human' | 'policy' | 'github' | 'environment';
}

export interface IntegrationState {
  integration_branch?: string;
  integration_head_sha?: string;
  main_updated_sha?: string;
  checks_passed?: boolean;
}

export interface Task {
  task_id: string;
  title: string;
  description?: string;
  state: TaskState;
  risk_level: RiskLevel;
  repo_ref: RepoRef;
  active_job_id?: string;
  latest_job_ids?: Partial<Record<WorkerStage, string>>;
  last_verdict?: Verdict;
  workspace_ref?: WorkspaceRef;
  publish_plan?: PublishPlan;
  blocked_context?: BlockedContext;
  integration?: IntegrationState;
  artifacts?: ArtifactRef[];
  labels?: string[];
  external_refs?: ExternalRef[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type Capability =
  | 'plan'
  | 'edit_repo'
  | 'run_tests'
  | 'needs_approval'
  | 'networked'
  | 'produces_patch'
  | 'produces_verdict';

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

export interface WorkerJob {
  job_id: string;
  task_id: string;
  stage: WorkerStage;
  worker_type: WorkerType;
  workspace_ref: WorkspaceRef;
  input_prompt: string;
  repo_ref: RepoRef;
  capability_requirements: Capability[];
  risk_level: RiskLevel;
  approval_policy: ApprovalPolicy;
  requested_outputs?: Array<'patch' | 'branch' | 'tests' | 'verdict' | 'artifacts' | 'plan_notes'>;
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
  status: 'succeeded' | 'failed' | 'blocked';
  summary?: string;
  patch_ref?: { format: 'unified_diff' | 'git_apply_patch' | 'url'; content: string; base_sha?: string };
  branch_ref?: { name: string; head_sha?: string; remote_url?: string };
  artifacts: Array<{ artifact_id: string; kind: 'log' | 'screenshot' | 'report' | 'trace' | 'json' | 'html' | 'other'; uri: string }>;
  test_results: TestResult[];
  verdict?: Verdict & { checklist_completed?: boolean };
  requested_escalations: RequestedEscalation[];
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
}

export interface StateTransitionEvent {
  event_id: string;
  task_id: string;
  from_state: TaskState;
  to_state: TaskState;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
  actor_id: string;
  reason: string;
  job_id?: string;
  artifact_ids?: string[];
  occurred_at: string;
}

export interface DispatchRequest {
  target_stage: WorkerStage;
  worker_selection?: WorkerType;
  override_risk_level?: RiskLevel;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  repo_ref: RepoRef;
  risk_level?: RiskLevel;
  labels?: string[];
  publish_plan?: PublishPlan;
}

export interface IntegrateRequest {
  expected_state: 'accepted';
  base_sha: string;
  branch_ref?: Record<string, unknown>;
  patch_ref?: Record<string, unknown>;
}

export interface PublishRequest {
  mode: 'no_op' | 'dry_run' | 'apply';
  idempotency_key: string;
  approval_token?: string;
}

export interface ResultApplyResponse {
  task: Task;
  emitted_events: StateTransitionEvent[];
  next_action: NextAction;
}
