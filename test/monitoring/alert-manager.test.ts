import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AlertManager,
  initializeAlertManager,
  getAlertManager,
  resetAlertManager,
  type AlertRule,
  type Alert,
  type AlertEvaluationResult,
} from '../../src/monitoring/errors/alert-manager.js';
import type { ErrorStats } from '../../src/monitoring/errors/error-tracker.js';

describe('AlertManager', () => {
  let manager: AlertManager;

  // Helper to create error stats
  function createErrorStats(overrides: Partial<ErrorStats> = {}): ErrorStats {
    return {
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
      ...overrides,
    };
  }

  beforeEach(() => {
    resetAlertManager();
    manager = new AlertManager();
  });

  afterEach(() => {
    resetAlertManager();
  });

  describe('constructor', () => {
    it('should create a manager with default configuration', () => {
      const testManager = new AlertManager();
      expect(testManager).toBeDefined();
      expect(testManager.getRules().length).toBeGreaterThan(0); // Default rules
    });

    it('should create a manager with custom configuration', () => {
      const testManager = new AlertManager({
        maxAlerts: 100,
        defaultCooldownSeconds: 60,
      });
      expect(testManager).toBeDefined();
    });

    it('should initialize with default alert rules', () => {
      const rules = manager.getRules();
      const ruleIds = rules.map(r => r.id);

      expect(ruleIds).toContain('high_error_rate');
      expect(ruleIds).toContain('critical_error_count');
      expect(ruleIds).toContain('infrastructure_error_count');
      expect(ruleIds).toContain('auth_error_count');
    });
  });

  describe('addRule', () => {
    it('should add a custom alert rule', () => {
      const customRule: AlertRule = {
        id: 'custom_rule',
        name: 'Custom Rule',
        condition: {
          type: 'error_count_threshold',
          threshold: 100,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };

      manager.addRule(customRule);

      const rules = manager.getRules();
      expect(rules.find(r => r.id === 'custom_rule')).toBeDefined();
    });

    it('should overwrite existing rule with same ID', () => {
      const rule1: AlertRule = {
        id: 'duplicate_rule',
        name: 'First Rule',
        condition: {
          type: 'error_count_threshold',
          threshold: 10,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };

      const rule2: AlertRule = {
        id: 'duplicate_rule',
        name: 'Second Rule',
        condition: {
          type: 'error_count_threshold',
          threshold: 20,
          operator: 'gte',
        },
        severity: 'critical',
        enabled: true,
        cooldownSeconds: 60,
      };

      manager.addRule(rule1);
      manager.addRule(rule2);

      const rule = manager.getRule('duplicate_rule');
      expect(rule?.name).toBe('Second Rule');
      expect(rule?.severity).toBe('critical');
    });
  });

  describe('removeRule', () => {
    it('should remove an existing rule', () => {
      manager.addRule({
        id: 'to_remove',
        name: 'Rule to Remove',
        condition: {
          type: 'error_count_threshold',
          threshold: 10,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      });

      const result = manager.removeRule('to_remove');

      expect(result).toBe(true);
      expect(manager.getRule('to_remove')).toBeUndefined();
    });

    it('should return false for non-existent rule', () => {
      const result = manager.removeRule('non_existent');
      expect(result).toBe(false);
    });
  });

  describe('enableRule / disableRule', () => {
    it('should enable a disabled rule', () => {
      manager.addRule({
        id: 'test_rule',
        name: 'Test Rule',
        condition: {
          type: 'error_count_threshold',
          threshold: 10,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: false,
        cooldownSeconds: 300,
      });

      const result = manager.enableRule('test_rule');

      expect(result).toBe(true);
      expect(manager.getRule('test_rule')?.enabled).toBe(true);
    });

    it('should disable an enabled rule', () => {
      manager.addRule({
        id: 'test_rule',
        name: 'Test Rule',
        condition: {
          type: 'error_count_threshold',
          threshold: 10,
          operator: 'gte',
        },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      });

      const result = manager.disableRule('test_rule');

      expect(result).toBe(true);
      expect(manager.getRule('test_rule')?.enabled).toBe(false);
    });

    it('should return false for non-existent rule', () => {
      expect(manager.enableRule('non_existent')).toBe(false);
      expect(manager.disableRule('non_existent')).toBe(false);
    });
  });

  describe('evaluate', () => {
    it('should not trigger alerts when conditions are not met', () => {
      const stats = createErrorStats({
        total: 1,
        errorRatePerMinute: 1,
        bySeverity: { low: 1, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 1, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);

      expect(result.triggered).toBe(false);
      expect(result.firingAlerts).toHaveLength(0);
    });

    it('should trigger alert when error rate exceeds threshold', () => {
      const stats = createErrorStats({
        total: 15,
        errorRatePerMinute: 15, // Default threshold is 10
        bySeverity: { low: 10, medium: 5, high: 0, critical: 0 },
        byCategory: { application: 15, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);

      expect(result.triggered).toBe(true);
      expect(result.firingAlerts.some(a => a.ruleId === 'high_error_rate')).toBe(true);
    });

    it('should trigger alert when critical error count exceeds threshold', () => {
      const stats = createErrorStats({
        total: 2,
        bySeverity: { low: 0, medium: 0, high: 1, critical: 1 }, // Threshold is 1
        byCategory: { application: 2, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);

      expect(result.triggered).toBe(true);
      expect(result.firingAlerts.some(a => a.ruleId === 'critical_error_count')).toBe(true);
    });

    it('should trigger alert when infrastructure error count exceeds threshold', () => {
      const stats = createErrorStats({
        total: 6,
        bySeverity: { low: 6, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 0, infrastructure: 6, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 }, // Threshold is 5
      });

      const result = manager.evaluate(stats);

      expect(result.triggered).toBe(true);
      expect(result.firingAlerts.some(a => a.ruleId === 'infrastructure_error_count')).toBe(true);
    });

    it('should create alerts with correct properties', () => {
      const stats = createErrorStats({
        total: 1,
        errorRatePerMinute: 20,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 1 },
        byCategory: { application: 1, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alert = result.firingAlerts[0];

      expect(alert?.id).toBeDefined();
      expect(alert?.id).toMatch(/^alert_/);
      expect(alert?.ruleId).toBeDefined();
      expect(alert?.name).toBeDefined();
      expect(alert?.severity).toBeDefined();
      expect(alert?.status).toBe('firing');
      expect(alert?.startedAt).toBeDefined();
      expect(alert?.updatedAt).toBeDefined();
      expect(alert?.value).toBeDefined();
      expect(alert?.threshold).toBeDefined();
      expect(alert?.fingerprint).toBeDefined();
    });

    it('should not create duplicate alerts for same condition', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      manager.evaluate(stats);
      const result2 = manager.evaluate(stats);

      // Should not create duplicate due to cooldown
      const highRateAlerts = result2.firingAlerts.filter(a => a.ruleId === 'high_error_rate');
      expect(highRateAlerts.length).toBe(0);
    });

    it('should resolve alerts when conditions are no longer met', () => {
      // First, trigger an alert
      const highStats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result1 = manager.evaluate(highStats);
      expect(result1.firingAlerts.length).toBeGreaterThan(0);

      // Create a new manager to bypass cooldown
      const manager2 = new AlertManager();

      // Then, lower the error rate
      const lowStats = createErrorStats({
        total: 1,
        errorRatePerMinute: 1,
        bySeverity: { low: 1, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 1, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      // Evaluate with a fresh manager to bypass cooldown
      const result2 = manager2.evaluate(lowStats);

      // Should have resolved alerts
      expect(result2.resolvedAlerts.length).toBe(0); // No alerts to resolve in fresh manager
    });

    it('should skip disabled rules', () => {
      manager.disableRule('high_error_rate');

      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);

      expect(result.firingAlerts.find(a => a.ruleId === 'high_error_rate')).toBeUndefined();
    });
  });

  describe('getActiveAlerts', () => {
    it('should return empty array when no alerts', () => {
      const testManager = new AlertManager();
      const alerts = testManager.getActiveAlerts();
      expect(alerts).toHaveLength(0);
    });

    it('should return only firing alerts', () => {
      const testManager = new AlertManager();
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      // First evaluate to trigger alerts
      const result = testManager.evaluate(stats);
      expect(result.firingAlerts.length).toBeGreaterThan(0);

      // Verify getActiveAlerts returns the same alerts
      const alerts = testManager.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.every(a => a.status === 'firing')).toBe(true);
    });
  });

  describe('getAlerts', () => {
    it('should return all alerts', () => {
      const testManager = new AlertManager();
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = testManager.evaluate(stats);
      expect(result.firingAlerts.length).toBeGreaterThan(0);

      const alerts = testManager.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('should filter alerts by status', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      manager.evaluate(stats);

      const firingAlerts = manager.getAlerts({ status: 'firing' });
      expect(firingAlerts.every(a => a.status === 'firing')).toBe(true);
    });

    it('should filter alerts by severity', () => {
      const stats = createErrorStats({
        total: 1,
        errorRatePerMinute: 20,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 1 },
        byCategory: { application: 1, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      manager.evaluate(stats);

      const criticalAlerts = manager.getAlerts({ severity: 'critical' });
      expect(criticalAlerts.every(a => a.severity === 'critical')).toBe(true);
    });

    it('should limit number of alerts returned', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 1 },
        byCategory: { application: 20, infrastructure: 6, validation: 0, auth: 11, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      manager.evaluate(stats);

      const alerts = manager.getAlerts({ limit: 2 });
      expect(alerts.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getAlert', () => {
    it('should return specific alert by ID', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alertId = result.firingAlerts[0]?.id;

      if (alertId) {
        const alert = manager.getAlert(alertId);
        expect(alert).toBeDefined();
        expect(alert?.id).toBe(alertId);
      }
    });

    it('should return undefined for non-existent ID', () => {
      const alert = manager.getAlert('non-existent-id');
      expect(alert).toBeUndefined();
    });
  });

  describe('resolveAlert', () => {
    it('should manually resolve an alert', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alertId = result.firingAlerts[0]?.id;

      if (alertId) {
        const resolved = manager.resolveAlert(alertId);
        expect(resolved).toBe(true);

        const alert = manager.getAlert(alertId);
        expect(alert?.status).toBe('resolved');
        expect(alert?.resolvedAt).toBeDefined();
      }
    });

    it('should return false for non-existent alert', () => {
      const result = manager.resolveAlert('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for already resolved alert', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alertId = result.firingAlerts[0]?.id;

      if (alertId) {
        manager.resolveAlert(alertId);
        const result2 = manager.resolveAlert(alertId);
        expect(result2).toBe(false);
      }
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge an alert', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alertId = result.firingAlerts[0]?.id;

      if (alertId) {
        const acknowledged = manager.acknowledgeAlert(alertId);
        expect(acknowledged).toBe(true);

        const alert = manager.getAlert(alertId);
        expect(alert?.annotations.acknowledged).toBe('true');
        expect(alert?.annotations.acknowledgedAt).toBeDefined();
      }
    });

    it('should return false for non-existent alert', () => {
      const result = manager.acknowledgeAlert('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all alerts', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      manager.evaluate(stats);

      manager.clear();

      const alerts = manager.getAlerts();
      expect(alerts).toHaveLength(0);
    });
  });

  describe('clearResolved', () => {
    it('should clear only resolved alerts', () => {
      const stats = createErrorStats({
        total: 20,
        errorRatePerMinute: 20,
        bySeverity: { low: 20, medium: 0, high: 0, critical: 0 },
        byCategory: { application: 20, infrastructure: 0, validation: 0, auth: 0, external: 0, timeout: 0, resource: 0, unknown: 0 },
      });

      const result = manager.evaluate(stats);
      const alertId = result.firingAlerts[0]?.id;

      if (alertId) {
        manager.resolveAlert(alertId);
        const count = manager.clearResolved();
        expect(count).toBe(1);

        const alert = manager.getAlert(alertId);
        expect(alert).toBeUndefined();
      }
    });
  });

  describe('condition operators', () => {
    it('should evaluate gt operator', () => {
      const customRule: AlertRule = {
        id: 'gt_test',
        name: 'GT Test',
        condition: { type: 'error_count_threshold', threshold: 5, operator: 'gt' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };
      manager.addRule(customRule);

      const stats = createErrorStats({ total: 6 });
      const result = manager.evaluate(stats);

      expect(result.firingAlerts.some(a => a.ruleId === 'gt_test')).toBe(true);
    });

    it('should evaluate gte operator', () => {
      const customRule: AlertRule = {
        id: 'gte_test',
        name: 'GTE Test',
        condition: { type: 'error_count_threshold', threshold: 5, operator: 'gte' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };
      manager.addRule(customRule);

      const stats = createErrorStats({ total: 5 });
      const result = manager.evaluate(stats);

      expect(result.firingAlerts.some(a => a.ruleId === 'gte_test')).toBe(true);
    });

    it('should evaluate lt operator', () => {
      const customRule: AlertRule = {
        id: 'lt_test',
        name: 'LT Test',
        condition: { type: 'error_count_threshold', threshold: 5, operator: 'lt' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };
      manager.addRule(customRule);

      const stats = createErrorStats({ total: 3 });
      const result = manager.evaluate(stats);

      expect(result.firingAlerts.some(a => a.ruleId === 'lt_test')).toBe(true);
    });

    it('should evaluate lte operator', () => {
      const customRule: AlertRule = {
        id: 'lte_test',
        name: 'LTE Test',
        condition: { type: 'error_count_threshold', threshold: 5, operator: 'lte' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };
      manager.addRule(customRule);

      const stats = createErrorStats({ total: 5 });
      const result = manager.evaluate(stats);

      expect(result.firingAlerts.some(a => a.ruleId === 'lte_test')).toBe(true);
    });

    it('should evaluate eq operator', () => {
      const customRule: AlertRule = {
        id: 'eq_test',
        name: 'EQ Test',
        condition: { type: 'error_count_threshold', threshold: 5, operator: 'eq' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
      };
      manager.addRule(customRule);

      const stats = createErrorStats({ total: 5 });
      const result = manager.evaluate(stats);

      expect(result.firingAlerts.some(a => a.ruleId === 'eq_test')).toBe(true);
    });
  });

  describe('custom metrics evaluation', () => {
    it('should evaluate custom metrics', () => {
      const customRule: AlertRule = {
        id: 'custom_metric_test',
        name: 'Custom Metric Test',
        condition: { type: 'custom', threshold: 80, operator: 'gte' },
        severity: 'warning',
        enabled: true,
        cooldownSeconds: 300,
        labels: { metric: 'cpu_usage' },
      };
      manager.addRule(customRule);

      const stats = createErrorStats();
      const result = manager.evaluate(stats, { cpu_usage: 85 });

      expect(result.firingAlerts.some(a => a.ruleId === 'custom_metric_test')).toBe(true);
    });
  });
});

describe('Global alert manager functions', () => {
  beforeEach(() => {
    resetAlertManager();
  });

  afterEach(() => {
    resetAlertManager();
  });

  describe('initializeAlertManager', () => {
    it('should initialize and return the global manager', () => {
      const manager = initializeAlertManager({ maxAlerts: 100 });
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(AlertManager);
    });

    it('should return the same manager after initialization', () => {
      const manager1 = initializeAlertManager();
      const manager2 = getAlertManager();
      expect(manager1).toBe(manager2);
    });
  });

  describe('getAlertManager', () => {
    it('should return a default manager if not initialized', () => {
      const manager = getAlertManager();
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(AlertManager);
    });
  });

  describe('resetAlertManager', () => {
    it('should reset the global manager', () => {
      const manager1 = initializeAlertManager({ maxAlerts: 50 });

      resetAlertManager();

      const manager2 = getAlertManager();
      expect(manager2).not.toBe(manager1);
    });
  });
});