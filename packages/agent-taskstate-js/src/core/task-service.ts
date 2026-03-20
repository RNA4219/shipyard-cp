import type {
  Task,
  Decision,
  OpenQuestion,
  Run,
  CreateTaskRequest,
} from '../types.js';
import type { TaskStateBackend, TaskFilter } from '../store/store-backend.js';
import { StateTransitionService } from './state-transition.js';
import { ContextBundleService } from './context-bundle.js';
import { generateId } from '../utils.js';

/**
 * Task service providing unified API for task operations
 */
export class TaskService {
  private backend: TaskStateBackend;
  private transitions: StateTransitionService;
  private bundles: ContextBundleService;

  constructor(backend: TaskStateBackend) {
    this.backend = backend;
    this.transitions = new StateTransitionService(backend);
    this.bundles = new ContextBundleService(backend);
  }

  // ==================== Task CRUD ====================

  /**
   * Create a new task
   */
  async createTask(request: CreateTaskRequest): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${generateId()}`,
      kind: request.kind,
      title: request.title,
      goal: request.goal,
      status: 'proposed',
      priority: request.priority ?? 'medium',
      owner_type: request.owner_type ?? 'system',
      owner_id: request.owner_id ?? 'default',
      revision: 1,
      created_at: now,
      updated_at: now,
    };

    return this.transitions.propose(task);
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.backend.getTask(taskId);
  }

  /**
   * Update a task's properties (not status - use transitions for that)
   */
  async updateTask(taskId: string, updates: Partial<Pick<Task, 'title' | 'goal' | 'priority' | 'owner_type' | 'owner_id'>>): Promise<Task> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...task,
      ...updates,
      revision: task.revision + 1,
      updated_at: now,
    };

    return this.backend.updateTask(updatedTask);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    return this.backend.deleteTask(taskId);
  }

  /**
   * List tasks with optional filter
   */
  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    return this.backend.listTasks(filter);
  }

  // ==================== State Transitions ====================

  /**
   * Get state transition service
   */
  get stateTransitions(): StateTransitionService {
    return this.transitions;
  }

  // ==================== Decisions ====================

  /**
   * Create a decision for a task
   */
  async createDecision(taskId: string, question: string, options: string[]): Promise<Decision> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = new Date().toISOString();
    const decision: Decision = {
      id: `decision-${generateId()}`,
      task_id: taskId,
      question,
      options,
      status: 'pending',
      created_at: now,
      updated_at: now,
    };

    return this.backend.createDecision(decision);
  }

  /**
   * Get a decision by ID
   */
  async getDecision(decisionId: string): Promise<Decision | null> {
    return this.backend.getDecision(decisionId);
  }

  /**
   * Get all decisions for a task
   */
  async getDecisions(taskId: string): Promise<Decision[]> {
    return this.backend.getDecisions(taskId);
  }

  /**
   * Resolve a decision (choose an option)
   */
  async resolveDecision(decisionId: string, chosen: string, rationale?: string): Promise<Decision> {
    const decision = await this.backend.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    if (!decision.options.includes(chosen)) {
      throw new Error(`Invalid option '${chosen}'. Valid options: ${decision.options.join(', ')}`);
    }

    const now = new Date().toISOString();
    const updated: Decision = {
      ...decision,
      chosen,
      rationale,
      status: 'accepted',
      updated_at: now,
    };

    return this.backend.updateDecision(updated);
  }

  /**
   * Reject a decision
   */
  async rejectDecision(decisionId: string, rationale: string): Promise<Decision> {
    const decision = await this.backend.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    const now = new Date().toISOString();
    const updated: Decision = {
      ...decision,
      rationale,
      status: 'rejected',
      updated_at: now,
    };

    return this.backend.updateDecision(updated);
  }

  // ==================== Open Questions ====================

  /**
   * Create an open question for a task
   */
  async createQuestion(taskId: string, question: string): Promise<OpenQuestion> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = new Date().toISOString();
    const openQuestion: OpenQuestion = {
      id: `question-${generateId()}`,
      task_id: taskId,
      question,
      status: 'open',
      created_at: now,
      updated_at: now,
    };

    return this.backend.createQuestion(openQuestion);
  }

  /**
   * Get a question by ID
   */
  async getQuestion(questionId: string): Promise<OpenQuestion | null> {
    return this.backend.getQuestion(questionId);
  }

  /**
   * Get all questions for a task
   */
  async getQuestions(taskId: string): Promise<OpenQuestion[]> {
    return this.backend.getQuestions(taskId);
  }

  /**
   * Answer a question
   */
  async answerQuestion(questionId: string, answer: string): Promise<OpenQuestion> {
    const question = await this.backend.getQuestion(questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const now = new Date().toISOString();
    const updated: OpenQuestion = {
      ...question,
      answer,
      status: 'answered',
      updated_at: now,
    };

    return this.backend.updateQuestion(updated);
  }

  /**
   * Defer a question
   */
  async deferQuestion(questionId: string): Promise<OpenQuestion> {
    const question = await this.backend.getQuestion(questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const now = new Date().toISOString();
    const updated: OpenQuestion = {
      ...question,
      status: 'deferred',
      updated_at: now,
    };

    return this.backend.updateQuestion(updated);
  }

  // ==================== Runs ====================

  /**
   * Start a new run for a task
   */
  async startRun(taskId: string): Promise<Run> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const run: Run = {
      id: `run-${generateId()}`,
      task_id: taskId,
      started_at: new Date().toISOString(),
      status: 'running',
    };

    return this.backend.createRun(run);
  }

  /**
   * Get a run by ID
   */
  async getRun(runId: string): Promise<Run | null> {
    return this.backend.getRun(runId);
  }

  /**
   * Get all runs for a task
   */
  async getRuns(taskId: string): Promise<Run[]> {
    return this.backend.getRuns(taskId);
  }

  /**
   * Finish a run successfully
   */
  async finishRun(runId: string): Promise<Run> {
    const run = await this.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const updated: Run = {
      ...run,
      finished_at: new Date().toISOString(),
      status: 'finished',
    };

    return this.backend.updateRun(updated);
  }

  /**
   * Fail a run with an error
   */
  async failRun(runId: string, errorMessage: string): Promise<Run> {
    const run = await this.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const updated: Run = {
      ...run,
      finished_at: new Date().toISOString(),
      status: 'failed',
      error_message: errorMessage,
    };

    return this.backend.updateRun(updated);
  }

  // ==================== Context Bundles ====================

  /**
   * Get context bundle service
   */
  get contextBundles(): ContextBundleService {
    return this.bundles;
  }
}