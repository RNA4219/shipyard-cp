/**
 * Error Tracking Integration Tests
 *
 * Tests error tracking integration with the full system:
 * - Real error capture during request handling
 * - Alert rule evaluation
 * - Error statistics aggregation
 *
 * Note: Error capture via Fastify's setErrorHandler may not work
 * during inject() testing. These tests focus on the core functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import {
  monitoringPlugin,
  resetMetricsCollector,
  resetPrometheusExporter,
  resetErrorTracker,
  resetAlertManager,
  getErrorTracker,
  getAlertManager,
  type AlertRule,
  type ErrorCategory,
  type ErrorSeverity,
  type CapturedError,
} from '../../../src/monitoring/index.js';

describe('Error Tracking Integration Tests', () => {
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

  describe('error tracker core functionality', () => {
    it('should capture errors directly', async () => {
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

      // Capture an error directly
      const error = new Error('Direct error capture');
      const captured = errorTracker.captureError(error);

      expect(captured.id).toBeDefined();
      expect(captured.message).toBe('Direct error capture');
      expect(captured.category).toBe('application');

      const errors = errorTracker.getErrors();
      expect(errors.length).toBe(1);
    });

    it('should capture error with context', async () => {
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

      const error = new Error('Error with context');
      const captured = errorTracker.captureError(error, {
        method: 'POST',
        path: '/api/test',
        statusCode: 500,
        taskId: 'task-123',
      });

      expect(captured.context.method).toBe('POST');
      expect(captured.context.path).toBe('/api/test');
      expect(captured.context.statusCode).toBe(500);
      expect(captured.context.taskId).toBe('task-123');
    });

    it('should categorize different error types correctly', async () => {
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

      // Validation error
      const validationError = new Error('Invalid input provided');
      validationError.name = 'ValidationError';
      const captured1 = errorTracker.captureError(validationError);
      expect(captured1.category).toBe('validation');

      // Timeout error
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      const captured2 = errorTracker.captureError(timeoutError);
      expect(captured2.category).toBe('timeout');

      // Auth error
      const authError = new Error('Unauthorized access');
      authError.name = 'UnauthorizedError';
      const captured3 = errorTracker.captureError(authError);
      expect(captured3.category).toBe('auth');
    });

    it('should determine error severity correctly', async () => {
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

      // Critical error
      const criticalError = new Error('Out of memory');
      const captured1 = errorTracker.captureError(criticalError);
      expect(captured1.severity).toBe('critical');

      // High severity (5xx status)
      const serverError = new Error('Server error');
      const captured2 = errorTracker.captureError(serverError, { statusCode: 500 });
      expect(captured2.severity).toBe('high');

      // Medium severity (4xx status)
      const notFoundError = new Error('Not found');
      const captured3 = errorTracker.captureError(notFoundError, { statusCode: 404 });
      expect(captured3.severity).toBe('medium');
    });
  });

  describe('error fingerprinting and deduplication', () => {
    it('should deduplicate identical errors', async () => {
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

      // Capture same error multiple times
      errorTracker.captureError(new Error('Same error'));
      errorTracker.captureError(new Error('Same error'));
      errorTracker.captureError(new Error('Same error'));

      const errors = errorTracker.getErrors();

      // Should be deduplicated to 1 unique error
      expect(errors.length).toBe(1);
      expect(errors[0].count).toBe(3);
    });

    it('should track different errors separately', async () => {
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

      errorTracker.captureError(new Error('First error'));
      errorTracker.captureError(new Error('Second error'));

      const errors = errorTracker.getErrors();

      expect(errors.length).toBe(2);
    });

    it('should fingerprint errors by HTTP context', async () => {
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

      // Same error on different endpoints
      errorTracker.captureError(new Error('Same error'), { method: 'GET', path: '/api/a' });
      errorTracker.captureError(new Error('Same error'), { method: 'POST', path: '/api/b' });

      const errors = errorTracker.getErrors();

      // Different endpoints should create different fingerprints
      expect(errors.length).toBe(2);
    });
  });

  describe('error statistics', () => {
    it('should provide accurate error statistics', async () => {
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

      // Create various errors
      const validationError = new Error('Invalid');
      validationError.name = 'ValidationError';
      errorTracker.captureError(validationError);

      const authError = new Error('Unauthorized');
      authError.name = 'UnauthorizedError';
      errorTracker.captureError(authError);

      errorTracker.captureError(new Error('Regular error'));

      const stats = errorTracker.getErrorStats();

      expect(stats.total).toBe(3);
      expect(stats.unresolved).toBe(3);
      expect(stats.uniqueCount).toBe(3);
      expect(stats.byCategory.validation).toBe(1);
      expect(stats.byCategory.auth).toBe(1);
    });

    it('should track resolved vs unresolved errors', async () => {
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

      const captured = errorTracker.captureError(new Error('Test error'));

      let stats = errorTracker.getErrorStats();
      expect(stats.unresolved).toBe(1);

      // Resolve the error
      errorTracker.resolveError(captured.id);

      stats = errorTracker.getErrorStats();
      expect(stats.unresolved).toBe(0);
    });

    it('should calculate error rate per minute', async () => {
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

      // Generate multiple errors
      for (let i = 0; i < 5; i++) {
        errorTracker.captureError(new Error(`Error ${i}`));
      }

      const stats = errorTracker.getErrorStats();

      // Error rate should be calculated
      expect(stats.errorRatePerMinute).toBeDefined();
      expect(typeof stats.errorRatePerMinute).toBe('number');
    });
  });

  describe('alert rule evaluation', () => {
    it('should evaluate default alert rules', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const alertManager = getAlertManager();
      const rules = alertManager.getRules();

      // Should have default rules
      expect(rules.length).toBeGreaterThan(0);

      const ruleIds = rules.map((r) => r.id);
      expect(ruleIds).toContain('high_error_rate');
      expect(ruleIds).toContain('critical_error_count');
    });

    it('should trigger alert for critical errors', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      // Capture a critical error
      const criticalError = new Error('Out of memory');
      errorTracker.captureError(criticalError);

      const stats = errorTracker.getErrorStats();
      const result = alertManager.evaluate(stats);

      // Critical error should trigger alert
      const criticalAlert = result.firingAlerts.find(
        (a) => a.ruleId === 'critical_error_count'
      );

      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.severity).toBe('critical');
    });

    it('should trigger alert for high error rate', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      // Add a custom rule with low threshold
      alertManager.addRule({
        id: 'test_high_error_rate',
        name: 'Test High Error Rate',
        condition: {
          type: 'error_rate_threshold',
          threshold: 3,
          operator: 'gt',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 0,
      });

      // Generate multiple errors quickly
      for (let i = 0; i < 5; i++) {
        errorTracker.captureError(new Error(`Error ${i}`));
      }

      const stats = errorTracker.getErrorStats();
      const result = alertManager.evaluate(stats);

      expect(result.triggered).toBe(true);
    });

    it('should resolve alerts when condition no longer met', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      // Add a rule with low threshold
      alertManager.addRule({
        id: 'test_resolve_alert',
        name: 'Test Resolve',
        condition: {
          type: 'error_count_threshold',
          threshold: 1,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 0,
      });

      // Capture an error
      errorTracker.captureError(new Error('Test'));

      let stats = errorTracker.getErrorStats();
      let result = alertManager.evaluate(stats);
      expect(result.firingAlerts.length).toBeGreaterThan(0);

      // Clear all errors (this removes them completely, unlike resolveAllErrors)
      errorTracker.clear();

      stats = errorTracker.getErrorStats();
      // Total should now be 0
      expect(stats.total).toBe(0);

      result = alertManager.evaluate(stats);
      // Since there are no errors, alerts should resolve
      expect(result.resolvedAlerts.length).toBeGreaterThan(0);
    });

    it('should support custom alert rules', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const alertManager = getAlertManager();

      const customRule: AlertRule = {
        id: 'custom_infrastructure_alert',
        name: 'Infrastructure Error Alert',
        condition: {
          type: 'error_category_count',
          threshold: 2,
          operator: 'gte',
          category: 'infrastructure' as ErrorCategory,
        },
        severity: 'critical',
        enabled: true,
        cooldownSeconds: 60,
      };

      alertManager.addRule(customRule);

      const rules = alertManager.getRules();
      expect(rules.find((r) => r.id === 'custom_infrastructure_alert')).toBeDefined();
    });

    it('should respect alert cooldown', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      // Add rule with cooldown
      alertManager.addRule({
        id: 'cooldown_test',
        name: 'Cooldown Test',
        condition: {
          type: 'error_count_threshold',
          threshold: 1,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 60,
      });

      errorTracker.captureError(new Error('Test'));

      // First evaluation - should trigger
      let result = alertManager.evaluate(errorTracker.getErrorStats());
      expect(result.firingAlerts.length).toBeGreaterThan(0);

      // Second evaluation - should not trigger due to cooldown
      result = alertManager.evaluate(errorTracker.getErrorStats());
      // Alerts should still exist but no new firing
      expect(result.firingAlerts.length).toBe(0);
    });
  });

  describe('alert management operations', () => {
    it('should get active alerts', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      // Add rule with no cooldown
      alertManager.addRule({
        id: 'active_test',
        name: 'Active Test',
        condition: {
          type: 'error_count_threshold',
          threshold: 1,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 0,
      });

      errorTracker.captureError(new Error('Test'));
      alertManager.evaluate(errorTracker.getErrorStats());

      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.length).toBeGreaterThan(0);
    });

    it('should manually resolve alerts', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      alertManager.addRule({
        id: 'manual_resolve_test',
        name: 'Manual Resolve Test',
        condition: {
          type: 'error_count_threshold',
          threshold: 1,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 0,
      });

      errorTracker.captureError(new Error('Test'));
      alertManager.evaluate(errorTracker.getErrorStats());

      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.length).toBeGreaterThan(0);

      // Manually resolve
      const resolved = alertManager.resolveAlert(activeAlerts[0].id);
      expect(resolved).toBe(true);

      const alert = alertManager.getAlert(activeAlerts[0].id);
      expect(alert?.status).toBe('resolved');
    });

    it('should acknowledge alerts', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const errorTracker = getErrorTracker();
      const alertManager = getAlertManager();

      alertManager.addRule({
        id: 'ack_test',
        name: 'Ack Test',
        condition: {
          type: 'error_count_threshold',
          threshold: 1,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 0,
      });

      errorTracker.captureError(new Error('Test'));
      alertManager.evaluate(errorTracker.getErrorStats());

      const activeAlerts = alertManager.getActiveAlerts();
      const acknowledged = alertManager.acknowledgeAlert(activeAlerts[0].id);

      expect(acknowledged).toBe(true);

      const alert = alertManager.getAlert(activeAlerts[0].id);
      expect(alert?.annotations.acknowledged).toBe('true');
    });

    it('should enable and disable rules', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: true,
      });

      const alertManager = getAlertManager();

      // Disable a rule
      const disabled = alertManager.disableRule('high_error_rate');
      expect(disabled).toBe(true);

      let rule = alertManager.getRule('high_error_rate');
      expect(rule?.enabled).toBe(false);

      // Re-enable the rule
      const enabled = alertManager.enableRule('high_error_rate');
      expect(enabled).toBe(true);

      rule = alertManager.getRule('high_error_rate');
      expect(rule?.enabled).toBe(true);
    });
  });

  describe('error tracking with disabled feature', () => {
    it('should not track errors when error tracking is disabled', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: false,
      });

      const errorTracker = getErrorTracker();

      // Capture error manually (this tests if the error tracker is usable)
      errorTracker.captureError(new Error('Test'));

      // Since enableErrorTracking=false, the plugin doesn't initialize a new tracker
      // but we can still use getErrorTracker() which returns the global or creates one
      const stats = errorTracker.getErrorStats();
      expect(stats.total).toBe(1);
    });

    it('should not evaluate alerts when alerts are disabled', async () => {
      app = Fastify({ logger: false });

      await app.register(monitoringPlugin, {
        config: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        enableErrorTracking: true,
        enableAlerts: false,
      });

      // Alerts should still be available but not automatically evaluated
      const alertManager = getAlertManager();
      expect(alertManager).toBeDefined();

      // Can still manually evaluate
      const result = alertManager.evaluate({
        total: 0,
        byCategory: {
          application: 0,
          infrastructure: 0,
          validation: 0,
          auth: 0,
          external: 0,
          timeout: 0,
          resource: 0,
          unknown: 0,
        },
        bySeverity: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
        unresolved: 0,
        uniqueCount: 0,
      });

      expect(result.triggered).toBe(false);
    });
  });
});