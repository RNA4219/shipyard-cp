import { describe, it, expect, beforeEach } from 'vitest';
import { ConcurrencyManager } from '../src/domain/concurrency/index.js';

describe('ConcurrencyManager', () => {
  let concurrencyManager: ConcurrencyManager;

  beforeEach(() => {
    concurrencyManager = new ConcurrencyManager({
      max_concurrent_per_worker: 3,
      max_concurrent_global: 10,
    });
  });

  describe('canAccept', () => {
    it('should allow job when under worker limit', () => {
      const result = concurrencyManager.canAccept({
        worker_id: 'worker_1',
        stage: 'dev',
      });

      expect(result.accepted).toBe(true);
    });

    it('should deny job when at worker limit', () => {
      // Fill up worker_1's capacity
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_3', worker_id: 'worker_1', stage: 'dev' });

      const result = concurrencyManager.canAccept({
        worker_id: 'worker_1',
        stage: 'dev',
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('worker_capacity_exceeded');
    });

    it('should deny job when at global limit', () => {
      // Fill up global capacity with different workers
      for (let i = 0; i < 10; i++) {
        concurrencyManager.recordStart({
          job_id: `job_${i}`,
          worker_id: `worker_${i}`,
          stage: 'dev',
        });
      }

      const result = concurrencyManager.canAccept({
        worker_id: 'worker_11',
        stage: 'dev',
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('global_capacity_exceeded');
    });

    it('should track capacity per worker independently', () => {
      // Fill up worker_1
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_3', worker_id: 'worker_1', stage: 'dev' });

      // worker_2 should still have capacity
      const result = concurrencyManager.canAccept({
        worker_id: 'worker_2',
        stage: 'dev',
      });

      expect(result.accepted).toBe(true);
    });
  });

  describe('recordStart', () => {
    it('should record job start', () => {
      concurrencyManager.recordStart({
        job_id: 'job_1',
        worker_id: 'worker_1',
        stage: 'dev',
      });

      const stats = concurrencyManager.getStats('worker_1');
      expect(stats.active_jobs).toBe(1);
    });

    it('should accumulate active jobs', () => {
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });

      const stats = concurrencyManager.getStats('worker_1');
      expect(stats.active_jobs).toBe(2);
    });
  });

  describe('recordComplete', () => {
    it('should decrement active jobs on completion', () => {
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordComplete({ job_id: 'job_1', worker_id: 'worker_1' });

      const stats = concurrencyManager.getStats('worker_1');
      expect(stats.active_jobs).toBe(0);
    });

    it('should free up capacity for new jobs', () => {
      // Fill up worker_1
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_3', worker_id: 'worker_1', stage: 'dev' });

      // Should be at capacity
      let result = concurrencyManager.canAccept({ worker_id: 'worker_1', stage: 'dev' });
      expect(result.accepted).toBe(false);

      // Complete one job
      concurrencyManager.recordComplete({ job_id: 'job_1', worker_id: 'worker_1' });

      // Should have capacity now
      result = concurrencyManager.canAccept({ worker_id: 'worker_1', stage: 'dev' });
      expect(result.accepted).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return worker stats', () => {
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });

      const stats = concurrencyManager.getStats('worker_1');

      expect(stats.worker_id).toBe('worker_1');
      expect(stats.active_jobs).toBe(1);
      expect(stats.max_concurrent).toBe(3);
      expect(stats.utilization).toBeCloseTo(0.33, 1);
    });

    it('should return zero stats for unknown worker', () => {
      const stats = concurrencyManager.getStats('unknown_worker');

      expect(stats.active_jobs).toBe(0);
      expect(stats.utilization).toBe(0);
    });
  });

  describe('getGlobalStats', () => {
    it('should return global statistics', () => {
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_2', stage: 'plan' });

      const stats = concurrencyManager.getGlobalStats();

      expect(stats.total_active_jobs).toBe(2);
      expect(stats.total_capacity).toBe(10);
      expect(stats.active_workers).toBe(2);
    });
  });

  describe('getQueuePosition', () => {
    it('should return queue position for waiting job', () => {
      // Fill up worker_1
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_3', worker_id: 'worker_1', stage: 'dev' });

      // Queue two jobs
      concurrencyManager.enqueue({ job_id: 'job_4', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.enqueue({ job_id: 'job_5', worker_id: 'worker_1', stage: 'dev' });

      const position = concurrencyManager.getQueuePosition('job_5');
      expect(position).toBe(2);
    });

    it('should return 0 for non-queued job', () => {
      const position = concurrencyManager.getQueuePosition('nonexistent');
      expect(position).toBe(0);
    });
  });

  describe('dequeue', () => {
    it('should return next job from queue', () => {
      // Fill up worker_1
      concurrencyManager.recordStart({ job_id: 'job_1', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_2', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.recordStart({ job_id: 'job_3', worker_id: 'worker_1', stage: 'dev' });

      // Queue jobs
      concurrencyManager.enqueue({ job_id: 'job_4', worker_id: 'worker_1', stage: 'dev' });
      concurrencyManager.enqueue({ job_id: 'job_5', worker_id: 'worker_1', stage: 'dev' });

      // Complete a job to free capacity
      concurrencyManager.recordComplete({ job_id: 'job_1', worker_id: 'worker_1' });

      // Dequeue should return first queued job
      const next = concurrencyManager.dequeue('worker_1');
      expect(next?.job_id).toBe('job_4');
    });

    it('should return null when queue is empty', () => {
      const next = concurrencyManager.dequeue('worker_1');
      expect(next).toBeNull();
    });
  });
});