/**
 * Error Tracker for Shipyard Control Plane
 *
 * Captures, aggregates, and tracks errors with:
 * - Error fingerprinting for grouping similar errors
 * - Stack trace capture
 * - Context association
 * - Error statistics
 */

import type { LogContext } from '../logger/structured-logger.js';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error category for classification
 */
export type ErrorCategory =
  | 'application'
  | 'infrastructure'
  | 'validation'
  | 'auth'
  | 'external'
  | 'timeout'
  | 'resource'
  | 'unknown';

/**
 * Captured error context
 */
export interface ErrorContext extends LogContext {
  /** Timestamp when error was captured */
  timestamp: string;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Request path if applicable */
  path?: string;
  /** HTTP method if applicable */
  method?: string;
  /** Error category */
  category?: ErrorCategory;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Captured error record
 */
export interface CapturedError {
  /** Unique error ID */
  id: string;
  /** Error fingerprint for grouping */
  fingerprint: string;
  /** Error message */
  message: string;
  /** Error name/type */
  name: string;
  /** Stack trace */
  stack?: string;
  /** Error severity */
  severity: ErrorSeverity;
  /** Error category */
  category: ErrorCategory;
  /** Context information */
  context: ErrorContext;
  /** First occurrence timestamp */
  firstSeen: string;
  /** Last occurrence timestamp */
  lastSeen: string;
  /** Occurrence count */
  count: number;
  /** Whether error has been resolved */
  resolved: boolean;
}

/**
 * Error statistics
 */
export interface ErrorStats {
  /** Total errors captured */
  total: number;
  /** Errors by category */
  byCategory: Record<ErrorCategory, number>;
  /** Errors by severity */
  bySeverity: Record<ErrorSeverity, number>;
  /** Unresolved errors count */
  unresolved: number;
  /** Unique error fingerprints */
  uniqueCount: number;
  /** Error rate per minute (if tracking window is set) */
  errorRatePerMinute?: number;
}

/**
 * Error tracker configuration
 */
export interface ErrorTrackerConfig {
  /** Maximum number of errors to store */
  maxErrors?: number;
  /** Maximum age of errors in seconds */
  maxAgeSeconds?: number;
  /** Whether to capture stack traces */
  captureStackTrace?: boolean;
  /** Stack trace depth limit */
  stackTraceLimit?: number;
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Determine error category from error instance
 */
function categorizeError(error: Error): ErrorCategory {
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  // Check for specific error types
  if (name.includes('validation') || name.includes('schema') || message.includes('invalid')) {
    return 'validation';
  }
  if (name.includes('auth') || name.includes('unauthorized') || name.includes('forbidden')) {
    return 'auth';
  }
  if (name.includes('timeout') || message.includes('timeout')) {
    return 'timeout';
  }
  if (name.includes('network') || name.includes('econnrefused') || name.includes('enotfound')) {
    return 'external';
  }
  if (name.includes('resource') || name.includes('memory') || message.includes('out of memory')) {
    return 'resource';
  }
  if (name.includes('redis') || name.includes('database') || name.includes('connection')) {
    return 'infrastructure';
  }

  return 'application';
}

/**
 * Determine error severity from error instance and context
 */
function determineSeverity(error: Error, context?: ErrorContext): ErrorSeverity {
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  const statusCode = context?.statusCode;

  // Critical errors
  if (
    name.includes('fatal') ||
    message.includes('fatal') ||
    message.includes('out of memory') ||
    message.includes('database connection') ||
    message.includes('redis connection')
  ) {
    return 'critical';
  }

  // High severity
  if (
    statusCode !== undefined && statusCode >= 500 ||
    name.includes('timeout') ||
    message.includes('timeout')
  ) {
    return 'high';
  }

  // Medium severity
  if (
    (statusCode !== undefined && statusCode >= 400) ||
    name.includes('validation') ||
    name.includes('unauthorized') ||
    name.includes('forbidden')
  ) {
    return 'medium';
  }

  return 'low';
}

/**
 * Error Tracker class
 *
 * Manages error capture, fingerprinting, and aggregation.
 */
export class ErrorTracker {
  private readonly config: Required<ErrorTrackerConfig>;
  private readonly errors: Map<string, CapturedError> = new Map();
  private readonly fingerprintIndex: Map<string, string> = new Map();
  private errorTimes: number[] = [];

  constructor(config: ErrorTrackerConfig = {}) {
    this.config = {
      maxErrors: config.maxErrors ?? 1000,
      maxAgeSeconds: config.maxAgeSeconds ?? 86400, // 24 hours
      captureStackTrace: config.captureStackTrace ?? true,
      stackTraceLimit: config.stackTraceLimit ?? 10,
    };
  }

  /**
   * Generate a fingerprint for an error
   * Used to group similar errors together
   */
  getErrorFingerprint(error: Error, context?: ErrorContext): string {
    const parts: string[] = [];

    // Use error name and message pattern
    parts.push(error.name);

    // Normalize message to remove variable parts
    const normalizedMessage = error.message
      // Remove UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      // Remove file paths
      .replace(/\/[\w\-./]+/g, '<path>')
      // Remove Windows paths
      .replace(/[A-Za-z]:\\[\w\-\\]+/g, '<path>')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '<url>')
      // Remove task/job IDs
      .replace(/task-[a-zA-Z0-9]+/g, '<task-id>')
      .replace(/job-[a-zA-Z0-9]+/g, '<job-id>');

    parts.push(normalizedMessage);

    // Include HTTP context if available
    if (context?.path && context?.method) {
      parts.push(`${context.method}:${context.path}`);
    }

    // Include status code if available
    if (context?.statusCode) {
      parts.push(String(context.statusCode));
    }

    // Create hash
    const fingerprint = parts.join('|');
    return this.simpleHash(fingerprint);
  }

  /**
   * Simple hash function for fingerprint generation
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Capture an error with optional context
   */
  captureError(error: Error, context?: Partial<ErrorContext>): CapturedError {
    const now = new Date().toISOString();

    // Build full context
    const fullContext: ErrorContext = {
      timestamp: now,
      category: context?.category ?? categorizeError(error),
      ...context,
    };

    // Generate fingerprint
    const fingerprint = this.getErrorFingerprint(error, fullContext);

    // Check for existing error with same fingerprint
    const existingId = this.fingerprintIndex.get(fingerprint);
    if (existingId) {
      const existing = this.errors.get(existingId);
      if (existing) {
        existing.lastSeen = now;
        existing.count++;
        existing.context = fullContext;
        this.errorTimes.push(Date.now());
        this.cleanOldErrorTimes();
        return existing;
      }
    }

    // Create new captured error
    const capturedError: CapturedError = {
      id: generateId(),
      fingerprint,
      message: error.message,
      name: error.name,
      stack: this.config.captureStackTrace
        ? this.formatStackTrace(error.stack)
        : undefined,
      severity: determineSeverity(error, fullContext),
      category: fullContext.category ?? categorizeError(error),
      context: fullContext,
      firstSeen: now,
      lastSeen: now,
      count: 1,
      resolved: false,
    };

    // Store error
    this.errors.set(capturedError.id, capturedError);
    this.fingerprintIndex.set(fingerprint, capturedError.id);
    this.errorTimes.push(Date.now());
    this.cleanOldErrorTimes();

    // Enforce max errors limit
    this.enforceMaxErrors();

    return capturedError;
  }

  /**
   * Format stack trace with depth limit
   */
  private formatStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;

    const lines = stack.split('\n');
    const formatted = lines.slice(0, this.config.stackTraceLimit);
    return formatted.join('\n');
  }

  /**
   * Clean old error timestamps for rate calculation
   */
  private cleanOldErrorTimes(): void {
    const cutoff = Date.now() - 60000; // 1 minute window
    this.errorTimes = this.errorTimes.filter(t => t > cutoff);
  }

  /**
   * Enforce maximum error limit by removing oldest errors
   */
  private enforceMaxErrors(): void {
    if (this.errors.size <= this.config.maxErrors) return;

    // Sort by lastSeen and remove oldest
    const entries = Array.from(this.errors.entries())
      .sort((a, b) => new Date(a[1].lastSeen).getTime() - new Date(b[1].lastSeen).getTime());

    const toRemove = entries.slice(0, this.errors.size - this.config.maxErrors);
    for (const [id, error] of toRemove) {
      this.errors.delete(id);
      this.fingerprintIndex.delete(error.fingerprint);
    }
  }

  /**
   * Clean errors older than maxAgeSeconds
   */
  cleanOldErrors(): number {
    const cutoff = new Date(Date.now() - this.config.maxAgeSeconds * 1000).toISOString();
    let removed = 0;

    for (const [id, error] of this.errors.entries()) {
      if (error.lastSeen < cutoff) {
        this.errors.delete(id);
        this.fingerprintIndex.delete(error.fingerprint);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get error statistics
   */
  getErrorStats(): ErrorStats {
    const stats: ErrorStats = {
      total: this.errors.size,
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
      uniqueCount: this.errors.size,
    };

    for (const error of this.errors.values()) {
      stats.byCategory[error.category]++;
      stats.bySeverity[error.severity]++;
      if (!error.resolved) {
        stats.unresolved++;
      }
    }

    // Calculate error rate
    this.cleanOldErrorTimes();
    stats.errorRatePerMinute = this.errorTimes.length;

    return stats;
  }

  /**
   * Get all captured errors
   */
  getErrors(options?: {
    limit?: number;
    severity?: ErrorSeverity;
    category?: ErrorCategory;
    unresolved?: boolean;
  }): CapturedError[] {
    let errors = Array.from(this.errors.values());

    // Filter by options
    if (options?.severity) {
      errors = errors.filter(e => e.severity === options.severity);
    }
    if (options?.category) {
      errors = errors.filter(e => e.category === options.category);
    }
    if (options?.unresolved !== undefined) {
      errors = errors.filter(e => e.resolved !== options.unresolved);
    }

    // Sort by lastSeen descending
    errors.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    // Apply limit
    if (options?.limit) {
      errors = errors.slice(0, options.limit);
    }

    return errors;
  }

  /**
   * Get a specific error by ID
   */
  getError(id: string): CapturedError | undefined {
    return this.errors.get(id);
  }

  /**
   * Get errors by fingerprint
   */
  getErrorsByFingerprint(fingerprint: string): CapturedError[] {
    const id = this.fingerprintIndex.get(fingerprint);
    if (!id) return [];

    const error = this.errors.get(id);
    return error ? [error] : [];
  }

  /**
   * Mark an error as resolved
   */
  resolveError(id: string): boolean {
    const error = this.errors.get(id);
    if (!error) return false;

    error.resolved = true;
    return true;
  }

  /**
   * Mark all errors as resolved
   */
  resolveAllErrors(): number {
    let count = 0;
    for (const error of this.errors.values()) {
      if (!error.resolved) {
        error.resolved = true;
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors.clear();
    this.fingerprintIndex.clear();
    this.errorTimes = [];
  }
}

// -----------------------------------------------------------------------------
// Global Instance
// -----------------------------------------------------------------------------

let globalTracker: ErrorTracker | null = null;

/**
 * Initialize the global error tracker
 */
export function initializeErrorTracker(config?: ErrorTrackerConfig): ErrorTracker {
  globalTracker = new ErrorTracker(config);
  return globalTracker;
}

/**
 * Get the global error tracker
 */
export function getErrorTracker(): ErrorTracker {
  if (!globalTracker) {
    globalTracker = new ErrorTracker();
  }
  return globalTracker;
}

/**
 * Reset the global error tracker (useful for testing)
 */
export function resetErrorTracker(): void {
  if (globalTracker) {
    globalTracker.clear();
  }
  globalTracker = null;
}