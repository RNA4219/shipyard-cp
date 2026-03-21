import type {
  Task,
  Run,
  RunStatus,
  WorkerStage,
  StateTransitionEvent,
  AuditEvent,
  CheckpointRef,
} from '../../types.js';
import type { CheckpointService } from '../checkpoint/index.js';

/**
 * Context for run operations
 */
export interface RunContext {
  getTask(taskId: string): Task | undefined;
  getEvents(taskId: string): StateTransitionEvent[];
  getAuditEvents(taskId: string): AuditEvent[];
}

/**
 * Dependencies for RunService
 */
export interface RunDeps {
  checkpointService: CheckpointService;
}

/**
 * Service for Run read model operations.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class RunService {
  constructor(private readonly deps: RunDeps) {}

  /**
   * List all runs with optional pagination.
   * Each Task is mapped to a Run read model for visualization.
   */
  listRuns(
    tasks: Iterable<Task>,
    ctx: RunContext,
    options?: { limit?: number; offset?: number; status?: RunStatus[] },
  ): Run[] {
    const taskArray = Array.from(tasks);
    const runs = taskArray.map(task => this.taskToRun(task, ctx));

    // Filter by status if provided
    const filtered = options?.status
      ? runs.filter(run => options.status!.includes(run.status))
      : runs;

    // Sort by updated_at descending
    filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get a specific run by ID.
   * Run ID is the same as task_id for the current implementation.
   */
  getRun(runId: string, ctx: RunContext): Run | undefined {
    // For now, run_id === task_id (single run per task)
    const task = ctx.getTask(runId);
    if (!task) return undefined;
    return this.taskToRun(task, ctx);
  }

  /**
   * Get timeline events for a run.
   * Returns state transition events in chronological order.
   */
  getRunTimeline(runId: string, ctx: RunContext): StateTransitionEvent[] {
    const events = ctx.getEvents(runId);
    return [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  /**
   * Get audit summary for a run.
   * Aggregates audit events by type with counts and latest occurrence.
   */
  getRunAuditSummary(runId: string, ctx: RunContext): {
    event_counts: Record<string, number>;
    latest_events: AuditEvent[];
    total_events: number;
  } {
    const auditEvents = ctx.getAuditEvents(runId);
    const events = auditEvents.length > 0
      ? auditEvents
      : ctx.getEvents(runId).map((event): AuditEvent => ({
          event_id: event.event_id,
          event_type: 'state_transition',
          task_id: event.task_id,
          run_id: runId,
          job_id: event.job_id,
          actor_type: event.actor_type,
          actor_id: event.actor_id,
          payload: {
            from_state: event.from_state,
            to_state: event.to_state,
            reason: event.reason,
            artifact_ids: event.artifact_ids ?? [],
          },
          occurred_at: event.occurred_at,
        }));

      // Count events by type
    const eventCounts: Record<string, number> = {};
    for (const event of events) {
      eventCounts[event.event_type] = (eventCounts[event.event_type] ?? 0) + 1;
    }

    // Get latest 10 events
    const latestEvents = [...events]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 10);

    return {
      event_counts: eventCounts,
      latest_events: latestEvents,
      total_events: events.length,
    };
  }

  /**
   * Get checkpoints for a run.
   */
  getRunCheckpoints(runId: string): CheckpointRef[] {
    const records = this.deps.checkpointService.listCheckpointsForRun(runId);
    return this.deps.checkpointService.toCheckpointRefs(records);
  }

  /**
   * Get checkpoints for a task.
   */
  getTaskCheckpoints(taskId: string): CheckpointRef[] {
    const records = this.deps.checkpointService.listCheckpointsForTask(taskId);
    return this.deps.checkpointService.toCheckpointRefs(records);
  }

  /**
   * Convert a Task to a Run read model.
   */
  taskToRun(task: Task, ctx: RunContext): Run {
    const events = ctx.getEvents(task.task_id);
    const lastEvent = events.length > 0
      ? events.reduce((a, b) => a.occurred_at > b.occurred_at ? a : b)
      : undefined;

    // Get checkpoints from checkpoint service
    const checkpointRecords = this.deps.checkpointService.listCheckpointsForTask(task.task_id);
    const checkpoints = this.deps.checkpointService.toCheckpointRefs(checkpointRecords);

    return {
      run_id: task.task_id,
      task_id: task.task_id,
      run_sequence: 1, // Single run per task for now
      status: this.mapTaskStateToRunStatus(task.state),
      current_stage: this.getCurrentStage(task.state),
      current_state: task.state,
      started_at: task.created_at,
      ended_at: task.completed_at,
      last_event_at: lastEvent?.occurred_at ?? task.updated_at,
      projection_version: task.version,
      source_event_cursor: lastEvent?.event_id ?? '',
      risk_level: task.risk_level,
      objective: task.objective,
      blocked_reason: task.blocked_context?.reason,
      job_ids: this.getJobIdsForTask(task),
      checkpoints,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  /**
   * Map TaskState to RunStatus for visualization.
   */
  mapTaskStateToRunStatus(state: Task['state']): RunStatus {
    switch (state) {
      case 'queued':
      case 'planning':
      case 'planned':
      case 'developing':
      case 'dev_completed':
      case 'accepting':
      case 'integrating':
      case 'publishing':
        return 'running';
      case 'accepted':
      case 'integrated':
        return 'running'; // Intermediate success states
      case 'published':
        return 'succeeded';
      case 'blocked':
        return 'blocked';
      case 'cancelled':
        return 'cancelled';
      case 'failed':
      case 'rework_required':
      case 'publish_pending_approval':
        return state === 'failed' ? 'failed' : 'running';
      default:
        return 'running';
    }
  }

  /**
   * Get current stage based on task state.
   */
  getCurrentStage(state: Task['state']): WorkerStage | undefined {
    switch (state) {
      case 'queued':
      case 'planning':
      case 'planned':
        return 'plan';
      case 'developing':
      case 'dev_completed':
      case 'rework_required':
        return 'dev';
      case 'accepting':
      case 'accepted':
        return 'acceptance';
      default:
        return undefined;
    }
  }

  /**
   * Get all job IDs associated with a task.
   */
  getJobIdsForTask(task: Task): string[] {
    const jobIds: string[] = [];
    if (task.active_job_id) {
      jobIds.push(task.active_job_id);
    }
    if (task.latest_job_ids) {
      for (const jobId of Object.values(task.latest_job_ids)) {
        if (jobId && !jobIds.includes(jobId)) {
          jobIds.push(jobId);
        }
      }
    }
    return jobIds;
  }
}
