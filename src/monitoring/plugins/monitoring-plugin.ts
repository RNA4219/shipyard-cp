/**
 * Monitoring Plugin for Fastify
 *
 * Registers the /metrics endpoint and collects request metrics automatically.
 * Includes error tracking and alert management (Phase 3).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import {
  PrometheusExporter,
  initializePrometheusExporter,
  getPrometheusExporter,
  resetPrometheusExporter,
} from '../metrics/prometheus-exporter.js';
import {
  MetricsCollector,
  initializeMetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
} from '../metrics/metrics-collector.js';
import {
  ErrorTracker,
  initializeErrorTracker,
  getErrorTracker,
  resetErrorTracker,
} from '../errors/error-tracker.js';
import {
  AlertManager,
  initializeAlertManager,
  getAlertManager,
  resetAlertManager,
} from '../errors/alert-manager.js';
import type { MonitoringConfig } from '../../config/index.js';

/**
 * Monitoring plugin options
 */
export interface MonitoringPluginOptions {
  /** Monitoring configuration */
  config: MonitoringConfig;
  /** Custom metrics endpoint */
  endpoint?: string;
  /** Enable request metrics collection */
  enableRequestMetrics?: boolean;
  /** Enable error tracking */
  enableErrorTracking?: boolean;
  /** Enable alert management */
  enableAlerts?: boolean;
  /** Alert evaluation interval in milliseconds */
  alertEvaluationIntervalMs?: number;
}

/**
 * Monitoring plugin for Fastify
 *
 * Provides:
 * - /metrics endpoint for Prometheus scraping
 * - Automatic request metrics collection
 * - Integration with the metrics collector
 * - Error tracking and capture (Phase 3)
 * - Alert management (Phase 3)
 */
export async function monitoringPlugin(
  app: FastifyInstance,
  options: MonitoringPluginOptions,
): Promise<void> {
  const {
    config,
    endpoint = '/metrics',
    enableRequestMetrics = true,
    enableErrorTracking = true,
    enableAlerts = true,
    alertEvaluationIntervalMs = 60000,
  } = options;

  // Initialize metrics collector
  const collector = initializeMetricsCollector({
    prefix: 'shipyard_',
    enableDefaultMetrics: config.metricsEnabled,
  });

  // Initialize Prometheus exporter
  const exporter = initializePrometheusExporter({
    collector,
    endpoint,
  });

  // Initialize error tracker (Phase 3)
  const errorTracker = enableErrorTracking ? initializeErrorTracker() : getErrorTracker();

  // Initialize alert manager (Phase 3)
  const alertManager = enableAlerts ? initializeAlertManager() : getAlertManager();

  // Decorate the app with metrics collector
  app.decorate('metrics', collector);
  app.decorate('errorTracker', errorTracker);
  app.decorate('alertManager', alertManager);

  // Register metrics endpoint
  if (config.metricsEnabled) {
    app.get(endpoint, async (_request: FastifyRequest, reply: FastifyReply) => {
      const response = await exporter.createResponse();
      return reply
        .type(response.contentType)
        .send(response.body);
    });
  }

  // Request metrics collection
  if (enableRequestMetrics) {
    // Track request start time
    app.addHook('onRequest', async (request: FastifyRequest) => {
      request.startTime = Date.now();
    });

    // Track request completion
    app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = request.startTime as number | undefined;
      if (startTime === undefined) return;

      const durationMs = Date.now() - startTime;
      const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? 'unknown';

      // Log slow requests
      if (durationMs > 1000) {
        request.log.warn({
          msg: 'Slow request detected',
          method: request.method,
          route,
          durationMs,
          statusCode: reply.statusCode,
        });
      }
    });
  }

  // Error tracking hooks (Phase 3)
  if (enableErrorTracking) {
    // Hook to capture errors
    app.setErrorHandler(async (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? 'unknown';

      // Capture the error with context
      const capturedError = errorTracker.captureError(error, {
        method: request.method,
        path: route,
        statusCode: 'statusCode' in error ? error.statusCode : reply.statusCode,
        requestId: request.id,
      });

      // Log the error
      request.log.error({
        msg: 'Request error captured',
        errorId: capturedError.id,
        fingerprint: capturedError.fingerprint,
        severity: capturedError.severity,
        category: capturedError.category,
        method: request.method,
        path: route,
        statusCode: reply.statusCode,
      });

      // Re-throw to let Fastify handle the response
      throw error;
    });

    // Hook for 4xx/5xx responses that don't throw errors
    app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const statusCode = reply.statusCode;

      // Capture 5xx responses as errors
      if (statusCode >= 500 && statusCode < 600) {
        const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? 'unknown';
        const error = new Error(`HTTP ${statusCode} response`);

        errorTracker.captureError(error, {
          method: request.method,
          path: route,
          statusCode,
          requestId: request.id,
          category: 'infrastructure',
        });
      }

      return payload;
    });
  }

  // Alert evaluation (Phase 3)
  if (enableAlerts) {
    // Periodic alert evaluation
    const alertInterval = setInterval(() => {
      const stats = errorTracker.getErrorStats();
      const result = alertManager.evaluate(stats);

      // Log alert state changes
      for (const alert of result.firingAlerts) {
        app.log.warn({
          msg: 'Alert firing',
          alertId: alert.id,
          ruleId: alert.ruleId,
          name: alert.name,
          severity: alert.severity,
          value: alert.value,
          threshold: alert.threshold,
        });
      }

      for (const alert of result.resolvedAlerts) {
        app.log.info({
          msg: 'Alert resolved',
          alertId: alert.id,
          ruleId: alert.ruleId,
          name: alert.name,
        });
      }
    }, alertEvaluationIntervalMs);

    // Clean up interval on close
    app.addHook('onClose', async () => {
      clearInterval(alertInterval);
    });
  }

  // Expose metrics collector through app decorator
  app.decorate('getMetrics', async () => {
    return exporter.export();
  });

  // Expose error stats through app decorator (Phase 3)
  app.decorate('getErrorStats', () => {
    return errorTracker.getErrorStats();
  });

  // Expose alerts through app decorator (Phase 3)
  app.decorate('getActiveAlerts', () => {
    return alertManager.getActiveAlerts();
  });
}

// TypeScript declaration merging for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    metrics?: MetricsCollector;
    errorTracker?: ErrorTracker;
    alertManager?: AlertManager;
    getMetrics?: () => Promise<string>;
    getErrorStats?: () => ReturnType<ErrorTracker['getErrorStats']>;
    getActiveAlerts?: () => ReturnType<AlertManager['getActiveAlerts']>;
  }

  interface FastifyRequest {
    startTime?: number;
  }
}

// Re-export for convenience
export {
  MetricsCollector,
  initializeMetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
  PrometheusExporter,
  getPrometheusExporter,
  resetPrometheusExporter,
};

// Re-export Phase 3 components
export {
  ErrorTracker,
  initializeErrorTracker,
  getErrorTracker,
  resetErrorTracker,
  AlertManager,
  initializeAlertManager,
  getAlertManager,
  resetAlertManager,
};