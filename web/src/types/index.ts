// Types from backend (src/types.ts)

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
  | 'cancelled'
  | 'failed'
  | 'blocked';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled';

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

export interface Verdict {
  outcome: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
  reason?: string;
  manual_notes?: string;
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

export interface AuditEvent {
  event_id: string;
  event_type: string;
  task_id: string;
  run_id?: string;
  job_id?: string;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
  actor_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
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
  artifacts?: ArtifactRef[];
  labels?: string[];
  external_refs?: ExternalRef[];
  retry_counts?: Partial<Record<WorkerStage, number>>;
  last_failure_class?: string;
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface RepoPolicy {
  update_strategy: 'direct_push' | 'pull_request' | 'fast_forward_only';
  main_push_actor: 'bot' | 'human' | 'any';
  require_ci_pass: boolean;
}

export interface ArtifactRef {
  artifact_id: string;
  kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
}

export interface ExternalRef {
  kind: string;
  value: string;
  connection_ref?: string;
  link_role?: string;
  metadata_json?: string;
}

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
  projection_version: number;
  source_event_cursor: string;
  risk_level: RiskLevel;
  objective?: string;
  blocked_reason?: string;
  job_ids: string[];
  checkpoints: CheckpointRef[];
  created_at: string;
  updated_at: string;
}

export interface CheckpointRef {
  checkpoint_id: string;
  checkpoint_type: 'code' | 'approval';
  stage: WorkerStage | 'integrate' | 'publish';
  ref: string;
  created_at: string;
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
  capability_requirements: string[];
  risk_level: RiskLevel;
  retry_count?: number;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  status?: string;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}

export interface RunListResponse {
  items: Run[];
  total: number;
}

export interface TimelineResponse {
  run_id: string;
  items: StateTransitionEvent[];
}

export interface AuditSummaryResponse {
  run_id: string;
  event_counts: Record<string, number>;
  latest_events: AuditEvent[];
  total_events: number;
}

// WebSocket message types
export interface WSMessage {
  type: 'init' | 'task_update' | 'state_transition' | 'run_update' | 'pong';
  payload?: unknown;
}