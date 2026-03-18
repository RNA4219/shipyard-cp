import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryBackend } from '../src/store/store-backend.js';
import { RedisBackend, type RedisClient } from '../src/store/redis-backend.js';
import type { Task, WorkerJob, WorkerResult, StateTransitionEvent } from '../src/types.js';

// Mock Redis client for testing
class MockRedisClient implements RedisClient {
  private data = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key) || this.lists.has(key);
    this.data.delete(key);
    this.lists.delete(key);
    return existed ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.data.keys()).filter(k => regex.test(k));
  }

  async incr(key: string): Promise<number> {
    const current = parseInt(this.data.get(key) ?? '0', 10);
    const newValue = current + 1;
    this.data.set(key, String(newValue));
    return newValue;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.data.has(key) ? 1 : 0;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<void> {
    // No-op for mock
  }
}

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend;

  beforeEach(() => {
    backend = new InMemoryBackend();
  });

  describe('Task operations', () => {
    it('should store and retrieve a task', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await backend.setTask(task);
      const retrieved = await backend.getTask('task_123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.task_id).toBe('task_123');
      expect(retrieved?.title).toBe('Test Task');
    });

    it('should return null for non-existent task', async () => {
      const result = await backend.getTask('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a task', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test',
        objective: 'Test',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await backend.setTask(task);
      await backend.deleteTask('task_123');
      const result = await backend.getTask('task_123');

      expect(result).toBeNull();
    });

    it('should list tasks with optional filtering', async () => {
      const task1: Task = {
        task_id: 'task_1',
        title: 'Task 1',
        objective: 'Test',
        typed_ref: 'test:task:local:1',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const task2: Task = {
        ...task1,
        task_id: 'task_2',
        title: 'Task 2',
        state: 'developing',
      };

      await backend.setTask(task1);
      await backend.setTask(task2);

      const all = await backend.listTasks();
      expect(all.length).toBe(2);

      const queued = await backend.listTasks({ state: 'queued' });
      expect(queued.length).toBe(1);
      expect(queued[0].task_id).toBe('task_1');
    });
  });

  describe('Job operations', () => {
    it('should store and retrieve a job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'test:task:local:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test prompt',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      await backend.setJob(job);
      const retrieved = await backend.getJob('job_123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.job_id).toBe('job_123');
    });

    it('should list jobs by task', async () => {
      const job1: WorkerJob = {
        job_id: 'job_1',
        task_id: 'task_123',
        typed_ref: 'test:task:local:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: [],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const job2: WorkerJob = {
        ...job1,
        job_id: 'job_2',
        task_id: 'task_456',
      };

      await backend.setJob(job1);
      await backend.setJob(job2);

      const jobs = await backend.listJobsByTask('task_123');
      expect(jobs.length).toBe(1);
      expect(jobs[0].job_id).toBe('job_1');
    });
  });

  describe('Event operations', () => {
    it('should store and retrieve events', async () => {
      const event: StateTransitionEvent = {
        event_id: 'evt_123',
        task_id: 'task_123',
        from_state: 'queued',
        to_state: 'planning',
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'dispatch',
        occurred_at: new Date().toISOString(),
      };

      await backend.addEvent('task_123', event);
      const events = await backend.getEvents('task_123');

      expect(events.length).toBe(1);
      expect(events[0].event_id).toBe('evt_123');
    });

    it('should return empty array for task with no events', async () => {
      const events = await backend.getEvents('non-existent');
      expect(events).toEqual([]);
    });
  });

  describe('Retry tracking', () => {
    it('should track retry counts', async () => {
      expect(await backend.getRetryCount('task_123:plan')).toBe(0);

      const count = await backend.incrementRetryCount('task_123:plan');
      expect(count).toBe(1);

      const count2 = await backend.incrementRetryCount('task_123:plan');
      expect(count2).toBe(2);

      await backend.setRetryCount('task_123:plan', 5);
      expect(await backend.getRetryCount('task_123:plan')).toBe(5);
    });
  });

  describe('Utility operations', () => {
    it('should clear all data', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test',
        objective: 'Test',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await backend.setTask(task);
      await backend.clear();
      const result = await backend.getTask('task_123');

      expect(result).toBeNull();
    });

    it('should pass health check', async () => {
      const result = await backend.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBe(0);
    });
  });
});

describe('RedisBackend', () => {
  let backend: RedisBackend;
  let mockClient: MockRedisClient;

  beforeEach(() => {
    mockClient = new MockRedisClient();
    backend = new RedisBackend(mockClient, { keyPrefix: 'test:' });
  });

  describe('Task operations', () => {
    it('should store and retrieve a task', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await backend.setTask(task);
      const retrieved = await backend.getTask('task_123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.task_id).toBe('task_123');
      expect(retrieved?.title).toBe('Test Task');
    });

    it('should return null for non-existent task', async () => {
      const result = await backend.getTask('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a task', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test',
        objective: 'Test',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await backend.setTask(task);
      await backend.deleteTask('task_123');
      const result = await backend.getTask('task_123');

      expect(result).toBeNull();
    });
  });

  describe('Event operations', () => {
    it('should store and retrieve events', async () => {
      const event: StateTransitionEvent = {
        event_id: 'evt_123',
        task_id: 'task_123',
        from_state: 'queued',
        to_state: 'planning',
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'dispatch',
        occurred_at: new Date().toISOString(),
      };

      await backend.addEvent('task_123', event);
      const events = await backend.getEvents('task_123');

      expect(events.length).toBe(1);
      expect(events[0].event_id).toBe('evt_123');
    });
  });

  describe('Retry tracking', () => {
    it('should track retry counts', async () => {
      expect(await backend.getRetryCount('task_123:plan')).toBe(0);

      const count = await backend.incrementRetryCount('task_123:plan');
      expect(count).toBe(1);

      const count2 = await backend.incrementRetryCount('task_123:plan');
      expect(count2).toBe(2);
    });
  });

  describe('Health check', () => {
    it('should pass health check', async () => {
      const result = await backend.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeDefined();
    });
  });

  describe('Key prefix', () => {
    it('should use custom key prefix', async () => {
      const customBackend = new RedisBackend(mockClient, { keyPrefix: 'custom:' });

      const task: Task = {
        task_id: 'task_123',
        title: 'Test',
        objective: 'Test',
        typed_ref: 'test:task:local:123',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await customBackend.setTask(task);

      // Verify the key was stored with custom prefix
      const keys = await mockClient.keys('custom:*');
      expect(keys.some(k => k.includes('task:task_123'))).toBe(true);
    });
  });
});