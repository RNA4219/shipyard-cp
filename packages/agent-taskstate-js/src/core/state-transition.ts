import type { TaskState, Task, StateTransition, ActorType, TransitionRequest } from '../types.js';
import type { TaskStateBackend } from '../store/store-backend.js';
import { generateId } from '../utils.js';

/**
 * Valid state transitions map
 * Defines which transitions are allowed from each state
 * Each state can transition to itself for idempotency
 */
const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  proposed: ['proposed', 'ready', 'in_progress', 'blocked', 'review', 'cancelled'],
  ready: ['ready', 'proposed', 'in_progress', 'blocked', 'review', 'cancelled'],
  in_progress: ['in_progress', 'proposed', 'ready', 'blocked', 'review', 'done', 'cancelled'],
  blocked: ['blocked', 'proposed', 'ready', 'in_progress', 'review', 'cancelled'],
  review: ['review', 'proposed', 'ready', 'in_progress', 'blocked', 'done', 'cancelled'],
  done: ['done', 'review', 'in_progress'], // Can reopen from done
  cancelled: ['cancelled', 'proposed', 'ready'], // Can reopen from cancelled
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: TaskState | null, to: TaskState): boolean {
  // Initial state (from null) can only go to 'proposed'
  if (from === null) {
    return to === 'proposed';
  }
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get valid target states from a given state
 */
export function getValidTargetStates(from: TaskState): TaskState[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * State transition service
 */
export class StateTransitionService {
  private backend: TaskStateBackend;

  constructor(backend: TaskStateBackend) {
    this.backend = backend;
  }

  /**
   * Transition a task to a new state
   */
  async transition(taskId: string, request: TransitionRequest): Promise<StateTransition> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const fromStatus = task.status;
    const toStatus = request.to_status;

    // Validate transition
    if (!isValidTransition(fromStatus, toStatus)) {
      throw new Error(
        `Invalid transition from '${fromStatus}' to '${toStatus}'. Valid targets: ${getValidTargetStates(fromStatus).join(', ') || 'none'}`
      );
    }

    const now = new Date().toISOString();

    // Create transition record
    const transition: StateTransition = {
      id: generateId(),
      task_id: taskId,
      from_status: fromStatus,
      to_status: toStatus,
      reason: request.reason,
      actor_type: request.actor_type,
      actor_id: request.actor_id,
      run_id: request.run_id,
      changed_at: now,
    };

    // Store transition
    await this.backend.addTransition(transition);

    // Update task
    const updatedTask: Task = {
      ...task,
      status: toStatus,
      revision: task.revision + 1,
      updated_at: now,
      completed_at: toStatus === 'done' || toStatus === 'cancelled' ? now : task.completed_at,
    };

    await this.backend.updateTask(updatedTask);

    return transition;
  }

  /**
   * Get transition history for a task
   */
  async getHistory(taskId: string): Promise<StateTransition[]> {
    return this.backend.getTransitions(taskId);
  }

  /**
   * Get current state of a task
   */
  async getCurrentState(taskId: string): Promise<TaskState | null> {
    const task = await this.backend.getTask(taskId);
    return task?.status ?? null;
  }

  /**
   * Check if a task is in a terminal state
   */
  async isTerminal(taskId: string): Promise<boolean> {
    const state = await this.getCurrentState(taskId);
    return state === 'done' || state === 'cancelled';
  }

  /**
   * Propose a new task (create with 'proposed' state)
   */
  async propose(task: Omit<Task, 'status' | 'revision' | 'created_at' | 'updated_at'>): Promise<Task> {
    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      status: 'proposed',
      revision: 1,
      created_at: now,
      updated_at: now,
    };

    await this.backend.createTask(newTask);

    // Create initial transition record
    const transition: StateTransition = {
      id: generateId(),
      task_id: task.id,
      from_status: null,
      to_status: 'proposed',
      reason: 'Task created',
      actor_type: 'system',
      changed_at: now,
    };

    await this.backend.addTransition(transition);

    return newTask;
  }

  /**
   * Mark task as ready for work
   */
  async markReady(taskId: string, actorType: ActorType, actorId?: string, reason?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'ready',
      reason: reason ?? 'Task marked as ready',
      actor_type: actorType,
      actor_id: actorId,
    });
  }

  /**
   * Start work on a task
   */
  async startWork(taskId: string, actorType: ActorType, actorId?: string, runId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'in_progress',
      reason: 'Work started',
      actor_type: actorType,
      actor_id: actorId,
      run_id: runId,
    });
  }

  /**
   * Block a task
   */
  async block(taskId: string, reason: string, actorType: ActorType, actorId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'blocked',
      reason,
      actor_type: actorType,
      actor_id: actorId,
    });
  }

  /**
   * Unblock a task (move back to in_progress)
   */
  async unblock(taskId: string, reason: string, actorType: ActorType, actorId?: string, runId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'in_progress',
      reason,
      actor_type: actorType,
      actor_id: actorId,
      run_id: runId,
    });
  }

  /**
   * Submit task for review
   */
  async submitForReview(taskId: string, actorType: ActorType, actorId?: string, runId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'review',
      reason: 'Submitted for review',
      actor_type: actorType,
      actor_id: actorId,
      run_id: runId,
    });
  }

  /**
   * Complete a task (mark as done)
   */
  async complete(taskId: string, reason: string, actorType: ActorType, actorId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'done',
      reason,
      actor_type: actorType,
      actor_id: actorId,
    });
  }

  /**
   * Request changes on a task (move back to in_progress from review)
   */
  async requestChanges(taskId: string, reason: string, actorType: ActorType, actorId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'in_progress',
      reason: `Changes requested: ${reason}`,
      actor_type: actorType,
      actor_id: actorId,
    });
  }

  /**
   * Cancel a task
   */
  async cancel(taskId: string, reason: string, actorType: ActorType, actorId?: string): Promise<StateTransition> {
    return this.transition(taskId, {
      to_status: 'cancelled',
      reason,
      actor_type: actorType,
      actor_id: actorId,
    });
  }
}