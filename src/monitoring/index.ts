/**
 * Monitoring module exports
 */

// Structured Logger (Phase 1)
export {
  StructuredLogger,
  initializeLogger,
  getLogger,
  resetLogger,
  type LogContext,
  type StructuredLoggerConfig,
} from './logger/structured-logger.js';

// Metrics (Phase 2)
export {
  MetricsCollector,
  initializeMetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
  PrometheusExporter,
  initializePrometheusExporter,
  getPrometheusExporter,
  resetPrometheusExporter,
  type MetricsCollectorConfig,
  type TaskLabels,
  type JobLabels,
  type ResultLabels,
  type DispatchLabels,
  type TaskLabelValues,
  type JobLabelValues,
  type ResultLabelValues,
  type DispatchLabelValues,
  type PrometheusExporterConfig,
} from './metrics/index.js';

// Plugins (Phase 2)
export {
  monitoringPlugin,
  type MonitoringPluginOptions,
} from './plugins/index.js';

// Error Tracking & Alerts (Phase 3)
export {
  ErrorTracker,
  initializeErrorTracker,
  getErrorTracker,
  resetErrorTracker,
  type ErrorSeverity,
  type ErrorCategory,
  type ErrorContext,
  type CapturedError,
  type ErrorStats,
  type ErrorTrackerConfig,
  AlertManager,
  initializeAlertManager,
  getAlertManager,
  resetAlertManager,
  type AlertSeverity,
  type AlertStatus,
  type AlertConditionType,
  type AlertCondition,
  type AlertRule,
  type Alert,
  type AlertEvaluationResult,
  type AlertManagerConfig,
} from './errors/index.js';