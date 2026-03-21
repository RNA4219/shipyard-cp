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
import { getOrCreateRedisClient, type RedisClientLike } from 'shared-redis-utils';

export interface RedisBackendConfig {
  url?: string;
  keyPrefix?: string;
  client?: RedisClientLike;
}

/**
 * Redis backend for production use
 */
export class RedisBackend implements TaskStateBackend {
  private config: RedisBackendConfig;
  private client: RedisClientLike | null = null;
  private keyPrefix: string;

  constructor(config: RedisBackendConfig = {}) {
    this.config = config;
    this.keyPrefix = config.keyPrefix ?? 'taskstate:';
  }

  private async getClient(): Promise<RedisClientLike> {
    if (!this.client) {
      this.client = await getOrCreateRedisClient(this.client, this.config);
    }
    return this.client;
  }

  private taskKey(taskId: string): string {
    return `${this.keyPrefix}task:${taskId}`;
  }

  private transitionsKey(taskId: string): string {
    return `${this.keyPrefix}transitions:${taskId}`;
  }

  private decisionKey(decisionId: string): string {
    return `${this.keyPrefix}decision:${decisionId}`;
  }

  private decisionsByTaskKey(taskId: string): string {
    return `${this.keyPrefix}decisions:${taskId}`;
  }

  private questionKey(questionId: string): string {
    return `${this.keyPrefix}question:${questionId}`;
  }

  private questionsByTaskKey(taskId: string): string {
    return `${this.keyPrefix}questions:${taskId}`;
  }

  private runKey(runId: string): string {
    return `${this.keyPrefix}run:${runId}`;
  }

  private runsByTaskKey(taskId: string): string {
    return `${this.keyPrefix}runs:${taskId}`;
  }

  private bundleKey(bundleId: string): string {
    return `${this.keyPrefix}bundle:${bundleId}`;
  }

  private bundlesByTaskKey(taskId: string): string {
    return `${this.keyPrefix}bundles:${taskId}`;
  }

  private bundleSourcesKey(bundleId: string): string {
    return `${this.keyPrefix}bundle_sources:${bundleId}`;
  }

  private tasksListKey(): string {
    return `${this.keyPrefix}tasks:list`;
  }

  // Task operations
  async getTask(taskId: string): Promise<Task | null> {
    const redis = await this.getClient();
    const data = await redis.get(this.taskKey(taskId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async createTask(task: Task): Promise<Task> {
    const redis = await this.getClient();
    const key = this.taskKey(task.id);
    await redis.set(key, JSON.stringify(task));
    await redis.sadd(this.tasksListKey(), task.id);
    return task;
  }

  async updateTask(task: Task): Promise<Task> {
    const redis = await this.getClient();
    const key = this.taskKey(task.id);
    await redis.set(key, JSON.stringify(task));
    return task;
  }

  async deleteTask(taskId: string): Promise<void> {
    const redis = await this.getClient();

    // Delete task
    await redis.del(this.taskKey(taskId));
    await redis.srem(this.tasksListKey(), taskId);

    // Delete transitions
    await redis.del(this.transitionsKey(taskId));

    // Delete decisions
    const decisionIds = await redis.smembers(this.decisionsByTaskKey(taskId));
    for (const decisionId of decisionIds) {
      await redis.del(this.decisionKey(decisionId));
    }
    await redis.del(this.decisionsByTaskKey(taskId));

    // Delete questions
    const questionIds = await redis.smembers(this.questionsByTaskKey(taskId));
    for (const questionId of questionIds) {
      await redis.del(this.questionKey(questionId));
    }
    await redis.del(this.questionsByTaskKey(taskId));

    // Delete runs
    const runIds = await redis.smembers(this.runsByTaskKey(taskId));
    for (const runId of runIds) {
      await redis.del(this.runKey(runId));
    }
    await redis.del(this.runsByTaskKey(taskId));

    // Delete bundles
    const bundleIds = await redis.smembers(this.bundlesByTaskKey(taskId));
    for (const bundleId of bundleIds) {
      await redis.del(this.bundleKey(bundleId));
      await redis.del(this.bundleSourcesKey(bundleId));
    }
    await redis.del(this.bundlesByTaskKey(taskId));
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    const redis = await this.getClient();
    const taskIds = await redis.smembers(this.tasksListKey());
    const tasks: Task[] = [];

    for (const taskId of taskIds) {
      const data = await redis.get(this.taskKey(taskId));
      if (data) {
        tasks.push(JSON.parse(data));
      }
    }

    if (filter) {
      let result = tasks;

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

      return result;
    }

    return tasks;
  }

  // State transition operations
  async addTransition(transition: StateTransition): Promise<StateTransition> {
    const redis = await this.getClient();
    const key = this.transitionsKey(transition.task_id);
    await redis.rpush(key, JSON.stringify(transition));
    return transition;
  }

  async getTransitions(taskId: string): Promise<StateTransition[]> {
    const redis = await this.getClient();
    const key = this.transitionsKey(taskId);
    const items = await redis.lrange(key, 0, -1);
    return items.map((item: string) => JSON.parse(item));
  }

  // Decision operations
  async createDecision(decision: Decision): Promise<Decision> {
    const redis = await this.getClient();
    await redis.set(this.decisionKey(decision.id), JSON.stringify(decision));
    await redis.sadd(this.decisionsByTaskKey(decision.task_id), decision.id);
    return decision;
  }

  async getDecision(decisionId: string): Promise<Decision | null> {
    const redis = await this.getClient();
    const data = await redis.get(this.decisionKey(decisionId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async getDecisions(taskId: string): Promise<Decision[]> {
    const redis = await this.getClient();
    const decisionIds = await redis.smembers(this.decisionsByTaskKey(taskId));
    const decisions: Decision[] = [];

    for (const decisionId of decisionIds) {
      const data = await redis.get(this.decisionKey(decisionId));
      if (data) {
        decisions.push(JSON.parse(data));
      }
    }

    return decisions;
  }

  async updateDecision(decision: Decision): Promise<Decision> {
    const redis = await this.getClient();
    await redis.set(this.decisionKey(decision.id), JSON.stringify(decision));
    return decision;
  }

  // Open question operations
  async createQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    const redis = await this.getClient();
    await redis.set(this.questionKey(question.id), JSON.stringify(question));
    await redis.sadd(this.questionsByTaskKey(question.task_id), question.id);
    return question;
  }

  async getQuestion(questionId: string): Promise<OpenQuestion | null> {
    const redis = await this.getClient();
    const data = await redis.get(this.questionKey(questionId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async getQuestions(taskId: string): Promise<OpenQuestion[]> {
    const redis = await this.getClient();
    const questionIds = await redis.smembers(this.questionsByTaskKey(taskId));
    const questions: OpenQuestion[] = [];

    for (const questionId of questionIds) {
      const data = await redis.get(this.questionKey(questionId));
      if (data) {
        questions.push(JSON.parse(data));
      }
    }

    return questions;
  }

  async updateQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    const redis = await this.getClient();
    await redis.set(this.questionKey(question.id), JSON.stringify(question));
    return question;
  }

  // Run operations
  async createRun(run: Run): Promise<Run> {
    const redis = await this.getClient();
    await redis.set(this.runKey(run.id), JSON.stringify(run));
    await redis.sadd(this.runsByTaskKey(run.task_id), run.id);
    return run;
  }

  async getRun(runId: string): Promise<Run | null> {
    const redis = await this.getClient();
    const data = await redis.get(this.runKey(runId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async getRuns(taskId: string): Promise<Run[]> {
    const redis = await this.getClient();
    const runIds = await redis.smembers(this.runsByTaskKey(taskId));
    const runs: Run[] = [];

    for (const runId of runIds) {
      const data = await redis.get(this.runKey(runId));
      if (data) {
        runs.push(JSON.parse(data));
      }
    }

    return runs;
  }

  async updateRun(run: Run): Promise<Run> {
    const redis = await this.getClient();
    await redis.set(this.runKey(run.id), JSON.stringify(run));
    return run;
  }

  // Context bundle operations
  async createBundle(bundle: ContextBundle): Promise<ContextBundle> {
    const redis = await this.getClient();
    const { sources, ...bundleData } = bundle;

    await redis.set(this.bundleKey(bundle.id), JSON.stringify(bundleData));
    await redis.sadd(this.bundlesByTaskKey(bundle.task_id), bundle.id);

    // Store sources separately
    if (sources && sources.length > 0) {
      const sourcesKey = this.bundleSourcesKey(bundle.id);
      for (const source of sources) {
        await redis.rpush(sourcesKey, JSON.stringify(source));
      }
    }

    return bundle;
  }

  async getBundle(bundleId: string): Promise<ContextBundle | null> {
    const redis = await this.getClient();
    const data = await redis.get(this.bundleKey(bundleId));
    if (!data) return null;

    const bundle = JSON.parse(data);
    const sourcesData = await redis.lrange(this.bundleSourcesKey(bundleId), 0, -1);
    bundle.sources = sourcesData.map((s: string) => JSON.parse(s));

    return bundle;
  }

  async getBundles(taskId: string): Promise<ContextBundle[]> {
    const redis = await this.getClient();
    const bundleIds = await redis.smembers(this.bundlesByTaskKey(taskId));
    const bundles: ContextBundle[] = [];

    for (const bundleId of bundleIds) {
      const bundle = await this.getBundle(bundleId);
      if (bundle) {
        bundles.push(bundle);
      }
    }

    return bundles;
  }

  async addBundleSource(source: BundleSource): Promise<BundleSource> {
    const redis = await this.getClient();
    const key = this.bundleSourcesKey(source.context_bundle_id);
    await redis.rpush(key, JSON.stringify(source));
    return source;
  }

  // Utility
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}