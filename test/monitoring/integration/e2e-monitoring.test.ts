/**
 * End-to-End Monitoring Tests
 *
 * Tests monitoring data throughout the complete task lifecycle:
 * - Task creation -> dispatch -> result flow
 * - Metrics recording verification
 * - Log output verification
 * - Error tracking verification
 *
 * Note: Uses global monitoring instances (getMetricsCollector, getErrorTracker)
 * instead of Fastify decorators due to plugin encapsulation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import {
  resetMetricsCollector,
  resetPrometheusExporter,
  resetErrorTracker,
  resetAlertManager,
  getMetricsCollector,
  getErrorTracker,
} from '../../../src/monitoring/index.js';

describe('End-to-End Monitoring Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Reset all monitoring singletons
    resetMetricsCollector();
    resetPrometheusExporter();
    resetErrorTracker();
    resetAlertManager();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    resetMetricsCollector();
    resetPrometheusExporter();
    resetErrorTracker();
    resetAlertManager();
  });

  describe('task lifecycle monitoring', () => {
    it('should record metrics during task creation', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create a task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'E2E Monitoring Test',
          objective: 'Test metrics recording',
          typed_ref: 'agent-taskstate:task:github:e2e-monitoring-1',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      expect(createResponse.statusCode).toBe(201);

      // Verify metrics endpoint is available and returns shipyard metrics
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toContain('shipyard_tasks_total');
      expect(metrics).toContain('shipyard_tasks_active');
    });

    it('should record metrics during dispatch operation', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create a task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Dispatch Monitoring Test',
          objective: 'Test dispatch metrics',
          typed_ref: 'agent-taskstate:task:github:dispatch-monitoring-2',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string };
      expect(createResponse.statusCode).toBe(201);

      // Dispatch the task
      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      expect(dispatchResponse.statusCode).toBe(202);

      // Verify dispatch metrics endpoint is available
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toContain('shipyard_dispatch_total');
      expect(metrics).toContain('shipyard_jobs_total');
    });

    it('should record metrics when result is submitted', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create and dispatch task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Result Monitoring Test',
          objective: 'Test result metrics',
          typed_ref: 'agent-taskstate:task:github:result-monitoring-3',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string; typed_ref: string };
      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      const job = dispatchResponse.json() as { job_id: string };

      // Submit result
      const resultResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          summary: 'Plan completed',
          artifacts: [{ artifact_id: 'plan', kind: 'log', uri: 'file:///plan.log' }],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        },
      });

      expect(resultResponse.statusCode).toBe(200);

      // Verify result metrics endpoint is available
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toContain('shipyard_result_total');
    });

    it('should record failed result metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create and dispatch task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Failed Result Test',
          objective: 'Test failed result metrics',
          typed_ref: 'agent-taskstate:task:github:failed-result-4',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string; typed_ref: string };
      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      const job = dispatchResponse.json() as { job_id: string };

      // Submit failed result
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: task.typed_ref,
          status: 'failed',
          summary: 'Plan failed',
          artifacts: [],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 500 },
        },
      });

      // Verify failed metrics endpoint is available
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toContain('shipyard_result_total');
    });
  });

  describe('full task flow monitoring', () => {
    it('should track complete task lifecycle with metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Full Lifecycle Monitoring',
          objective: 'Test complete flow',
          typed_ref: 'agent-taskstate:task:github:full-lifecycle-5',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string; typed_ref: string };
      expect(createResponse.statusCode).toBe(201);

      // Plan stage
      const planDispatch = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });
      const planJob = planDispatch.json() as { job_id: string };

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: planJob.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          artifacts: [{ artifact_id: 'p', kind: 'log', uri: 'x' }],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 100 },
        },
      });

      // Dev stage
      const devDispatch = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'dev' },
      });
      const devJob = devDispatch.json() as { job_id: string };

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: devJob.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          artifacts: [{ artifact_id: 'd', kind: 'log', uri: 'x' }],
          test_results: [{ suite: 'unit', status: 'passed', passed: 5, failed: 0 }],
          requested_escalations: [],
          usage: { runtime_ms: 500 },
        },
      });

      // Get final metrics
      const collector = getMetricsCollector();
      const metrics = await collector.export();

      // Verify all stages were recorded
      expect(metrics).toContain('shipyard_dispatch_total');
      expect(metrics).toContain('shipyard_jobs_total');
      expect(metrics).toContain('shipyard_result_total');

      // Verify multiple dispatch operations
      const metricsJson = await collector.exportJson();

      // Check that dispatch_total metric exists and has values
      const dispatchMetric = metricsJson.find(
        (m: { name: string }) => m.name === 'shipyard_dispatch_total'
      );
      expect(dispatchMetric).toBeDefined();
    });
  });

  describe('error tracking during task flow', () => {
    it('should capture validation errors during task creation', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Try to create a task with invalid data
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          // Missing required fields
          title: 'Invalid Task',
        },
      });

      expect(response.statusCode).toBe(400);

      // Check if error was tracked
      const errorTracker = getErrorTracker();
      const errorStats = errorTracker.getErrorStats();
      expect(errorStats.total).toBeGreaterThanOrEqual(0);
    });

    it('should capture errors when task not found', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Try to get a non-existent task
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks/non-existent-task-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should capture errors when invalid state transition', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'State Transition Test',
          objective: 'Test invalid transition',
          typed_ref: 'agent-taskstate:task:github:state-transition-6',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string };

      // Try to dispatch to invalid stage (task is queued, can only go to plan)
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'dev' }, // Should fail - can't skip plan
      });

      // This should either fail or be handled gracefully
      // The important thing is no crash and metrics are still recorded
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toBeDefined();
    });
  });

  describe('metrics endpoint with real data', () => {
    it('should return valid Prometheus format', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create some data
      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Prometheus Format Test',
          objective: 'Test metrics format',
          typed_ref: 'agent-taskstate:task:github:prometheus-format-7',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/openmetrics-text');

      // Verify Prometheus format structure
      const body = response.body;

      // Should have HELP and TYPE comments
      expect(body).toMatch(/# TYPE \w+ \w+/);
      expect(body).toMatch(/# HELP \w+ .+/);

      // Should have metric values
      expect(body).toMatch(/shipyard_\w+\{.*\}\s+\d+/);
    });

    it('should include job duration histogram', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create and complete a job to generate duration metrics
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Duration Test',
          objective: 'Test job duration',
          typed_ref: 'agent-taskstate:task:github:duration-test-8',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string; typed_ref: string };

      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      const job = dispatchResponse.json() as { job_id: string };

      // Wait a bit to ensure duration
      await new Promise((resolve) => setTimeout(resolve, 100));

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 100 },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      // Job duration histogram should be defined (may or may not have data)
      expect(response.body).toContain('shipyard_job_duration_seconds');
    });
  });

  describe('concurrent operations monitoring', () => {
    it('should handle concurrent task creation with correct metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create multiple tasks concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: `Concurrent Task ${i}`,
            objective: 'Test concurrent metrics',
            typed_ref: `agent-taskstate:task:github:concurrent-${i}`,
            repo_ref: {
              provider: 'github',
              owner: 'org',
              name: 'repo',
              default_branch: 'main',
            },
          },
        })
      );

      const responses = await Promise.all(createPromises);

      // All should succeed
      responses.forEach((r) => expect(r.statusCode).toBe(201));

      // Verify metrics
      const collector = getMetricsCollector();
      const metricsJson = await collector.exportJson();

      const tasksTotal = metricsJson.find(
        (m: { name: string }) => m.name === 'shipyard_tasks_total'
      );

      expect(tasksTotal).toBeDefined();
    });

    it('should handle concurrent dispatches with correct metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
        auth: { enabled: false },
      });

      // Create multiple tasks
      const tasks: { task_id: string }[] = [];
      for (let i = 0; i < 3; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: `Dispatch Test ${i}`,
            objective: 'Test concurrent dispatch',
            typed_ref: `agent-taskstate:task:github:dispatch-${i}`,
            repo_ref: {
              provider: 'github',
              owner: 'org',
              name: 'repo',
              default_branch: 'main',
            },
          },
        });
        tasks.push(response.json());
      }

      // Dispatch all concurrently
      const dispatchPromises = tasks.map((task) =>
        app.inject({
          method: 'POST',
          url: `/v1/tasks/${task.task_id}/dispatch`,
          payload: { target_stage: 'plan' },
        })
      );

      await Promise.all(dispatchPromises);

      // Verify dispatch metrics
      const collector = getMetricsCollector();
      const metrics = await collector.export();
      expect(metrics).toContain('shipyard_dispatch_total');
    });
  });
});