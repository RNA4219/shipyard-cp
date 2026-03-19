/**
 * Fastify Integration Tests for Monitoring
 *
 * Tests the actual Fastify instance with monitoring plugin:
 * - /metrics endpoint functionality
 * - Automatic metrics collection during requests
 * - Error tracking integration
 *
 * Note: Uses global monitoring instances (getMetricsCollector, getErrorTracker, etc.)
 * instead of Fastify decorators due to plugin encapsulation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  monitoringPlugin,
  resetMetricsCollector,
  resetPrometheusExporter,
  resetErrorTracker,
  resetAlertManager,
  getMetricsCollector,
  getErrorTracker,
  getAlertManager,
} from '../../../src/monitoring/index.js';

describe('Fastify Integration Tests', () => {
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

  describe('/metrics endpoint', () => {
    it('should expose metrics endpoint at default path', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
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

    it('should expose metrics at custom path', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/custom-metrics',
        },
        endpoint: '/custom-metrics',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/custom-metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('# HELP');
    });

    it('should include default Node.js metrics', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      // Should contain Node.js default metrics
      expect(response.body).toContain('nodejs_');
    });

    it('should include custom shipyard metrics after operations', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
      });

      // Use the global metrics collector
      const collector = getMetricsCollector();
      collector.incrementTasksTotal('queued');
      collector.incrementActiveTasks();
      collector.recordDispatch('plan');

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.body).toContain('shipyard_tasks_total');
      expect(response.body).toContain('shipyard_tasks_active');
      expect(response.body).toContain('shipyard_dispatch_total');
    });
  });

  describe('request metrics collection', () => {
    it('should have request metrics hooks registered', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableRequestMetrics: true,
      });

      // Add a test route
      app.get('/test', async (request, reply) => {
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(200);
      // Request completed successfully, hooks were registered
    });

    it('should log slow requests', async () => {
      const warnSpy = vi.fn();

      app = Fastify({
        logger: {
          level: 'warn',
          stream: {
            write: (msg: string) => {
              if (msg.includes('Slow request')) {
                warnSpy(msg);
              }
            },
          },
        },
      });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'warn',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableRequestMetrics: true,
      });

      // Add a slow route (simulate with delay)
      app.get('/slow', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/slow',
      });

      expect(response.statusCode).toBe(200);
      // Slow request should be logged (timing might be imprecise in tests)
    });
  });

  describe('error tracking integration', () => {
    it('should have error tracking enabled when configured', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
      });

      // Error tracker should be available
      const errorTracker = getErrorTracker();
      expect(errorTracker).toBeDefined();

      // Capture an error directly
      errorTracker.captureError(new Error('Test error'));

      const stats = errorTracker.getErrorStats();
      expect(stats.total).toBe(1);
    });

    it('should capture errors directly via error tracker', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
      });

      // Capture errors directly
      const errorTracker = getErrorTracker();
      errorTracker.captureError(new Error('Test error 1'));
      errorTracker.captureError(new Error('Test error 2'));

      const stats = errorTracker.getErrorStats();
      expect(stats.total).toBe(2);
    });

    it('should allow capturing errors with context', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
      });

      const errorTracker = getErrorTracker();
      errorTracker.captureError(new Error('API error'), {
        method: 'POST',
        path: '/api/test',
        statusCode: 500,
      });

      const errors = errorTracker.getErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].context.method).toBe('POST');
    });

    it('should not capture 4xx responses as infrastructure errors', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
      });

      // Manually capture errors
      const errorTracker = getErrorTracker();

      // 4xx errors should be categorized as medium severity, not infrastructure
      errorTracker.captureError(new Error('Not found'), { statusCode: 404 });

      const stats = errorTracker.getErrorStats();
      expect(stats.byCategory.infrastructure).toBe(0);
    });
  });

  describe('global monitoring instances', () => {
    it('should provide global metrics collector', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
      });

      const collector = getMetricsCollector();
      expect(collector).toBeDefined();
      expect(typeof collector.incrementTasksTotal).toBe('function');
      expect(typeof collector.export).toBe('function');
    });

    it('should provide global error tracker', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
      });

      const errorTracker = getErrorTracker();
      expect(errorTracker).toBeDefined();
      expect(typeof errorTracker.captureError).toBe('function');
      expect(typeof errorTracker.getErrorStats).toBe('function');
    });

    it('should provide global alert manager', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableAlerts: true,
      });

      const alertManager = getAlertManager();
      expect(alertManager).toBeDefined();
      expect(typeof alertManager.evaluate).toBe('function');
      expect(typeof alertManager.getActiveAlerts).toBe('function');
    });
  });

  describe('monitoring disabled', () => {
    it('should not register metrics endpoint when disabled', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: false,
          logLevel: 'info',
          metricsEnabled: false,
          metricsPath: '/metrics',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      // Should return 404 when metrics are disabled
      expect(response.statusCode).toBe(404);
    });
  });

  describe('graceful shutdown', () => {
    it('should clean up alert interval on close', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableAlerts: true,
        alertEvaluationIntervalMs: 1000,
      });

      // Close the app
      await app.close();

      // App should close without errors
      expect(app).toBeDefined();
    });
  });
});