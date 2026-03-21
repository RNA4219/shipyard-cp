import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryBackend } from '../src/store/store-backend.js';
import { RedisBackend, type RedisClient } from '../src/store/redis-backend.js';
import type { Task, WorkerJob, WorkerResult, StateTransitionEvent } from '../src/types.js';

// Mock Redis client for testing
class MockRedisClient implements RedisClient {
  private data = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map(key => this.data.get(key) ?? null);
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key) || this.lists.has(key) || this.sets.has(key) || this.hashes.has(key);
    this.data.delete(key);
    this.lists.delete(key);
    this.sets.delete(key);
    this.hashes.delete(key);
    return existed ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const allKeys = [
      ...this.data.keys(),
      ...this.lists.keys(),
      ...this.sets.keys(),
      ...this.hashes.keys(),
    ];
    return allKeys.filter(k => regex.test(k));
  }

  async incr(key: string): Promise<number> {
    const current = parseInt(this.data.get(key) ?? '0', 10);
    const newValue = current + 1;
    this.data.set(key, String(newValue));
    return newValue;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return (this.data.has(key) || this.lists.has(key) || this.sets.has(key) || this.hashes.has(key)) ? 1 : 0;
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

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const initialSize = set.size;
    members.forEach(m => set.add(m));
    this.sets.set(key, set);
    return set.size - initialSize;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    const initialSize = set.size;
    members.forEach(m => set.delete(m));
    return initialSize - set.size;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const isNew = !hash.has(field);
    hash.set(field, value);
    this.hashes.set(key, hash);
    return isNew ? 1 : 0;
  }

  async hdel(key: string, field: string): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    return hash.delete(field) ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const hash = this.hashes.get(key);
    return hash?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
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

  afterEach(() => {
    // Reset mock client state
    mockClient = new MockRedisClient();
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
      expect(retrieved?.task_id).toBe('task_123');
    });

    it('should return null for non-existent job', async () => {
      const result = await backend.getJob('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
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

      await backend.setJob(job);
      await backend.deleteJob('job_123');
      const result = await backend.getJob('job_123');

      expect(result).toBeNull();
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
        task_id: 'task_123',
        stage: 'implement',
      };

      const job3: WorkerJob = {
        ...job1,
        job_id: 'job_3',
        task_id: 'task_456',
      };

      await backend.setJob(job1);
      await backend.setJob(job2);
      await backend.setJob(job3);

      const jobs = await backend.listJobsByTask('task_123');
      expect(jobs.length).toBe(2);
      expect(jobs.map(j => j.job_id).sort()).toEqual(['job_1', 'job_2']);
    });

    it('should return empty array for task with no jobs', async () => {
      const jobs = await backend.listJobsByTask('non-existent');
      expect(jobs).toEqual([]);
    });

    it('should handle invalid JSON in job data gracefully', async () => {
      // Store invalid JSON directly in mock
      await mockClient.set('test:job:bad_job', 'not valid json');
      const result = await backend.getJob('bad_job');
      expect(result).toBeNull();
    });

    it('should handle invalid JSON in listJobsByTask gracefully', async () => {
      const job: WorkerJob = {
        job_id: 'job_valid',
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
      await backend.setJob(job);

      // Add job ID to the task index but store invalid JSON
      await mockClient.sadd('test:jobs:task:task_123', 'job_invalid');
      await mockClient.set('test:job:job_invalid', 'not valid json');

      const jobs = await backend.listJobsByTask('task_123');
      // Should only return the valid job
      expect(jobs.length).toBe(1);
      expect(jobs[0].job_id).toBe('job_valid');
    });
  });

  describe('Result operations', () => {
    it('should store and retrieve a result', async () => {
      const result: WorkerResult = {
        job_id: 'job_123',
        task_id: 'task_123',
        stage: 'plan',
        status: 'success',
        output: 'Plan completed successfully',
        completed_at: new Date().toISOString(),
      };

      await backend.setResult(result);
      const retrieved = await backend.getResult('job_123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.job_id).toBe('job_123');
      expect(retrieved?.status).toBe('success');
    });

    it('should return null for non-existent result', async () => {
      const result = await backend.getResult('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a result', async () => {
      const result: WorkerResult = {
        job_id: 'job_123',
        task_id: 'task_123',
        stage: 'plan',
        status: 'success',
        output: 'Done',
        completed_at: new Date().toISOString(),
      };

      await backend.setResult(result);
      await backend.deleteResult('job_123');
      const retrieved = await backend.getResult('job_123');

      expect(retrieved).toBeNull();
    });

    it('should handle invalid JSON in result data gracefully', async () => {
      await mockClient.set('test:result:bad_result', 'not valid json');
      const result = await backend.getResult('bad_result');
      expect(result).toBeNull();
    });
  });

  describe('listTasks with options', () => {
    it('should list tasks with state filter', async () => {
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

      const queued = await backend.listTasks({ state: 'queued' });
      expect(queued.length).toBe(1);
      expect(queued[0].task_id).toBe('task_1');
    });

    it('should list tasks with limit', async () => {
      for (let i = 0; i < 10; i++) {
        const task: Task = {
          task_id: `task_${i}`,
          title: `Task ${i}`,
          objective: 'Test',
          typed_ref: `test:task:local:${i}`,
          state: 'queued',
          version: 1,
          risk_level: 'low',
          repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await backend.setTask(task);
      }

      const tasks = await backend.listTasks({ limit: 5 });
      expect(tasks.length).toBe(5);
    });

    it('should return empty array when no tasks', async () => {
      const tasks = await backend.listTasks();
      expect(tasks).toEqual([]);
    });

    it('should handle invalid JSON in listTasks gracefully', async () => {
      // Store a valid task first
      const task: Task = {
        task_id: 'task_valid',
        title: 'Valid Task',
        objective: 'Test',
        typed_ref: 'test:task:local:valid',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await backend.setTask(task);

      // Add invalid task ID to list and store invalid JSON
      await mockClient.lpush('test:tasks:list', 'task_invalid');
      await mockClient.set('test:task:task_invalid', 'not valid json');

      const tasks = await backend.listTasks();
      // Should only return the valid task
      expect(tasks.length).toBe(1);
      expect(tasks[0].task_id).toBe('task_valid');
    });
  });

  describe('setRetryCount', () => {
    it('should set retry count', async () => {
      await backend.setRetryCount('task_123:plan', 5);
      const count = await backend.getRetryCount('task_123:plan');
      expect(count).toBe(5);
    });
  });

  describe('clear', () => {
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

    it('should handle clearing empty store', async () => {
      await expect(backend.clear()).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('should close the connection', async () => {
      await expect(backend.close()).resolves.not.toThrow();
    });
  });

  describe('Health check with errors', () => {
    it('should return healthy false on ping failure', async () => {
      // Create a mock client that throws on ping
      const failingClient: RedisClient = {
        get: async () => null,
        mget: async () => [],
        set: async () => 'OK',
        del: async () => 0,
        keys: async () => [],
        incr: async () => 0,
        expire: async () => 0,
        lpush: async () => 0,
        lrange: async () => [],
        sadd: async () => 0,
        srem: async () => 0,
        smembers: async () => [],
        hset: async () => 0,
        hdel: async () => 0,
        hget: async () => null,
        hgetall: async () => ({}),
        ping: async () => {
          throw new Error('Connection refused');
        },
        quit: async () => {},
      };

      const failingBackend = new RedisBackend(failingClient);
      const result = await failingBackend.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should handle unknown error types', async () => {
      const failingClient: RedisClient = {
        get: async () => null,
        mget: async () => [],
        set: async () => 'OK',
        del: async () => 0,
        keys: async () => [],
        incr: async () => 0,
        expire: async () => 0,
        lpush: async () => 0,
        lrange: async () => [],
        sadd: async () => 0,
        srem: async () => 0,
        smembers: async () => [],
        hset: async () => 0,
        hdel: async () => 0,
        hget: async () => null,
        hgetall: async () => ({}),
        ping: async () => {
          throw 'some string error';
        },
        quit: async () => {},
      };

      const failingBackend = new RedisBackend(failingClient);
      const result = await failingBackend.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('TTL configuration', () => {
    it('should use custom TTL values', async () => {
      const customBackend = new RedisBackend(mockClient, {
        keyPrefix: 'custom:',
        taskTtl: 3600,
        jobTtl: 1800,
        resultTtl: 600,
        eventTtl: 7200,
      });

      const task: Task = {
        task_id: 'task_ttl_test',
        title: 'TTL Test',
        objective: 'Test',
        typed_ref: 'test:task:local:ttl',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await expect(customBackend.setTask(task)).resolves.not.toThrow();
    });

    it('should use default TTL values when not specified', async () => {
      const defaultBackend = new RedisBackend(mockClient);

      const task: Task = {
        task_id: 'task_default_ttl',
        title: 'Default TTL Test',
        objective: 'Test',
        typed_ref: 'test:task:local:default',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await expect(defaultBackend.setTask(task)).resolves.not.toThrow();
    });
  });

  describe('Invalid JSON handling', () => {
    it('should handle invalid JSON in task data gracefully', async () => {
      // Store invalid JSON directly in mock
      await mockClient.set('test:task:bad_task', 'not valid json');
      const result = await backend.getTask('bad_task');
      expect(result).toBeNull();
    });

    it('should handle invalid JSON in event data gracefully', async () => {
      // Add invalid event data directly
      await mockClient.lpush('test:events:task_123', 'not valid json');
      const events = await backend.getEvents('task_123');
      expect(events).toEqual([]);
    });
  });

  describe('Delete operations for non-existent items', () => {
    it('should handle deleting non-existent task', async () => {
      await expect(backend.deleteTask('non-existent')).resolves.not.toThrow();
    });

    it('should handle deleting non-existent job', async () => {
      await expect(backend.deleteJob('non-existent')).resolves.not.toThrow();
    });

    it('should handle deleting non-existent result', async () => {
      await expect(backend.deleteResult('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Multiple events', () => {
    it('should store and retrieve multiple events', async () => {
      const event1: StateTransitionEvent = {
        event_id: 'evt_1',
        task_id: 'task_123',
        from_state: 'queued',
        to_state: 'planning',
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'dispatch',
        occurred_at: new Date().toISOString(),
      };

      const event2: StateTransitionEvent = {
        event_id: 'evt_2',
        task_id: 'task_123',
        from_state: 'planning',
        to_state: 'developing',
        actor_type: 'worker',
        actor_id: 'worker_1',
        reason: 'plan_complete',
        occurred_at: new Date().toISOString(),
      };

      await backend.addEvent('task_123', event1);
      await backend.addEvent('task_123', event2);

      const events = await backend.getEvents('task_123');
      expect(events.length).toBe(2);
    });
  });
});