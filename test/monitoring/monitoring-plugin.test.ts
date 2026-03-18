import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  resetMetricsCollector,
  resetPrometheusExporter,
  getMetricsCollector,
  getPrometheusExporter,
} from '../../src/monitoring/index.js';
import type { FastifyInstance } from 'fastify';

describe('Monitoring Plugin Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetMetricsCollector();
    resetPrometheusExporter();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    resetMetricsCollector();
    resetPrometheusExporter();
  });

  describe('/metrics endpoint', () => {
    it('should expose metrics endpoint', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/openmetrics-text');
      expect(response.body).toContain('# HELP');
      expect(response.body).toContain('# TYPE');
    });

    it('should include shipyard metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      // Create a task to generate metrics
      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          objective: 'Test objective',
          typed_ref: 'github:org/repo#1',
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
      expect(response.body).toContain('shipyard_tasks_total');
      expect(response.body).toContain('shipyard_tasks_active');
    });

    it('should use custom metrics path if configured', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
          metricsPath: '/custom-metrics',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/custom-metrics',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should include Node.js default metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.body).toContain('shipyard_nodejs_');
    });

    it('should track dispatch metrics', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      // Create a task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          objective: 'Test objective',
          typed_ref: 'github:org/repo#1',
          repo_ref: {
            provider: 'github',
            owner: 'org',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const task = createResponse.json() as { task_id: string };

      // Dispatch the task
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: {
          target_stage: 'plan',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.body).toContain('shipyard_dispatch_total');
      expect(response.body).toContain('shipyard_jobs_total');
    });
  });

  describe('global metrics access', () => {
    it('should provide global metrics collector', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      const collector = getMetricsCollector();
      expect(collector).toBeDefined();
      expect(typeof collector.incrementTasksTotal).toBe('function');
    });

    it('should provide global prometheus exporter', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      const exporter = getPrometheusExporter();
      expect(exporter).toBeDefined();
      expect(typeof exporter.export).toBe('function');
    });

    it('should export metrics through global exporter', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      const exporter = getPrometheusExporter();
      const metrics = await exporter.export();

      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
    });
  });
});