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
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<number | string>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
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

const TASK_CAS_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local next = cjson.decode(ARGV[1])
local expectedVersion = tonumber(ARGV[2])
if existing then
  local current = cjson.decode(existing)
  if current.version == next.version then
    if existing == ARGV[1] then return 1 end
    return 0
  end
  if current.version ~= expectedVersion then return 0 end
  if current.state ~= next.state then
    redis.call('SREM', ARGV[5] .. 'tasks:state:' .. current.state, ARGV[4])
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('SADD', KEYS[3], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 1
`;


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
  private recordKey(kind: string, id: string): string {
    return `${this.keyPrefix}record:${kind}:${id}`;
  }

  private recordsIndexKey(kind: string): string {
    return `${this.keyPrefix}records:${kind}`;
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
    const taskVersion = Number.isInteger(task.version) ? task.version : 0;
    const expectedVersion = taskVersion === 0 ? -1 : taskVersion - 1;
    const result = await this.client.eval(
      TASK_CAS_SCRIPT,
      3,
      key,
      this.tasksByStateKey(task.state),
      this.tasksListKey(),
      data,
      String(expectedVersion),
      String(this.taskTtl),
      task.task_id,
      this.keyPrefix,
    );
    if (Number(result) !== 1) throw new Error(`VERSION_CONFLICT: task ${task.task_id}`);
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      await this.client.srem(this.tasksByStateKey(task.state), taskId);
    }
    await this.client.srem(this.tasksListKey(), taskId);
    await this.client.del(this.taskKey(taskId));
    await this.client.del(this.eventsKey(taskId));
  }

  async listTasks(options?: { state?: string; limit?: number }): Promise<Task[]> {
    const limit = options?.limit ?? 100;
    const taskIds: string[] = [];

    if (options?.state) {
      const stateKey = this.tasksByStateKey(options.state);
      const ids = await this.client.smembers(stateKey);
      taskIds.push(...ids.slice(0, limit));
    } else {
      const ids = await this.client.smembers(this.tasksListKey());
      taskIds.push(...ids.slice(0, limit));
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
    await this.client.rpush(key, data);
    await this.client.expire(key, this.eventTtl);
  }

  async replaceEvents(taskId: string, events: StateTransitionEvent[]): Promise<void> {
    const key = this.eventsKey(taskId);
    await this.client.del(key);
    if (events.length === 0) return;
    await this.client.rpush(...([key, ...events.map(event => JSON.stringify(event))] as [string, ...string[]]));
    await this.client.expire(key, this.eventTtl);
  }

  // Retry tracking
  async setRecord(kind: string, id: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const recordKey = this.recordKey(kind, id);
    const indexKey = this.recordsIndexKey(kind);
    if (ttlSeconds === undefined) {
      await this.client.set(recordKey, JSON.stringify(value));
    } else {
      await this.client.set(recordKey, JSON.stringify(value), 'EX', ttlSeconds);
    }
    await this.client.sadd(indexKey, id);
    if (ttlSeconds !== undefined) await this.client.expire(indexKey, ttlSeconds);
  }

  async getRecord<T>(kind: string, id: string): Promise<T | null> {
    const data = await this.client.get(this.recordKey(kind, id));
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      logger.warn('Failed to parse JSON record from Redis', { kind, id });
      return null;
    }
  }

  async listRecords<T>(kind: string): Promise<T[]> {
    const ids = await this.client.smembers(this.recordsIndexKey(kind));
    if (ids.length === 0) return [];
    const records: T[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const values = await this.client.mget(...batch.map(id => this.recordKey(kind, id)));
      for (const value of values) {
        if (!value) continue;
        try {
          records.push(JSON.parse(value) as T);
        } catch {
          logger.warn('Skipping invalid JSON record from Redis', { kind });
        }
      }
    }
    return records;
  }

  async deleteRecord(kind: string, id: string): Promise<void> {
    await this.client.del(this.recordKey(kind, id));
    await this.client.srem(this.recordsIndexKey(kind), id);
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
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      if (keys.length > 0) await Promise.all(keys.map(key => this.client.del(key)));
      cursor = nextCursor;
    } while (cursor !== '0');
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