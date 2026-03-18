/**
 * Structured Logger for Shipyard Control Plane
 *
 * Wraps Pino logger with:
 * - Automatic context information
 * - Sensitive data masking
 * - Structured logging format
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import type { MonitoringConfig } from '../../config/index.js';

/**
 * Sensitive field patterns for masking
 */
const SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'credential',
  'private_key',
  'privateKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
];

/**
 * Context information to be included in all log entries
 */
export interface LogContext {
  /** Service name */
  service?: string;
  /** Component/module name */
  component?: string;
  /** Request/correlation ID */
  requestId?: string;
  /** Task ID if applicable */
  taskId?: string;
  /** Job ID if applicable */
  jobId?: string;
  /** Worker type if applicable */
  workerType?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Logger configuration
 */
export interface StructuredLoggerConfig {
  /** Monitoring configuration */
  monitoring: MonitoringConfig;
  /** Service name */
  service?: string;
  /** Default context to include in all logs */
  defaultContext?: LogContext;
}

/**
 * Mask sensitive values in an object
 */
function maskSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 10) {
    return '[max depth reached]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitive(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some(
      (field) => lowerKey.includes(field.toLowerCase())
    );

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitive(value, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Structured Logger class
 *
 * Provides a wrapper around Pino with automatic context injection
 * and sensitive data masking.
 */
export class StructuredLogger {
  private logger: Logger;
  private defaultContext: LogContext;

  constructor(config: StructuredLoggerConfig) {
    const { monitoring, service = 'shipyard-cp', defaultContext = {} } = config;

    const pinoOptions: LoggerOptions = {
      level: monitoring.logLevel,
      base: {
        service,
        ...defaultContext,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => ({
          pid: bindings.pid,
          hostname: bindings.hostname,
        }),
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    };

    // Use pino-pretty in development
    const isDevelopment = process.env.NODE_ENV !== 'production';
    if (isDevelopment) {
      this.logger = pino({
        ...pinoOptions,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      });
    } else {
      this.logger = pino(pinoOptions);
    }

    this.defaultContext = defaultContext;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): StructuredLogger {
    const childLogger = new StructuredLogger({
      monitoring: {
        enabled: true,
        logLevel: this.logger.level as MonitoringConfig['logLevel'],
        metricsEnabled: false,
        metricsPath: '/metrics',
      },
      service: this.defaultContext.service,
      defaultContext: {
        ...this.defaultContext,
        ...context,
      },
    });

    return childLogger;
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: LogContext): void;
  debug(context: LogContext, message: string): void;
  debug(arg1: string | LogContext, arg2?: string | LogContext): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.logger.debug(this.buildContext(context), message);
  }

  /**
   * Log at info level
   */
  info(message: string, context?: LogContext): void;
  info(context: LogContext, message: string): void;
  info(arg1: string | LogContext, arg2?: string | LogContext): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.logger.info(this.buildContext(context), message);
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: LogContext): void;
  warn(context: LogContext, message: string): void;
  warn(arg1: string | LogContext, arg2?: string | LogContext): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.logger.warn(this.buildContext(context), message);
  }

  /**
   * Log at error level
   */
  error(message: string, context?: LogContext): void;
  error(error: Error, message?: string, context?: LogContext): void;
  error(arg1: string | Error, arg2?: string | LogContext, arg3?: LogContext): void {
    if (arg1 instanceof Error) {
      const error = arg1;
      const message = typeof arg2 === 'string' ? arg2 : error.message;
      const context = typeof arg2 === 'object' ? arg2 : arg3;
      this.logger.error({ err: error, ...this.buildContext(context) }, message);
    } else {
      const message = arg1;
      const context = typeof arg2 === 'object' ? arg2 : undefined;
      this.logger.error(this.buildContext(context), message);
    }
  }

  /**
   * Log a warning with formatted message
   */
  warnFormatted(template: string, ...args: unknown[]): void {
    const message = this.formatTemplate(template, args);
    this.logger.warn(this.buildContext(), message);
  }

  /**
   * Get the underlying Pino logger for advanced use cases
   */
  getPinoLogger(): Logger {
    return this.logger;
  }

  /**
   * Parse method arguments for flexible calling conventions
   */
  private parseArgs(
    arg1: string | LogContext,
    arg2?: string | LogContext
  ): { message: string; context?: LogContext } {
    if (typeof arg1 === 'string') {
      return { message: arg1, context: arg2 as LogContext | undefined };
    }
    return { message: arg2 as string, context: arg1 };
  }

  /**
   * Build the context object for logging
   */
  private buildContext(additionalContext?: LogContext): Record<string, unknown> {
    const context: Record<string, unknown> = { ...this.defaultContext };

    if (additionalContext) {
      Object.assign(context, maskSensitive(additionalContext));
    }

    return context;
  }

  /**
   * Format a template string with arguments
   */
  private formatTemplate(template: string, args: unknown[]): string {
    return template.replace(/%s|%d|%j/g, () => {
      const arg = args.shift();
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'number') return String(arg);
      return JSON.stringify(arg);
    });
  }
}

/**
 * Create a global logger instance
 */
let globalLogger: StructuredLogger | null = null;

/**
 * Initialize the global logger
 */
export function initializeLogger(config: StructuredLoggerConfig): StructuredLogger {
  globalLogger = new StructuredLogger(config);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): StructuredLogger {
  if (!globalLogger) {
    // Create a default logger if not initialized
    globalLogger = new StructuredLogger({
      monitoring: {
        enabled: true,
        logLevel: 'info',
        metricsEnabled: false,
        metricsPath: '/metrics',
      },
    });
  }
  return globalLogger;
}

/**
 * Reset the global logger (useful for testing)
 */
export function resetLogger(): void {
  globalLogger = null;
}