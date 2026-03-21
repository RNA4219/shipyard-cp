// Re-export types from main project
export type {
  TaskState,
  RiskLevel,
  WorkerType,
  WorkerStage,
  RunStatus,
  FailureClass,
  SideEffectCategory,
  Verdict,
  BlockedContext,
} from '../../src/types';

// Import for use in interfaces
import type { TaskState, RiskLevel, WorkerStage, RunStatus, Verdict, BlockedContext } from '../../src/types';

// Frontend-adapted Task type with all necessary fields
export interface Task {
  id: string;
  task_id?: string; // Legacy alias
  state: TaskState;
  title?: string;
  objective?: string;
  typed_ref?: string;
  description?: string;
  stage?: WorkerStage;
  risk_level?: RiskLevel;
  version?: number;
  repo_ref?: {
    provider: string;
    owner: string;
    name: string;
    default_branch: string;
  };
  gitHubRepo?: {
    owner: string;
    repo: string;
  };
  runId?: string;
  active_job_id?: string;
  blocked_context?: BlockedContext;
  last_verdict?: Verdict;
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  labels?: string[];
  context_bundle_ref?: string;
  rollback_notes?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// Frontend-adapted Run type
export interface Run {
  id: string;
  run_id?: string; // Legacy compatibility
  taskId: string;
  task_id?: string; // Legacy compatibility
  run_sequence?: number;
  status: RunStatus;
  currentStage?: WorkerStage;
  current_state?: TaskState;
  current_stage?: WorkerStage; // Legacy compatibility
  risk_level?: RiskLevel;
  objective?: string;
  startedAt: string;
  started_at?: string; // Legacy compatibility
  endedAt?: string;
  ended_at?: string; // Legacy compatibility
  last_event_at?: string;
  projection_version?: number;
  source_event_cursor?: string;
  blockedReason?: string;
  blocked_reason?: string; // Legacy compatibility
  job_ids?: string[];
  checkpoints?: CheckpointRef[];
  created_at?: string;
  updated_at?: string;
}

// Agent type for orchestrator display
export interface Agent {
  id: string;
  name: string;
  workerType: WorkerType;
  status: 'idle' | 'running' | 'completed' | 'failed';
  currentTask?: Task;
  progress?: number;
  message?: string;
  path?: string;
  stack?: string;
  subTasks?: number;
  startedAt: string;
  completedAt?: string;
}

// Log entry for terminal
export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
  message: string;
  agent?: string;
}

// Stats for dashboard
export interface DashboardStats {
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  blocked: number;
}

// WebSocket message types
export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

// API response types
export interface TaskListResponse {
  items: Task[];
  tasks?: Task[]; // Alternative field
  total: number;
  page: number;
  pageSize: number;
}

export interface RunListResponse {
  items: Run[];
  runs?: Run[]; // Alternative field
  total: number;
  page: number;
  pageSize: number;
}

export interface TimelineResponse {
  items: TimelineEvent[];
  events?: TimelineEvent[]; // Alternative field
  cursor?: string;
}

export interface TimelineEvent {
  id: string;
  event_id?: string;
  type: string;
  event_type?: string;
  timestamp: string;
  occurred_at?: string;
  payload: Record<string, unknown>;
}

export interface AuditSummaryResponse {
  totalEvents: number;
  total_events?: number; // Legacy alias
  eventsByType: Record<string, number>;
  event_counts?: Record<string, number>; // Legacy alias
  recentEvents: TimelineEvent[];
}

// WorkerJob type for frontend
export interface WorkerJob {
  job_id: string;
  task_id: string;
  stage: WorkerStage;
  worker_type: WorkerType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
}

// StateTransitionEvent for timeline
export interface StateTransitionEvent {
  event_id: string;
  task_id: string;
  from_state: TaskState;
  to_state: TaskState;
  actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
  actor_id: string;
  reason: string;
  occurred_at: string;
}

// Checkpoint reference
export interface CheckpointRef {
  checkpoint_id: string;
  checkpoint_type: 'code' | 'approval';
  stage: WorkerStage | 'integrate' | 'publish';
  ref: string;
  created_at: string;
}

// Task creation input
export interface CreateTaskInput {
  title: string;
  objective: string;
  typed_ref: string;
  repo_ref: {
    provider: 'github';
    owner: string;
    name: string;
    default_branch: string;
  };
  risk_level?: RiskLevel;
  description?: string;
}