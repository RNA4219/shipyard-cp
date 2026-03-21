import type {
  Task,
  TaskState,
  CreateTaskRequest,
  StateTransitionEvent,
} from '../../types.js';
import { TaskValidator, applyTaskUpdate } from '../../domain/task/index.js';
import type { TaskUpdate } from '../../domain/task/index.js';
import { StateMachine, TERMINAL_STATES } from '../../domain/state-machine/index.js';
import { nowIso, createId } from '../utils.js';

/**
 * Context interface for task operations that require store coordination.
 */
export interface TaskOperationContext {
  emitAuditEvent: (taskId: string, eventType: import('../../types.js').AuditEventType, payload: Record<string, unknown>, options?: {
    runId?: string;
    jobId?: string;
    actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
    actorId?: string;
  }) => import('../../types.js').AuditEvent;
  recordEvent: (event: StateTransitionEvent) => void;
}

/**
 * Service for Task CRUD operations.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class TaskService {
  private readonly tasks = new Map<string, Task>();
  private readonly stateMachine = new StateMachine();

  /**
   * Create a new task.
   */
  createTask(input: CreateTaskRequest, ctx: TaskOperationContext): Task {
    TaskValidator.validateCreateRequest(input);

    const timestamp = nowIso();
    const task: Task = {
      task_id: createId('task'),
      title: input.title,
      objective: input.objective,
      typed_ref: input.typed_ref,
      description: input.description,
      state: 'queued',
      version: 0,
      risk_level: input.risk_level ?? 'medium',
      repo_ref: input.repo_ref,
      repo_policy: input.repo_policy,
      labels: input.labels ?? [],
      publish_plan: input.publish_plan,
      artifacts: [],
      external_refs: input.external_refs ?? [],
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.tasks.set(task.task_id, task);
    ctx.recordEvent({
      event_id: createId('evt'),
      task_id: task.task_id,
      from_state: 'queued',
      to_state: 'queued',
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: 'task created',
      occurred_at: timestamp,
    });
    return task;
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List tasks with optional filtering and pagination.
   */
  listTasks(options?: { limit?: number; offset?: number; state?: TaskState[] }): Task[] {
    let tasks = Array.from(this.tasks.values());

    // Filter by state if provided
    if (options?.state && options.state.length > 0) {
      const stateSet = new Set(options.state);
      tasks = tasks.filter(t => stateSet.has(t.state));
    }

    // Sort by updated_at descending
    tasks.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return tasks.slice(offset, offset + limit);
  }

  /**
   * Require a task to exist, throwing if not found.
   */
  requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  /**
   * Touch a task to update its version and timestamp.
   */
  touchTask(task: Task): void {
    task.version += 1;
    task.updated_at = nowIso();
  }

  /**
   * Apply a TaskUpdate to a task immutably.
   */
  updateTask(taskId: string, update: TaskUpdate): Task {
    const task = this.requireTask(taskId);
    const updatedTask = applyTaskUpdate(task, update);
    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  /**
   * Store an updated task directly.
   */
  setTask(taskId: string, task: Task): void {
    this.tasks.set(taskId, task);
  }

  /**
   * Transition a task to a new state.
   */
  transitionTask(
    task: Task,
    toState: TaskState,
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
    ctx: TaskOperationContext,
  ): { event: StateTransitionEvent; task: Task } {
    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, toState);

    const timestamp = nowIso();
    const event: StateTransitionEvent = {
      event_id: createId('evt'),
      task_id: task.task_id,
      from_state: task.state,
      to_state: toState,
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      reason: input.reason,
      job_id: input.job_id,
      artifact_ids: input.artifact_ids,
      occurred_at: timestamp,
    };

    // Create updated task immutably
    const updatedTask: Task = {
      ...task,
      state: toState,
      version: task.version + 1,
      updated_at: timestamp,
    };

    if (this.stateMachine.isTerminal(toState)) {
      updatedTask.completed_at = timestamp;
    }
    if (toState !== 'blocked') {
      updatedTask.blocked_context = undefined;
    }

    // Store the updated task
    this.tasks.set(updatedTask.task_id, updatedTask);
    ctx.recordEvent(event);
    return { event, task: updatedTask };
  }

  /**
   * Record a transition event (validates and applies).
   */
  recordTransition(
    taskId: string,
    event: StateTransitionEvent,
    ctx: TaskOperationContext,
  ): StateTransitionEvent {
    const task = this.requireTask(taskId);

    // Validate event integrity
    TaskValidator.validateTransitionEvent(event, taskId, task.state);

    // Validate transition is allowed
    this.stateMachine.validateTransition(task.state, event.to_state);

    // Create updated task immutably
    const updatedTask: Task = {
      ...task,
      state: event.to_state,
      version: task.version + 1,
      updated_at: nowIso(),
    };

    // Store the updated task
    this.tasks.set(updatedTask.task_id, updatedTask);
    ctx.recordEvent(event);
    return event;
  }

  /**
   * Cancel a task.
   */
  cancel(taskId: string, ctx: TaskOperationContext): Task {
    const task = this.requireTask(taskId);
    if (TERMINAL_STATES.has(task.state)) {
      throw new Error(`task already terminal: ${task.state}`);
    }
    this.transitionTask(task, 'cancelled', {
      actor_type: 'human',
      actor_id: 'operator',
      reason: 'task cancelled',
    }, ctx);
    // Return the updated task from store
    return this.requireTask(taskId);
  }

  /**
   * Get all tasks as an iterable for iteration.
   */
  getAllTasks(): Iterable<Task> {
    return this.tasks.values();
  }

  /**
   * Get the underlying tasks map for use by other services.
   */
  getTasksMap(): Map<string, Task> {
    return this.tasks;
  }

  /**
   * Get the state machine for validation.
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  /**
   * Clear all tasks (useful for testing).
   */
  clear(): void {
    this.tasks.clear();
  }
}