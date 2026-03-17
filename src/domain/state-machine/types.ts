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

export type WorkerStage = 'plan' | 'dev' | 'acceptance';

export type ActiveState = 'planning' | 'developing' | 'accepting';

export const TERMINAL_STATES = new Set<TaskState>([
  'completed',
  'cancelled',
  'failed',
  'published',
]);