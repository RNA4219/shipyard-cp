/**
 * Redis Store Backend
 *
 * Redis-based persistence for ControlPlaneStore.
 * Enables horizontal scaling and persistence across restarts.
 */

import type { Task, WorkerJob, WorkerResult, StateTransitionEvent } from '../types.js';
import type { StoreBackend } from './store-backend.js';
import { getLogger } from '../monitoring/index.js';
import {
  TASK_TTL_SECONDS,
  JOB_TTL_SECONDS,
  RESULT_TTL_SECONDS,
  EVENT_TTL_SECONDS,
} from '../constants/index.js';

const logger = getLogger();

/**
 * Redis client interface (compatible with ioredis)
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}

/**
 * Redis backend configuration
 */
export interface RedisBackendConfig {
  /** Redis key prefix for namespace isolation */
  keyPrefix?: string;
  /** TTL for task data in seconds (default: 7 days) */
  taskTtl?: number;
  /** TTL for job data in seconds (default: 24 hours) */
  jobTtl?: number;
  /** TTL for results in seconds (default: 24 hours) */
  resultTtl?: number;
  /** TTL for events in seconds (default: 30 days) */
  eventTtl?: number;
}

const DEFAULT_KEY_PREFIX = 'shipyard-cp:';

/**
 * Redis-based store backend for production use
 */
export class RedisBackend implements StoreBackend {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly taskTtl: number;
  private readonly jobTtl: number;
  private readonly resultTtl: number;
  private readonly eventTtl: number;

  constructor(client: RedisClient, config: RedisBackendConfig = {}) {
    this.client = client;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.taskTtl = config.taskTtl ?? TASK_TTL_SECONDS;
    this.jobTtl = config.jobTtl ?? JOB_TTL_SECONDS;
    this.resultTtl = config.resultTtl ?? RESULT_TTL_SECONDS;
    this.eventTtl = config.eventTtl ?? EVENT_TTL_SECONDS;
  }

  // Key generators
  private taskKey(taskId: string): string {
    return `${this.keyPrefix}task:${taskId}`;
  }

  private jobKey(jobId: string): string {
    return `${this.keyPrefix}job:${jobId}`;
  }

  private resultKey(jobId: string): string {
    return `${this.keyPrefix}result:${jobId}`;
  }

  private eventsKey(taskId: string): string {
    return `${this.keyPrefix}events:${taskId}`;
  }

  private retryKey(key: string): string {
    return `${this.keyPrefix}retry:${key}`;
  }

  private tasksByStateKey(state: string): string {
    return `${this.keyPrefix}tasks:state:${state}`;
  }

  private tasksListKey(): string {
    return `${this.keyPrefix}tasks:list`;
  }

  private jobsByTaskKey(taskId: string): string {
    return `${this.keyPrefix}jobs:task:${taskId}`;
  }

  // Task operations
  async getTask(taskId: string): Promise<Task | null> {
    const data = await this.client.get(this.taskKey(taskId));
    if (!data) return null;
    try {
      return JSON.parse(data) as Task;
    } catch {
      logger.warn('Failed to parse task JSON from Redis', { taskId });
      return null;
    }
  }

  async setTask(task: Task): Promise<void> {
    const key = this.taskKey(task.task_id);
    const data = JSON.stringify(task);
    await this.client.set(key, data, 'EX', this.taskTtl);

    // Update state index
    const stateKey = this.tasksByStateKey(task.state);
    await this.client.lpush(stateKey, task.task_id);
    await this.client.expire(stateKey, this.taskTtl);

    // Update tasks list
    await this.client.lpush(this.tasksListKey(), task.task_id);
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      // Remove from state index (best effort)
      // Note: Redis lists don't have O(1) remove, so we skip this for now
    }
    await this.client.del(this.taskKey(taskId));
    await this.client.del(this.eventsKey(taskId));
  }

  async listTasks(options?: { state?: string; limit?: number }): Promise<Task[]> {
    const limit = options?.limit ?? 100;
    const taskIds: string[] = [];

    if (options?.state) {
      // Get from state index
      const stateKey = this.tasksByStateKey(options.state);
      const ids = await this.client.lrange(stateKey, 0, limit - 1);
      taskIds.push(...ids);
    } else {
      // Get from general list
      const ids = await this.client.lrange(this.tasksListKey(), 0, limit - 1);
      taskIds.push(...ids);
    }

    if (taskIds.length === 0) {
      return [];
    }

    // Batch fetch using mget for O(n) instead of O(n) individual gets
    const keys = taskIds.map(id => this.taskKey(id));
    const results = await this.client.mget(...keys);

    const tasks: Task[] = [];
    for (const data of results) {
      if (data) {
        try {
          tasks.push(JSON.parse(data) as Task);
        } catch {
          logger.debug('Skipping invalid task data in Redis batch fetch');
        }
      }
    }

    return tasks;
  }

  // Job operations
  async getJob(jobId: string): Promise<WorkerJob | null> {
    const data = await this.client.get(this.jobKey(jobId));
    if (!data) return null;
    try {
      return JSON.parse(data) as WorkerJob;
    } catch {
      logger.warn('Failed to parse job JSON from Redis', { jobId });
      return null;
    }
  }

  async setJob(job: WorkerJob): Promise<void> {
    const key = this.jobKey(job.job_id);
    const data = JSON.stringify(job);
    await this.client.set(key, data, 'EX', this.jobTtl);

    // Update task index for efficient lookup
    const taskIndexKey = this.jobsByTaskKey(job.task_id);
    await this.client.sadd(taskIndexKey, job.job_id);
    await this.client.expire(taskIndexKey, this.jobTtl);
  }

  async deleteJob(jobId: string): Promise<void> {
    // Get job to find task_id for index cleanup
    const job = await this.getJob(jobId);
    if (job) {
      const taskIndexKey = this.jobsByTaskKey(job.task_id);
      await this.client.srem(taskIndexKey, jobId);
    }
    await this.client.del(this.jobKey(jobId));
  }

  async listJobsByTask(taskId: string): Promise<WorkerJob[]> {
    // Use task index for O(1) lookup
    const taskIndexKey = this.jobsByTaskKey(taskId);
    const jobIds = await this.client.smembers(taskIndexKey);

    if (jobIds.length === 0) {
      return [];
    }

    // Batch fetch using mget
    const keys = jobIds.map(id => this.jobKey(id));
    const results = await this.client.mget(...keys);

    const jobs: WorkerJob[] = [];
    for (const data of results) {
      if (data) {
        try {
          jobs.push(JSON.parse(data) as WorkerJob);
        } catch {
          logger.debug('Skipping invalid job data in Redis batch fetch');
        }
      }
    }

    return jobs;
  }

  // Result operations
  async getResult(jobId: string): Promise<WorkerResult | null> {
    const data = await this.client.get(this.resultKey(jobId));
    if (!data) return null;
    try {
      return JSON.parse(data) as WorkerResult;
    } catch {
      logger.warn('Failed to parse result JSON from Redis', { jobId });
      return null;
    }
  }

  async setResult(result: WorkerResult): Promise<void> {
    const key = this.resultKey(result.job_id);
    const data = JSON.stringify(result);
    await this.client.set(key, data, 'EX', this.resultTtl);
  }

  async deleteResult(jobId: string): Promise<void> {
    await this.client.del(this.resultKey(jobId));
  }

  // Event operations
  async getEvents(taskId: string): Promise<StateTransitionEvent[]> {
    const key = this.eventsKey(taskId);
    const data = await this.client.lrange(key, 0, -1);
    const events: StateTransitionEvent[] = [];

    for (const item of data) {
      try {
        events.push(JSON.parse(item) as StateTransitionEvent);
      } catch {
        logger.debug('Skipping invalid event data in Redis', { taskId });
      }
    }

    return events;
  }

  async addEvent(taskId: string, event: StateTransitionEvent): Promise<void> {
    const key = this.eventsKey(taskId);
    const data = JSON.stringify(event);
    await this.client.lpush(key, data);
    await this.client.expire(key, this.eventTtl);
  }

  // Retry tracking
  async getRetryCount(key: string): Promise<number> {
    const data = await this.client.get(this.retryKey(key));
    return data ? parseInt(data, 10) : 0;
  }

  async setRetryCount(key: string, count: number): Promise<void> {
    await this.client.set(this.retryKey(key), String(count), 'EX', this.jobTtl);
  }

  async incrementRetryCount(key: string): Promise<number> {
    const newCount = await this.client.incr(this.retryKey(key));
    await this.client.expire(this.retryKey(key), this.jobTtl);
    return newCount;
  }

  // Utility
  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.client.keys(pattern);

    if (keys.length > 0) {
      // Delete in batches to avoid blocking
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await Promise.all(batch.map(key => this.client.del(key)));
      }
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.client.ping();
      const latencyMs = Date.now() - start;
      return { healthy: true, latencyMs };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
  }
}