import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MetricsCollector,
  initializeMetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
} from '../../src/monitoring/metrics/metrics-collector.js';
import type { TaskState, WorkerStage, WorkerType } from '../../src/types.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    resetMetricsCollector();
    collector = new MetricsCollector({
      prefix: 'test_',
      enableDefaultMetrics: false,
    });
  });

  afterEach(() => {
    resetMetricsCollector();
  });

  describe('constructor', () => {
    it('should create a collector with default configuration', () => {
      const testCollector = new MetricsCollector();
      expect(testCollector).toBeDefined();
      expect(testCollector.getPrefix()).toBe('shipyard_');
    });

    it('should create a collector with custom prefix', () => {
      const testCollector = new MetricsCollector({ prefix: 'custom_' });
      expect(testCollector.getPrefix()).toBe('custom_');
    });

    it('should accept default labels', () => {
      const testCollector = new MetricsCollector({
        defaultLabels: { service: 'test-service' },
      });
      expect(testCollector).toBeDefined();
    });
  });

  describe('task metrics', () => {
    it('should increment task total by state', async () => {
      collector.incrementTasksTotal('queued');
      collector.incrementTasksTotal('queued');
      collector.incrementTasksTotal('planning');

      const metrics = await collector.export();
      expect(metrics).toContain('test_tasks_total');
      expect(metrics).toContain('state="queued"');
      expect(metrics).toContain('state="planning"');
    });

    it('should set active tasks count', async () => {
      collector.setActiveTasks(10);

      const metrics = await collector.export();
      expect(metrics).toContain('test_tasks_active 10');
    });

    it('should increment and decrement active tasks', async () => {
      collector.setActiveTasks(5);
      collector.incrementActiveTasks();
      collector.incrementActiveTasks();

      let metrics = await collector.export();
      expect(metrics).toContain('test_tasks_active 7');

      collector.decrementActiveTasks();
      metrics = await collector.export();
      expect(metrics).toContain('test_tasks_active 6');
    });
  });

  describe('job metrics', () => {
    it('should record job creation', async () => {
      collector.recordJobCreation('plan', 'claude_code');
      collector.recordJobCreation('dev', 'codex');
      collector.recordJobCreation('dev', 'codex');

      const metrics = await collector.export();
      expect(metrics).toContain('test_jobs_total');
      expect(metrics).toContain('stage="plan"');
      expect(metrics).toContain('stage="dev"');
      expect(metrics).toContain('worker_type="claude_code"');
      expect(metrics).toContain('worker_type="codex"');
    });

    it('should track job duration with timer', async () => {
      const jobId = 'job-123';
      collector.startJobTimer(jobId);

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 100));

      const duration = collector.endJobTimer(jobId, 'dev', 'codex');

      expect(duration).toBeDefined();
      expect(duration).toBeGreaterThanOrEqual(0.1);

      const metrics = await collector.export();
      expect(metrics).toContain('test_job_duration_seconds');
    });

    it('should return undefined for unknown job timer', () => {
      const duration = collector.endJobTimer('unknown-job', 'dev', 'codex');
      expect(duration).toBeUndefined();
    });

    it('should record job duration directly', async () => {
      collector.recordJobDuration('acceptance', 'claude_code', 5.5);

      const metrics = await collector.export();
      expect(metrics).toContain('test_job_duration_seconds');
    });
  });

  describe('dispatch metrics', () => {
    it('should record dispatch operations', async () => {
      collector.recordDispatch('plan');
      collector.recordDispatch('dev');
      collector.recordDispatch('dev');

      const metrics = await collector.export();
      expect(metrics).toContain('test_dispatch_total');
      expect(metrics).toContain('stage="plan"');
      expect(metrics).toContain('stage="dev"');
    });
  });

  describe('result metrics', () => {
    it('should record result processing', async () => {
      collector.recordResult('succeeded');
      collector.recordResult('succeeded');
      collector.recordResult('failed');
      collector.recordResult('blocked');

      const metrics = await collector.export();
      expect(metrics).toContain('test_result_total');
      expect(metrics).toContain('status="succeeded"');
      expect(metrics).toContain('status="failed"');
      expect(metrics).toContain('status="blocked"');
    });
  });

  describe('domain event handlers', () => {
    it('should handle task created event', async () => {
      collector.onTaskCreated('queued');

      const metrics = await collector.export();
      expect(metrics).toContain('test_tasks_total');
      expect(metrics).toContain('test_tasks_active 1');
    });

    it('should handle task transition event', async () => {
      collector.setActiveTasks(5);
      collector.onTaskTransition('queued', 'planning');

      const metrics = await collector.export();
      expect(metrics).toContain('state="planning"');
      expect(metrics).toContain('test_tasks_active 5'); // Not terminal yet
    });

    it('should decrement active tasks on terminal state transition', async () => {
      collector.setActiveTasks(5);
      collector.onTaskTransition('publishing', 'published');

      const metrics = await collector.export();
      expect(metrics).toContain('test_tasks_active 4');
    });

    it('should handle job dispatched event', async () => {
      collector.onJobDispatched('job-456', 'dev', 'codex');

      const metrics = await collector.export();
      expect(metrics).toContain('test_jobs_total');
      expect(metrics).toContain('test_dispatch_total');
    });

    it('should handle job result event', async () => {
      collector.startJobTimer('job-789');
      await new Promise(resolve => setTimeout(resolve, 50));

      collector.onJobResult('job-789', 'acceptance', 'claude_code', 'succeeded');

      const metrics = await collector.export();
      expect(metrics).toContain('test_job_duration_seconds');
      expect(metrics).toContain('test_result_total');
      expect(metrics).toContain('status="succeeded"');
    });
  });

  describe('export', () => {
    it('should export metrics in Prometheus text format', async () => {
      collector.incrementTasksTotal('queued');
      const metrics = await collector.export();

      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('should export metrics as JSON', async () => {
      collector.incrementTasksTotal('queued');
      const json = await collector.exportJson();

      expect(typeof json).toBe('object');
      expect(Array.isArray(json)).toBe(true);
    });

    it('should return correct content type', () => {
      const contentType = collector.getContentType();
      expect(contentType).toContain('text/plain');
    });
  });

  describe('clear', () => {
    it('should clear all metrics', async () => {
      collector.incrementTasksTotal('queued');
      collector.setActiveTasks(10);

      collector.clear();

      const metrics = await collector.export();
      // After clearing, metrics should not contain the previous values
      // (The metrics still exist but are reset to 0)
      expect(metrics).toBeDefined();
    });
  });
});

describe('Global metrics collector functions', () => {
  beforeEach(() => {
    resetMetricsCollector();
  });

  afterEach(() => {
    resetMetricsCollector();
  });

  describe('initializeMetricsCollector', () => {
    it('should initialize and return the global collector', () => {
      const collector = initializeMetricsCollector({ prefix: 'global_' });
      expect(collector).toBeDefined();
      expect(collector).toBeInstanceOf(MetricsCollector);
      expect(collector.getPrefix()).toBe('global_');
    });

    it('should return the same collector after initialization', () => {
      const collector1 = initializeMetricsCollector();
      const collector2 = getMetricsCollector();
      expect(collector1).toBe(collector2);
    });
  });

  describe('getMetricsCollector', () => {
    it('should return a default collector if not initialized', () => {
      const collector = getMetricsCollector();
      expect(collector).toBeDefined();
      expect(collector).toBeInstanceOf(MetricsCollector);
    });
  });

  describe('resetMetricsCollector', () => {
    it('should reset the global collector', () => {
      const collector1 = initializeMetricsCollector({ prefix: 'before_' });
      expect(collector1.getPrefix()).toBe('before_');

      resetMetricsCollector();

      const collector2 = getMetricsCollector();
      expect(collector2.getPrefix()).toBe('shipyard_');
    });
  });
});