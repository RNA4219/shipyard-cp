/**
 * Store Backend Interface
 *
 * Abstracts the storage layer for ControlPlaneStore.
 * Supports both in-memory (development) and Redis (production) backends.
 */

import type { Task, WorkerJob, WorkerResult, StateTransitionEvent } from '../types.js';

/**
 * Store backend interface for persistence
 */
export interface StoreBackend {
  // Task operations
  getTask(taskId: string): Promise<Task | null>;
  setTask(task: Task): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  listTasks(options?: { state?: string; limit?: number }): Promise<Task[]>;

  // Job operations
  getJob(jobId: string): Promise<WorkerJob | null>;
  setJob(job: WorkerJob): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  listJobsByTask(taskId: string): Promise<WorkerJob[]>;

  // Result operations
  getResult(jobId: string): Promise<WorkerResult | null>;
  setResult(result: WorkerResult): Promise<void>;
  deleteResult(jobId: string): Promise<void>;

  // Event operations
  getEvents(taskId: string): Promise<StateTransitionEvent[]>;
  addEvent(taskId: string, event: StateTransitionEvent): Promise<void>;

  // Retry tracking
  getRetryCount(key: string): Promise<number>;
  setRetryCount(key: string, count: number): Promise<void>;
  incrementRetryCount(key: string): Promise<number>;

  // Utility
  clear(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
}

/**
 * In-memory store backend (default for development)
 */
export class InMemoryBackend implements StoreBackend {
  private readonly tasks = new Map<string, Task>();
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly events = new Map<string, StateTransitionEvent[]>();
  private readonly retryTracker = new Map<string, number>();

  async getTask(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async setTask(task: Task): Promise<void> {
    this.tasks.set(task.task_id, { ...task });
  }

  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.events.delete(taskId);
  }

  async listTasks(options?: { state?: string; limit?: number }): Promise<Task[]> {
    let result = Array.from(this.tasks.values());
    if (options?.state) {
      result = result.filter(t => t.state === options.state);
    }
    if (options?.limit) {
      result = result.slice(0, options.limit);
    }
    return result;
  }

  async getJob(jobId: string): Promise<WorkerJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async setJob(job: WorkerJob): Promise<void> {
    this.jobs.set(job.job_id, { ...job });
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async listJobsByTask(taskId: string): Promise<WorkerJob[]> {
    return Array.from(this.jobs.values()).filter(j => j.task_id === taskId);
  }

  async getResult(jobId: string): Promise<WorkerResult | null> {
    return this.results.get(jobId) ?? null;
  }

  async setResult(result: WorkerResult): Promise<void> {
    this.results.set(result.job_id, { ...result });
  }

  async deleteResult(jobId: string): Promise<void> {
    this.results.delete(jobId);
  }

  async getEvents(taskId: string): Promise<StateTransitionEvent[]> {
    return this.events.get(taskId) ?? [];
  }

  async addEvent(taskId: string, event: StateTransitionEvent): Promise<void> {
    const events = this.events.get(taskId) ?? [];
    events.push(event);
    this.events.set(taskId, events);
  }

  async getRetryCount(key: string): Promise<number> {
    return this.retryTracker.get(key) ?? 0;
  }

  async setRetryCount(key: string, count: number): Promise<void> {
    this.retryTracker.set(key, count);
  }

  async incrementRetryCount(key: string): Promise<number> {
    const current = this.retryTracker.get(key) ?? 0;
    const newValue = current + 1;
    this.retryTracker.set(key, newValue);
    return newValue;
  }

  async clear(): Promise<void> {
    this.tasks.clear();
    this.jobs.clear();
    this.results.clear();
    this.events.clear();
    this.retryTracker.clear();
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }> {
    return { healthy: true, latencyMs: 0 };
  }
}