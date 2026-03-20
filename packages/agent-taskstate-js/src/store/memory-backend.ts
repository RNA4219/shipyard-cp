import type {
  Task,
  StateTransition,
  Decision,
  OpenQuestion,
  Run,
  ContextBundle,
  BundleSource,
} from '../types.js';
import type { TaskStateBackend, TaskFilter } from './store-backend.js';

/**
 * In-memory backend for development and testing
 */
export class InMemoryBackend implements TaskStateBackend {
  private tasks: Map<string, Task> = new Map();
  private transitions: Map<string, StateTransition[]> = new Map();
  private decisions: Map<string, Decision> = new Map();
  private questions: Map<string, OpenQuestion> = new Map();
  private runs: Map<string, Run> = new Map();
  private bundles: Map<string, ContextBundle> = new Map();
  private bundleSources: Map<string, BundleSource[]> = new Map();

  // Task operations
  async getTask(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    return task;
  }

  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.transitions.delete(taskId);
    // Clean up related entities
    for (const [id, decision] of this.decisions) {
      if (decision.task_id === taskId) {
        this.decisions.delete(id);
      }
    }
    for (const [id, question] of this.questions) {
      if (question.task_id === taskId) {
        this.questions.delete(id);
      }
    }
    for (const [id, run] of this.runs) {
      if (run.task_id === taskId) {
        this.runs.delete(id);
      }
    }
    for (const [id, bundle] of this.bundles) {
      if (bundle.task_id === taskId) {
        this.bundles.delete(id);
        this.bundleSources.delete(id);
      }
    }
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let result = Array.from(this.tasks.values());

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        result = result.filter(t => statuses.includes(t.status));
      }
      if (filter.owner_id) {
        result = result.filter(t => t.owner_id === filter.owner_id);
      }
      if (filter.owner_type) {
        result = result.filter(t => t.owner_type === filter.owner_type);
      }
      if (filter.kind) {
        const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
        result = result.filter(t => kinds.includes(t.kind));
      }
      if (filter.priority) {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        result = result.filter(t => priorities.includes(t.priority));
      }
      if (filter.offset !== undefined) {
        result = result.slice(filter.offset);
      }
      if (filter.limit !== undefined) {
        result = result.slice(0, filter.limit);
      }
    }

    return result;
  }

  // State transition operations
  async addTransition(transition: StateTransition): Promise<StateTransition> {
    const taskTransitions = this.transitions.get(transition.task_id) ?? [];
    taskTransitions.push(transition);
    this.transitions.set(transition.task_id, taskTransitions);
    return transition;
  }

  async getTransitions(taskId: string): Promise<StateTransition[]> {
    return this.transitions.get(taskId) ?? [];
  }

  // Decision operations
  async createDecision(decision: Decision): Promise<Decision> {
    this.decisions.set(decision.id, decision);
    return decision;
  }

  async getDecision(decisionId: string): Promise<Decision | null> {
    return this.decisions.get(decisionId) ?? null;
  }

  async getDecisions(taskId: string): Promise<Decision[]> {
    return Array.from(this.decisions.values()).filter(d => d.task_id === taskId);
  }

  async updateDecision(decision: Decision): Promise<Decision> {
    this.decisions.set(decision.id, decision);
    return decision;
  }

  // Open question operations
  async createQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    this.questions.set(question.id, question);
    return question;
  }

  async getQuestion(questionId: string): Promise<OpenQuestion | null> {
    return this.questions.get(questionId) ?? null;
  }

  async getQuestions(taskId: string): Promise<OpenQuestion[]> {
    return Array.from(this.questions.values()).filter(q => q.task_id === taskId);
  }

  async updateQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    this.questions.set(question.id, question);
    return question;
  }

  // Run operations
  async createRun(run: Run): Promise<Run> {
    this.runs.set(run.id, run);
    return run;
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.runs.get(runId) ?? null;
  }

  async getRuns(taskId: string): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(r => r.task_id === taskId);
  }

  async updateRun(run: Run): Promise<Run> {
    this.runs.set(run.id, run);
    return run;
  }

  // Context bundle operations
  async createBundle(bundle: ContextBundle): Promise<ContextBundle> {
    this.bundles.set(bundle.id, bundle);
    this.bundleSources.set(bundle.id, bundle.sources ?? []);
    return bundle;
  }

  async getBundle(bundleId: string): Promise<ContextBundle | null> {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return null;
    return {
      ...bundle,
      sources: this.bundleSources.get(bundleId) ?? [],
    };
  }

  async getBundles(taskId: string): Promise<ContextBundle[]> {
    const bundles = Array.from(this.bundles.values()).filter(b => b.task_id === taskId);
    return bundles.map(b => ({
      ...b,
      sources: this.bundleSources.get(b.id) ?? [],
    }));
  }

  async addBundleSource(source: BundleSource): Promise<BundleSource> {
    const sources = this.bundleSources.get(source.context_bundle_id) ?? [];
    sources.push(source);
    this.bundleSources.set(source.context_bundle_id, sources);
    return source;
  }

  // Utility
  async close(): Promise<void> {
    // No cleanup needed for in-memory
  }
}