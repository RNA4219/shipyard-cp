/**
 * Alert Manager for Shipyard Control Plane
 *
 * Manages alert rules, evaluation, and alert lifecycle:
 * - Rule-based alert evaluation
 * - Alert deduplication
 * - Alert state management
 * - Integration with error tracker
 */

import type { ErrorStats, ErrorSeverity, ErrorCategory } from './error-tracker.js';

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Alert status
 */
export type AlertStatus = 'firing' | 'resolved';

/**
 * Alert rule condition types
 */
export type AlertConditionType =
  | 'error_rate_threshold'
  | 'error_count_threshold'
  | 'error_severity_count'
  | 'error_category_count'
  | 'task_failure_rate'
  | 'custom';

/**
 * Alert rule condition
 */
export interface AlertCondition {
  /** Condition type */
  type: AlertConditionType;
  /** Threshold value */
  threshold: number;
  /** Comparison operator */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  /** Time window in seconds for rate-based conditions */
  windowSeconds?: number;
  /** Category filter for error_category_count */
  category?: ErrorCategory;
  /** Severity filter for error_severity_count */
  severity?: ErrorSeverity;
}

/**
 * Alert rule definition
 */
export interface AlertRule {
  /** Rule identifier */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Condition to evaluate */
  condition: AlertCondition;
  /** Alert severity when firing */
  severity: AlertSeverity;
  /** Enable/disable rule */
  enabled: boolean;
  /** Cooldown period in seconds before re-alerting */
  cooldownSeconds: number;
  /** Custom labels */
  labels?: Record<string, string>;
  /** Custom annotations */
  annotations?: Record<string, string>;
}

/**
 * Alert instance
 */
export interface Alert {
  /** Unique alert ID */
  id: string;
  /** Rule that triggered this alert */
  ruleId: string;
  /** Alert name */
  name: string;
  /** Alert severity */
  severity: AlertSeverity;
  /** Current status */
  status: AlertStatus;
  /** When the alert started firing */
  startedAt: string;
  /** When the alert was last updated */
  updatedAt: string;
  /** When the alert was resolved */
  resolvedAt?: string;
  /** Current value that triggered the alert */
  value: number;
  /** Threshold value */
  threshold: number;
  /** Labels */
  labels: Record<string, string>;
  /** Annotations */
  annotations: Record<string, string>;
  /** Fingerprint for deduplication */
  fingerprint: string;
}

/**
 * Alert evaluation result
 */
export interface AlertEvaluationResult {
  /** Whether any alerts were triggered */
  triggered: boolean;
  /** Alerts that started firing */
  firingAlerts: Alert[];
  /** Alerts that were resolved */
  resolvedAlerts: Alert[];
  /** Total active alerts */
  activeCount: number;
}

/**
 * Alert manager configuration
 */
export interface AlertManagerConfig {
  /** Maximum alerts to keep in memory */
  maxAlerts?: number;
  /** Default cooldown period in seconds */
  defaultCooldownSeconds?: number;
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate fingerprint for deduplication
 */
function generateFingerprint(ruleId: string, labels: Record<string, string>): string {
  const parts = [ruleId];
  const sortedLabels = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of sortedLabels) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(':');
}

/**
 * Default alert rules
 */
const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'high_error_rate',
    name: 'High Error Rate',
    description: 'Error rate exceeds threshold per minute',
    condition: {
      type: 'error_rate_threshold',
      threshold: 10,
      operator: 'gt',
    },
    severity: 'warning',
    enabled: true,
    cooldownSeconds: 300,
  },
  {
    id: 'critical_error_count',
    name: 'Critical Error Count',
    description: 'Number of critical errors exceeds threshold',
    condition: {
      type: 'error_severity_count',
      threshold: 1,
      operator: 'gte',
      severity: 'critical',
    },
    severity: 'critical',
    enabled: true,
    cooldownSeconds: 60,
  },
  {
    id: 'infrastructure_error_count',
    name: 'Infrastructure Error Count',
    description: 'Number of infrastructure errors exceeds threshold',
    condition: {
      type: 'error_category_count',
      threshold: 5,
      operator: 'gte',
      category: 'infrastructure',
    },
    severity: 'critical',
    enabled: true,
    cooldownSeconds: 120,
  },
  {
    id: 'auth_error_count',
    name: 'Authentication Error Count',
    description: 'Number of authentication errors exceeds threshold',
    condition: {
      type: 'error_category_count',
      threshold: 10,
      operator: 'gte',
      category: 'auth',
    },
    severity: 'warning',
    enabled: true,
    cooldownSeconds: 300,
  },
];

/**
 * Alert Manager class
 *
 * Manages alert rules and alert lifecycle.
 */
export class AlertManager {
  private readonly config: Required<AlertManagerConfig>;
  private readonly rules: Map<string, AlertRule> = new Map();
  private readonly alerts: Map<string, Alert> = new Map();
  private readonly fingerprintIndex: Map<string, string> = new Map();
  private readonly cooldownTracker: Map<string, string> = new Map();

  constructor(config: AlertManagerConfig = {}) {
    this.config = {
      maxAlerts: config.maxAlerts ?? 1000,
      defaultCooldownSeconds: config.defaultCooldownSeconds ?? 300,
    };

    // Initialize with default rules (deep copy to prevent shared state)
    for (const rule of DEFAULT_RULES) {
      this.rules.set(rule.id, { ...rule, condition: { ...rule.condition }, labels: { ...rule.labels }, annotations: { ...rule.annotations } });
    }
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule
   */
  getRule(ruleId: string): AlertRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Enable a rule
   */
  enableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a rule
   */
  disableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Evaluate a condition against error stats
   */
  private evaluateCondition(condition: AlertCondition, stats: ErrorStats): { matches: boolean; value: number } {
    let value = 0;

    switch (condition.type) {
      case 'error_rate_threshold':
        value = stats.errorRatePerMinute ?? 0;
        break;

      case 'error_count_threshold':
        value = stats.total;
        break;

      case 'error_severity_count':
        if (condition.severity) {
          value = stats.bySeverity[condition.severity];
        }
        break;

      case 'error_category_count':
        if (condition.category) {
          value = stats.byCategory[condition.category];
        }
        break;

      case 'task_failure_rate':
        // This would need to be provided externally
        value = 0;
        break;

      case 'custom':
        // Custom conditions would need external evaluation
        value = 0;
        break;
    }

    // Evaluate operator
    let matches = false;
    switch (condition.operator) {
      case 'gt':
        matches = value > condition.threshold;
        break;
      case 'gte':
        matches = value >= condition.threshold;
        break;
      case 'lt':
        matches = value < condition.threshold;
        break;
      case 'lte':
        matches = value <= condition.threshold;
        break;
      case 'eq':
        matches = value === condition.threshold;
        break;
    }

    return { matches, value };
  }

  /**
   * Check if rule is in cooldown
   */
  private isInCooldown(fingerprint: string): boolean {
    const cooldownEnd = this.cooldownTracker.get(fingerprint);
    if (!cooldownEnd) return false;

    if (new Date() < new Date(cooldownEnd)) {
      return true;
    }

    // Cooldown expired, remove it
    this.cooldownTracker.delete(fingerprint);
    return false;
  }

  /**
   * Set cooldown for a fingerprint
   */
  private setCooldown(fingerprint: string, seconds: number): void {
    const cooldownEnd = new Date(Date.now() + seconds * 1000).toISOString();
    this.cooldownTracker.set(fingerprint, cooldownEnd);
  }

  /**
   * Create an alert from a rule
   */
  private createAlert(rule: AlertRule, value: number): Alert {
    const now = new Date().toISOString();
    const labels = { ...rule.labels };
    const annotations = {
      description: rule.description ?? '',
      ...rule.annotations,
    };

    const fingerprint = generateFingerprint(rule.id, labels);

    const alert: Alert = {
      id: generateId(),
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      status: 'firing',
      startedAt: now,
      updatedAt: now,
      value,
      threshold: rule.condition.threshold,
      labels,
      annotations,
      fingerprint,
    };

    return alert;
  }

  /**
   * Evaluate all rules against error stats
   */
  evaluate(stats: ErrorStats, customMetrics?: Record<string, number>): AlertEvaluationResult {
    const now = new Date().toISOString();
    const firingAlerts: Alert[] = [];
    const resolvedAlerts: Alert[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Get value based on condition type
      let evaluation: { matches: boolean; value: number };

      if (rule.condition.type === 'custom' && customMetrics) {
        const metricKey = rule.labels?.metric ?? '';
        const value = customMetrics[metricKey] ?? 0;
        evaluation = { matches: false, value };
        // Evaluate with standard operators
        switch (rule.condition.operator) {
          case 'gt':
            evaluation.matches = value > rule.condition.threshold;
            break;
          case 'gte':
            evaluation.matches = value >= rule.condition.threshold;
            break;
          case 'lt':
            evaluation.matches = value < rule.condition.threshold;
            break;
          case 'lte':
            evaluation.matches = value <= rule.condition.threshold;
            break;
          case 'eq':
            evaluation.matches = value === rule.condition.threshold;
            break;
        }
      } else {
        evaluation = this.evaluateCondition(rule.condition, stats);
      }

      const fingerprint = generateFingerprint(rule.id, rule.labels ?? {});
      const existingAlertId = this.fingerprintIndex.get(fingerprint);
      const existingAlert = existingAlertId ? this.alerts.get(existingAlertId) : undefined;

      if (evaluation.matches) {
        // Check cooldown
        if (this.isInCooldown(fingerprint)) {
          continue;
        }

        if (existingAlert && existingAlert.status === 'firing') {
          // Update existing alert
          existingAlert.value = evaluation.value;
          existingAlert.updatedAt = now;
          existingAlert.count = (existingAlert.count ?? 0) + 1;
        } else if (!existingAlert || existingAlert.status === 'resolved') {
          // Create new alert
          const alert = this.createAlert(rule, evaluation.value);
          this.alerts.set(alert.id, alert);
          this.fingerprintIndex.set(fingerprint, alert.id);
          firingAlerts.push(alert);
          this.setCooldown(fingerprint, rule.cooldownSeconds);
        }
      } else {
        // Condition not met
        if (existingAlert && existingAlert.status === 'firing') {
          // Resolve existing alert
          existingAlert.status = 'resolved';
          existingAlert.updatedAt = now;
          existingAlert.resolvedAt = now;
          resolvedAlerts.push(existingAlert);
        }
      }
    }

    // Enforce max alerts limit
    this.enforceMaxAlerts();

    return {
      triggered: firingAlerts.length > 0,
      firingAlerts,
      resolvedAlerts,
      activeCount: this.getActiveAlerts().length,
    };
  }

  /**
   * Enforce maximum alert limit
   */
  private enforceMaxAlerts(): void {
    if (this.alerts.size <= this.config.maxAlerts) return;

    // Remove oldest resolved alerts first
    const resolvedAlerts = Array.from(this.alerts.entries())
      .filter(([, alert]) => alert.status === 'resolved')
      .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());

    for (const [id] of resolvedAlerts) {
      if (this.alerts.size <= this.config.maxAlerts) break;
      const alert = this.alerts.get(id);
      if (alert) {
        this.alerts.delete(id);
        this.fingerprintIndex.delete(alert.fingerprint);
      }
    }

    // If still over limit, remove oldest alerts
    if (this.alerts.size > this.config.maxAlerts) {
      const allAlerts = Array.from(this.alerts.entries())
        .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());

      const toRemove = allAlerts.slice(0, this.alerts.size - this.config.maxAlerts);
      for (const [id, alert] of toRemove) {
        this.alerts.delete(id);
        this.fingerprintIndex.delete(alert.fingerprint);
      }
    }
  }

  /**
   * Get active (firing) alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.status === 'firing')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  /**
   * Get all alerts
   */
  getAlerts(options?: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    ruleId?: string;
    limit?: number;
  }): Alert[] {
    let alerts = Array.from(this.alerts.values());

    if (options?.status) {
      alerts = alerts.filter(a => a.status === options.status);
    }
    if (options?.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }
    if (options?.ruleId) {
      alerts = alerts.filter(a => a.ruleId === options.ruleId);
    }

    alerts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (options?.limit) {
      alerts = alerts.slice(0, options.limit);
    }

    return alerts;
  }

  /**
   * Get a specific alert
   */
  getAlert(id: string): Alert | undefined {
    return this.alerts.get(id);
  }

  /**
   * Manually resolve an alert
   */
  resolveAlert(id: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert || alert.status === 'resolved') {
      return false;
    }

    alert.status = 'resolved';
    alert.updatedAt = new Date().toISOString();
    alert.resolvedAt = alert.updatedAt;
    return true;
  }

  /**
   * Acknowledge an alert (marks it as handled)
   */
  acknowledgeAlert(id: string, _acknowledgedBy?: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert) {
      return false;
    }

    alert.annotations = {
      ...alert.annotations,
      acknowledged: 'true',
      acknowledgedAt: new Date().toISOString(),
    };
    alert.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Clear all alerts
   */
  clear(): void {
    this.alerts.clear();
    this.fingerprintIndex.clear();
    this.cooldownTracker.clear();
  }

  /**
   * Clear resolved alerts
   */
  clearResolved(): number {
    let count = 0;
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.status === 'resolved') {
        this.alerts.delete(id);
        this.fingerprintIndex.delete(alert.fingerprint);
        count++;
      }
    }
    return count;
  }
}

// Extend Alert interface for count tracking
declare module './alert-manager.js' {
  interface Alert {
    count?: number;
  }
}

// -----------------------------------------------------------------------------
// Global Instance
// -----------------------------------------------------------------------------

let globalAlertManager: AlertManager | null = null;

/**
 * Initialize the global alert manager
 */
export function initializeAlertManager(config?: AlertManagerConfig): AlertManager {
  globalAlertManager = new AlertManager(config);
  return globalAlertManager;
}

/**
 * Get the global alert manager
 */
export function getAlertManager(): AlertManager {
  if (!globalAlertManager) {
    globalAlertManager = new AlertManager();
  }
  return globalAlertManager;
}

/**
 * Reset the global alert manager (useful for testing)
 */
export function resetAlertManager(): void {
  if (globalAlertManager) {
    globalAlertManager.clear();
  }
  globalAlertManager = null;
}