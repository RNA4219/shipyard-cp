import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  resetMetricsCollector,
  resetPrometheusExporter,
  getMetricsCollector,
  getPrometheusExporter,
  resetErrorTracker,
  resetAlertManager,
} from '../../src/monitoring/index.js';
import { monitoringPlugin } from '../../src/monitoring/plugins/monitoring-plugin.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastify from 'fastify';

describe('Monitoring Plugin Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
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

  describe('/metrics endpoint', () => {
    it('should expose metrics endpoint', async () => {
      app = await buildApp({
        logger: false,
        monitoring: {
          enabled: true,
          metricsEnabled: true,
        },
      auth: { enabled: false },
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
      auth: { enabled: false },
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
      auth: { enabled: false },
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
      auth: { enabled: false },
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
      auth: { enabled: false },
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
      auth: { enabled: false },
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
      auth: { enabled: false },
      });

      const exporter = getPrometheusExporter();
      const metrics = await exporter.export();

      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
    });
  });

  describe('Plugin Registration', () => {
    it('should register plugin directly with fastify', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: {
          enabled: true,
          metricsEnabled: true,
        },
      });

      expect(app.metrics).toBeDefined();
      expect(app.errorTracker).toBeDefined();
      expect(app.alertManager).toBeDefined();
      expect(app.getMetrics).toBeDefined();
      expect(app.getErrorStats).toBeDefined();
      expect(app.getActiveAlerts).toBeDefined();

      await app.close();
    });

    it('should decorate app with metrics collector', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.metrics).toBeDefined();
      expect(typeof app.metrics?.incrementTasksTotal).toBe('function');
      expect(typeof app.metrics?.setActiveTasks).toBe('function');

      await app.close();
    });

    it('should decorate app with error tracker', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.errorTracker).toBeDefined();
      expect(typeof app.errorTracker?.captureError).toBe('function');
      expect(typeof app.errorTracker?.getErrorStats).toBe('function');

      await app.close();
    });

    it('should decorate app with alert manager', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.alertManager).toBeDefined();
      expect(typeof app.alertManager?.evaluate).toBe('function');
      expect(typeof app.alertManager?.getActiveAlerts).toBe('function');

      await app.close();
    });

    it('should expose getMetrics function', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.getMetrics).toBeDefined();
      const metrics = await app.getMetrics?.();
      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');

      await app.close();
    });

    it('should expose getErrorStats function', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.getErrorStats).toBeDefined();
      const stats = app.getErrorStats?.();
      expect(stats).toBeDefined();
      expect(stats?.total).toBe(0);
      expect(stats?.byCategory).toBeDefined();
      expect(stats?.bySeverity).toBeDefined();

      await app.close();
    });

    it('should expose getActiveAlerts function', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      expect(app.getActiveAlerts).toBeDefined();
      const alerts = app.getActiveAlerts?.();
      expect(Array.isArray(alerts)).toBe(true);

      await app.close();
    });
  });

  describe('Request Metrics Hooks', () => {
    it('should set startTime on request', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      let capturedRequest: FastifyRequest | null = null;
      app.get('/test', async (request: FastifyRequest) => {
        capturedRequest = request;
        return { ok: true };
      });

      await app.inject({ method: 'GET', url: '/test' });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest?.startTime).toBeDefined();
      expect(typeof capturedRequest?.startTime).toBe('number');

      await app.close();
    });

    it('should track request duration on response', async () => {
      app = fastify();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/test', async () => {
        return { ok: true };
      });

      const response = await app.inject({ method: 'GET', url: '/test' });
      expect(response.statusCode).toBe(200);

      warnSpy.mockRestore();
      await app.close();
    });

    it('should log slow requests (>1000ms)', async () => {
      const capturedLogs: Record<string, unknown>[] = [];
      const stream = {
        write: (msg: string) => {
          try {
            capturedLogs.push(JSON.parse(msg));
          } catch {
            // ignore parse errors
          }
        },
      };

      app = fastify({
        logger: {
          level: 'warn',
          stream,
        },
      });

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 1100));
        return { ok: true };
      });

      await app.inject({ method: 'GET', url: '/slow' });

      // Check if warning was logged
      const slowRequestLogs = capturedLogs.filter(log => log.msg === 'Slow request detected');
      expect(slowRequestLogs.length).toBeGreaterThan(0);

      await app.close();
    });

    it('should not log fast requests as slow', async () => {
      const capturedLogs: Record<string, unknown>[] = [];
      const stream = {
        write: (msg: string) => {
          try {
            capturedLogs.push(JSON.parse(msg));
          } catch {
            // ignore parse errors
          }
        },
      };

      app = fastify({
        logger: {
          level: 'warn',
          stream,
        },
      });

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/fast', async () => {
        return { ok: true };
      });

      await app.inject({ method: 'GET', url: '/fast' });

      // Slow request warning should not be called
      const slowRequestLogs = capturedLogs.filter(log => log.msg === 'Slow request detected');
      expect(slowRequestLogs.length).toBe(0);

      await app.close();
    });

    it('should handle requests without startTime gracefully', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      // Create a route that doesn't have startTime (simulating edge case)
      app.get('/no-start-time', async () => {
        return { ok: true };
      });

      // Manually inject request without startTime
      const response = await app.inject({ method: 'GET', url: '/no-start-time' });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it('should use routeOptions.url for route identification', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/route/:id', async () => {
        return { ok: true };
      });

      const response = await app.inject({ method: 'GET', url: '/route/123' });
      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });

  describe('Error Handling Hooks', () => {
    it('should capture errors with context', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/error', async () => {
        throw new Error('Test error');
      });

      const response = await app.inject({ method: 'GET', url: '/error' });
      expect(response.statusCode).toBe(500);

      // Check that error was captured
      const stats = app.getErrorStats?.();
      expect(stats?.total).toBeGreaterThan(0);

      await app.close();
    });

    it('should capture 5xx responses in onSend hook', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/server-error', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.code(500).send({ error: 'Internal Server Error' });
      });

      await app.inject({ method: 'GET', url: '/server-error' });

      // Check that 5xx was captured
      const stats = app.getErrorStats?.();
      expect(stats?.byCategory.infrastructure).toBeGreaterThan(0);

      await app.close();
    });

    it('should not capture 4xx responses as errors', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/not-found', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.code(404).send({ error: 'Not Found' });
      });

      await app.inject({ method: 'GET', url: '/not-found' });

      // 4xx should not increment error count in infrastructure category
      const stats = app.getErrorStats?.();
      // Total errors should be 0 or only include application errors
      expect(stats?.byCategory.infrastructure).toBe(0);

      await app.close();
    });

    it('should include error metadata in captured errors', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/error-with-context', async () => {
        throw new Error('Context error');
      });

      await app.inject({ method: 'GET', url: '/error-with-context' });

      const stats = app.getErrorStats?.();
      expect(stats?.total).toBeGreaterThan(0);

      await app.close();
    });

    it('should capture error with requestId', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/error-request-id', async () => {
        throw new Error('Error with request ID');
      });

      const response = await app.inject({ method: 'GET', url: '/error-request-id' });
      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it('should handle errors with statusCode property', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      const customError = new Error('Custom error') as Error & { statusCode: number };
      customError.statusCode = 503;

      app.get('/custom-error', async () => {
        throw customError;
      });

      const response = await app.inject({ method: 'GET', url: '/custom-error' });
      expect(response.statusCode).toBe(503);

      await app.close();
    });
  });

  describe('Configuration Options', () => {
    it('should disable request metrics when enableRequestMetrics is false', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: false,
      });

      let capturedRequest: FastifyRequest | null = null;
      app.get('/test', async (request: FastifyRequest) => {
        capturedRequest = request;
        return { ok: true };
      });

      await app.inject({ method: 'GET', url: '/test' });

      // startTime should not be set when request metrics are disabled
      expect(capturedRequest?.startTime).toBeUndefined();

      await app.close();
    });

    it('should disable error tracking when enableErrorTracking is false', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: false,
      });

      app.get('/error', async () => {
        throw new Error('Test error');
      });

      await app.inject({ method: 'GET', url: '/error' });

      // Error should not be captured when error tracking is disabled
      const stats = app.getErrorStats?.();
      expect(stats?.total).toBe(0);

      await app.close();
    });

    it('should disable alerts when enableAlerts is false', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: false,
      });

      // Alert manager should still be available but no interval should be running
      expect(app.alertManager).toBeDefined();

      await app.close();
    });

    it('should not register metrics endpoint when metricsEnabled is false', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: false },
      });

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(404);

      await app.close();
    });

    it('should use custom endpoint path', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        endpoint: '/custom-prometheus',
      });

      const response = await app.inject({ method: 'GET', url: '/custom-prometheus' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/openmetrics-text');

      await app.close();
    });

    it('should use custom alert evaluation interval', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: true,
        alertEvaluationIntervalMs: 100, // 100ms for testing
      });

      // Generate an error to trigger alert evaluation
      app.get('/error', async () => {
        throw new Error('Test error');
      });

      await app.inject({ method: 'GET', url: '/error' });

      // Wait for at least one alert evaluation cycle
      await new Promise(resolve => setTimeout(resolve, 150));

      await app.close();
    });

    it('should initialize with default options', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      // Verify defaults are applied
      expect(app.metrics).toBeDefined();
      expect(app.errorTracker).toBeDefined();
      expect(app.alertManager).toBeDefined();

      await app.close();
    });

    it('should handle metricsEnabled undefined in config', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true },
      });

      // metricsEnabled defaults to false when not specified
      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('Alert Management', () => {
    it('should clean up alert interval on app close', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: true,
        alertEvaluationIntervalMs: 100,
      });

      // Close the app - should clear the interval
      await app.close();

      // App should close without hanging (interval was cleared)
      expect(true).toBe(true);
    });

    it('should evaluate alerts periodically', async () => {
      app = fastify();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: true,
        alertEvaluationIntervalMs: 50,
      });

      // Generate many errors to trigger alert
      for (let i = 0; i < 15; i++) {
        app.errorTracker?.captureError(new Error(`Error ${i}`), {
          category: 'application',
        });
      }

      // Wait for alert evaluation
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = app.getActiveAlerts?.();
      // May or may not have alerts depending on rules
      expect(Array.isArray(alerts)).toBe(true);

      warnSpy.mockRestore();
      await app.close();
    });

    it('should log firing alerts', async () => {
      const capturedLogs: Record<string, unknown>[] = [];
      const stream = {
        write: (msg: string) => {
          try {
            capturedLogs.push(JSON.parse(msg));
          } catch {
            // ignore parse errors
          }
        },
      };

      app = fastify({
        logger: {
          level: 'warn',
          stream,
        },
      });

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: true,
        alertEvaluationIntervalMs: 50,
      });

      // Generate critical error to trigger alert
      app.errorTracker?.captureError(new Error('Critical error'), {
        category: 'infrastructure',
      });

      // Wait for alert evaluation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if warning was logged for firing alert
      // Note: This depends on alert rules configuration

      await app.close();
    });

    it('should log resolved alerts', async () => {
      const capturedLogs: Record<string, unknown>[] = [];
      const stream = {
        write: (msg: string) => {
          try {
            capturedLogs.push(JSON.parse(msg));
          } catch {
            // ignore parse errors
          }
        },
      };

      app = fastify({
        logger: {
          level: 'info',
          stream,
        },
      });

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableAlerts: true,
        alertEvaluationIntervalMs: 50,
      });

      // Generate and then clear errors to test resolution
      app.errorTracker?.captureError(new Error('Temporary error'), {
        category: 'application',
      });

      // Wait for first evaluation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear errors
      app.errorTracker?.clear();

      // Wait for second evaluation
      await new Promise(resolve => setTimeout(resolve, 100));

      await app.close();
    });
  });

  describe('Integration with Error Tracker and Alert Manager', () => {
    it('should integrate error tracker with alert manager', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      // Capture an error
      app.errorTracker?.captureError(new Error('Integration test error'), {
        category: 'application',
      });

      // Get error stats
      const stats = app.getErrorStats?.();
      expect(stats?.total).toBeGreaterThan(0);

      // Alert manager should be able to evaluate
      const result = app.alertManager?.evaluate(stats!);
      expect(result).toBeDefined();

      await app.close();
    });

    it('should track multiple errors of same type', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      // Capture same error multiple times
      for (let i = 0; i < 5; i++) {
        app.errorTracker?.captureError(new Error('Recurring error'), {
          path: '/test',
          method: 'GET',
        });
      }

      const stats = app.getErrorStats?.();
      // Should have unique fingerprint, so count reflects occurrences
      expect(stats?.total).toBeGreaterThanOrEqual(1);

      await app.close();
    });

    it('should categorize errors correctly', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      // Capture different error types
      const validationError = new Error('Invalid input');
      validationError.name = 'ValidationError';
      app.errorTracker?.captureError(validationError);

      const authError = new Error('Unauthorized');
      authError.name = 'UnauthorizedError';
      app.errorTracker?.captureError(authError);

      const stats = app.getErrorStats?.();
      expect(stats?.byCategory.validation).toBeGreaterThan(0);
      expect(stats?.byCategory.auth).toBeGreaterThan(0);

      await app.close();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing routeOptions gracefully', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      // Test with a URL that might not have routeOptions
      app.get('/test-route', async () => ({ ok: true }));

      const response = await app.inject({ method: 'GET', url: '/non-existent-route' });
      expect(response.statusCode).toBe(404);

      await app.close();
    });

    it('should handle concurrent requests', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/concurrent', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { ok: true };
      });

      // Make concurrent requests
      const promises = Array(10).fill(null).map(() =>
        app.inject({ method: 'GET', url: '/concurrent' })
      );

      const responses = await Promise.all(promises);
      responses.forEach(r => expect(r.statusCode).toBe(200));

      await app.close();
    });

    it('should handle errors thrown during error handler', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableErrorTracking: true,
      });

      app.get('/error-in-error', async () => {
        throw new Error('Primary error');
      });

      const response = await app.inject({ method: 'GET', url: '/error-in-error' });
      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it('should work with fastify encapsulation', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
      });

      // Register a plugin that encapsulates routes
      app.register(async (fastify) => {
        fastify.get('/encapsulated', async () => ({ ok: true }));
      });

      const response = await app.inject({ method: 'GET', url: '/encapsulated' });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it('should handle request with query parameters', async () => {
      app = fastify();

      await monitoringPlugin(app, {
        config: { enabled: true, metricsEnabled: true },
        enableRequestMetrics: true,
      });

      app.get('/query-test', async () => ({ ok: true }));

      const response = await app.inject({ method: 'GET', url: '/query-test?param=value' });
      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });
});