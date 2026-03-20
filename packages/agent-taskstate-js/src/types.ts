/**
 * agent-taskstate-js type definitions
 * Based on Python agent-taskstate implementation
 */

/**
 * Task states
 */
export type TaskState =
  | 'proposed'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled';

/**
 * Actor types
 */
export type ActorType = 'human' | 'agent' | 'system';

/**
 * Task entity
 */
export interface Task {
  id: string;
  kind: 'bugfix' | 'feature' | 'research';
  title: string;
  goal: string;
  status: TaskState;
  priority: 'low' | 'medium' | 'high' | 'critical';
  owner_type: ActorType;
  owner_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * State transition record
 */
export interface StateTransition {
  id: string;
  task_id: string;
  from_status: TaskState | null;
  to_status: TaskState;
  reason: string;
  actor_type: ActorType;
  actor_id?: string;
  run_id?: string;
  changed_at: string;
}

/**
 * Decision entity
 */
export interface Decision {
  id: string;
  task_id: string;
  question: string;
  options: string[];
  chosen?: string;
  rationale?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
}

/**
 * Open question entity
 */
export interface OpenQuestion {
  id: string;
  task_id: string;
  question: string;
  answer?: string;
  status: 'open' | 'answered' | 'deferred';
  created_at: string;
  updated_at: string;
}

/**
 * Run record
 */
export interface Run {
  id: string;
  task_id: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'finished' | 'failed';
  error_message?: string;
}

/**
 * Context bundle purpose types
 */
export type BundlePurpose =
  | 'continue_work'
  | 'review_prepare'
  | 'resume_after_block'
  | 'decision_support'
  | 'other';

/**
 * Rebuild level
 */
export type RebuildLevel = 'L1' | 'L2' | 'L3';

/**
 * Source kind
 */
export type SourceKind =
  | 'task'
  | 'decision'
  | 'open_question'
  | 'evidence'
  | 'artifact'
  | 'run'
  | 'tracker_issue';

/**
 * Bundle source reference
 */
export interface BundleSource {
  id: string;
  context_bundle_id: string;
  typed_ref: string;
  source_kind: SourceKind;
  selected_raw: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/**
 * Context bundle
 */
export interface ContextBundle {
  id: string;
  task_id: string;
  purpose: BundlePurpose;
  rebuild_level: RebuildLevel;
  summary?: string;
  state_snapshot: Record<string, unknown>;
  decision_digest?: Record<string, unknown>;
  question_digest?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  raw_included: boolean;
  generator_version: string;
  generated_at: string;
  created_at: string;
  sources: BundleSource[];
}

/**
 * Create task request
 */
export interface CreateTaskRequest {
  kind: 'bugfix' | 'feature' | 'research';
  title: string;
  goal: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  owner_type?: ActorType;
  owner_id?: string;
}

/**
 * Transition request
 */
export interface TransitionRequest {
  to_status: TaskState;
  reason: string;
  actor_type: ActorType;
  actor_id?: string;
  run_id?: string;
}

/**
 * Create bundle request
 */
export interface CreateBundleRequest {
  task_id: string;
  purpose: BundlePurpose;
  rebuild_level: RebuildLevel;
  state_snapshot: Record<string, unknown>;
  decision_digest?: Record<string, unknown>;
  question_digest?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  summary?: string;
  raw_included?: boolean;
}

/**
 * Add source request
 */
export interface AddSourceRequest {
  bundle_id: string;
  typed_ref: string;
  source_kind: SourceKind;
  selected_raw?: boolean;
  metadata?: Record<string, unknown>;
}