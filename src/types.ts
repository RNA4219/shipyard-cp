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

// =============================================================================
// Run Read Model (ADD_REQUIREMENTS_2.md Phase A)
// =============================================================================

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

// =============================================================================
// Audit Events (ADD_REQUIREMENTS_2.md Phase A-4)
// =============================================================================

/** Audit event types for run monitoring */
export type AuditEventType =
  | 'state_transition'
  | 'job_started'
  | 'job_completed'
  | 'retry_triggered'
  | 'heartbeat_missed'
  | 'orphan_detected'
  | 'lock_conflict'
  | 'capability_mismatch'
  | 'doom_loop_detected'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'run.main_updated'
  | 'run.publishRequested'
  | 'run.publishCompleted'
  | 'task.verdictSubmitted'
  | 'run.permissionEscalated';

/** Audit event for run monitoring */
export interface AuditEvent {
  event_id: string;
  event_type: AuditEventType;
  task_id: string;
  run_id?: string;
  job_id?: string;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
  actor_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

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

// =============================================================================
// Retrospective Types (ADD_REQUIREMENTS_2.md Phase C)
// =============================================================================

/** Retrospective status */
export type RetrospectiveStatus = 'pending' | 'generating' | 'completed' | 'partial' | 'failed';

/** Summary metrics for a run */
export interface SummaryMetrics {
  total_duration_ms: number;
  stage_durations: Record<string, number>;
  job_count: number;
  job_success_count: number;
  job_failure_count: number;
  job_blocked_count: number;
  retry_count: number;
  retries_by_stage: Record<string, number>;
  risk_level: string;
  forced_high_reasons?: string[];
  litellm_usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    model?: string;
    routing?: string[];
    fallback_used?: boolean;
  };
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  checkpoint_count: number;
  checkpoints_by_stage: Record<string, number>;
  acceptance_result?: {
    outcome: string;
    checklist_complete: boolean;
    checked_count: number;
    total_checklist_items: number;
  };
  integrate_result?: {
    checks_passed: boolean;
    main_updated: boolean;
    integration_branch?: string;
  };
  publish_result?: {
    mode: string;
    approval_required: boolean;
    approval_granted?: boolean;
    targets?: string[];
    external_refs_count: number;
  };
  side_effects_detected?: string[];
  stale_docs?: string[];
}

/** Generated narrative */
export interface NarrativeGeneration {
  text: string;
  model: string;
  generated_at: string;
  input_version: string;
  generation_duration_ms?: number;
}

/** Retrospective for a completed run */
export interface Retrospective {
  retrospective_id: string;
  run_id: string;
  task_id: string;
  generation: number;
  status: RetrospectiveStatus;
  generated_at: string;
  summary_metrics: SummaryMetrics;
  narrative?: NarrativeGeneration;
  source_refs: {
    event_cursor: string;
    task_version: number;
  };
  generation_metadata: {
    model: string;
    prompt_version: string;
    source_event_cursor: string;
    input_event_count: number;
    generation_attempts: number;
  };
  error?: string;
}

/** Request for retrospective generation */
export interface RetrospectiveGenerationRequest {
  force?: boolean;
  skip_narrative?: boolean;
  model?: string;
}
