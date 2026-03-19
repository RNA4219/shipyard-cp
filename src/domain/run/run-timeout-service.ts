import type { Task, IntegrationRun, PublishRun, StateTransitionEvent } from '../../types.js';
import { nowIso } from '../../store/utils.js';

/**
 * Context for run timeout operations
 */
export interface RunTimeoutContext {
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): { event: StateTransitionEvent; task: Task };
}

/**
 * Handles integration and publish run timeout detection and management.
 */
export class RunTimeoutService {
  /**
   * Check for timed-out integration/publish runs and mark them as timeout.
   * Returns list of tasks that have timed out.
   */
  checkTimeouts(tasks: Iterable<Task>, ctx: RunTimeoutContext): Task[] {
    const now = new Date();
    const timedOutTasks: Task[] = [];

    for (const task of tasks) {
      // Check integration timeout
      if (task.state === 'integrating' && task.integration_run) {
        if (this.checkIntegrationTimeout(task, now, ctx)) {
          timedOutTasks.push(task);
        }
      }

      // Check publish timeout
      if (task.state === 'publishing' && task.publish_run) {
        if (this.checkPublishTimeout(task, now, ctx)) {
          timedOutTasks.push(task);
        }
      }
    }

    return timedOutTasks;
  }

  private checkIntegrationTimeout(task: Task, now: Date, ctx: RunTimeoutContext): boolean {
    if (!task.integration_run) return false;

    const timeoutAt = new Date(task.integration_run.timeout_at);
    if (now > timeoutAt && task.integration_run.status === 'running') {
      const nowIsoStr = nowIso();
      const updatedTask: Task = {
        ...task,
        integration_run: {
          ...task.integration_run,
          status: 'timeout',
          error: 'integration timeout',
          completed_at: nowIsoStr,
        },
        blocked_context: {
          resume_state: 'integrating',
          reason: 'integration timed out',
          waiting_on: 'github',
        },
      };

      ctx.transitionTask(updatedTask, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'integration timeout',
      });

      return true;
    }

    return false;
  }

  private checkPublishTimeout(task: Task, now: Date, ctx: RunTimeoutContext): boolean {
    if (!task.publish_run) return false;

    const timeoutAt = new Date(task.publish_run.timeout_at);
    if (now > timeoutAt && task.publish_run.status === 'running') {
      const nowIsoStr = nowIso();
      const updatedTask: Task = {
        ...task,
        publish_run: {
          ...task.publish_run,
          status: 'timeout',
          error: 'publish timeout',
          completed_at: nowIsoStr,
        },
        blocked_context: {
          resume_state: 'publishing',
          reason: 'publish timed out',
          waiting_on: 'environment',
        },
      };

      ctx.transitionTask(updatedTask, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'publish timeout',
      });

      return true;
    }

    return false;
  }

  /**
   * Get all tasks currently in integrating or publishing state with run metadata.
   */
  getActiveRuns(tasks: Iterable<Task>): Array<{ task: Task; run: IntegrationRun | PublishRun; type: 'integration' | 'publish' }> {
    const result: Array<{ task: Task; run: IntegrationRun | PublishRun; type: 'integration' | 'publish' }> = [];

    for (const task of tasks) {
      if (task.state === 'integrating' && task.integration_run) {
        result.push({ task, run: task.integration_run, type: 'integration' });
      }
      if (task.state === 'publishing' && task.publish_run) {
        result.push({ task, run: task.publish_run, type: 'publish' });
      }
    }

    return result;
  }

  /**
   * Update progress for an integration run.
   */
  updateIntegrationProgress(task: Task, progress: number): void {
    if (task.integration_run) {
      task.integration_run.progress = Math.min(100, Math.max(0, progress));
      task.updated_at = nowIso();
    }
  }

  /**
   * Update progress for a publish run.
   */
  updatePublishProgress(task: Task, progress: number): void {
    if (task.publish_run) {
      task.publish_run.progress = Math.min(100, Math.max(0, progress));
      task.updated_at = nowIso();
    }
  }
}