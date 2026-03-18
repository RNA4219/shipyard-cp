import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  StructuredLogger,
  initializeLogger,
  getLogger,
  resetLogger,
  type LogContext,
} from '../../src/monitoring/index.js';
import type { MonitoringConfig } from '../../src/config/index.js';

describe('StructuredLogger', () => {
  let logger: StructuredLogger;
  const defaultMonitoringConfig: MonitoringConfig = {
    enabled: true,
    logLevel: 'debug',
    metricsEnabled: true,
    metricsPath: '/metrics',
  };

  beforeEach(() => {
    resetLogger();
    logger = new StructuredLogger({
      monitoring: defaultMonitoringConfig,
      service: 'test-service',
    });
  });

  afterEach(() => {
    resetLogger();
  });

  describe('constructor', () => {
    it('should create a logger with default configuration', () => {
      const testLogger = new StructuredLogger({
        monitoring: defaultMonitoringConfig,
      });

      expect(testLogger).toBeDefined();
    });

    it('should create a logger with custom service name', () => {
      const testLogger = new StructuredLogger({
        monitoring: defaultMonitoringConfig,
        service: 'custom-service',
      });

      expect(testLogger).toBeDefined();
    });

    it('should accept default context', () => {
      const testLogger = new StructuredLogger({
        monitoring: defaultMonitoringConfig,
        service: 'test-service',
        defaultContext: {
          component: 'TestComponent',
          requestId: 'req-123',
        },
      });

      expect(testLogger).toBeDefined();
    });
  });

  describe('log levels', () => {
    it('should log at debug level without throwing', () => {
      expect(() => {
        logger.debug('Debug message');
      }).not.toThrow();
    });

    it('should log at info level without throwing', () => {
      expect(() => {
        logger.info('Info message');
      }).not.toThrow();
    });

    it('should log at warn level without throwing', () => {
      expect(() => {
        logger.warn('Warn message');
      }).not.toThrow();
    });

    it('should log at error level without throwing', () => {
      expect(() => {
        logger.error('Error message');
      }).not.toThrow();
    });

    it('should log error with Error object', () => {
      const error = new Error('Test error');

      expect(() => {
        logger.error(error, 'An error occurred');
      }).not.toThrow();
    });

    it('should log error with just Error object', () => {
      const error = new Error('Test error');

      expect(() => {
        logger.error(error);
      }).not.toThrow();
    });
  });

  describe('context handling', () => {
    it('should accept context as first argument', () => {
      const context: LogContext = {
        component: 'TestComponent',
        taskId: 'task-123',
      };

      expect(() => {
        logger.info(context, 'Message with context');
      }).not.toThrow();
    });

    it('should accept context as second argument', () => {
      const context: LogContext = {
        jobId: 'job-456',
        workerType: 'claude_code',
      };

      expect(() => {
        logger.info('Message', context);
      }).not.toThrow();
    });

    it('should handle empty context', () => {
      expect(() => {
        logger.info('Message without context');
      }).not.toThrow();
    });
  });

  describe('child logger', () => {
    it('should create a child logger with additional context', () => {
      const childLogger = logger.child({
        component: 'ChildComponent',
        requestId: 'req-789',
      });

      expect(childLogger).toBeDefined();
      expect(childLogger).toBeInstanceOf(StructuredLogger);
    });

    it('should log with child logger without throwing', () => {
      const childLogger = logger.child({
        component: 'ChildComponent',
      });

      expect(() => {
        childLogger.info('Child logger message');
      }).not.toThrow();
    });
  });

  describe('sensitive data masking', () => {
    it('should mask password fields', () => {
      const context: LogContext = {
        username: 'testuser',
        password: 'secret123',
      };

      // Create a spy on the underlying logger
      const pinoLogger = logger.getPinoLogger();
      const infoSpy = vi.spyOn(pinoLogger, 'info');

      logger.info(context, 'Login attempt');

      // Check that password was masked
      const loggedContext = infoSpy.mock.calls[0]?.[0];
      expect(loggedContext?.password).toBe('[REDACTED]');
      expect(loggedContext?.username).toBe('testuser');
    });

    it('should mask apiKey fields', () => {
      const context: LogContext = {
        apiKey: 'sk-12345',
        userId: 'user-1',
      };

      const pinoLogger = logger.getPinoLogger();
      const infoSpy = vi.spyOn(pinoLogger, 'info');

      logger.info(context, 'API call');

      const loggedContext = infoSpy.mock.calls[0]?.[0];
      expect(loggedContext?.apiKey).toBe('[REDACTED]');
      expect(loggedContext?.userId).toBe('user-1');
    });

    it('should mask token fields', () => {
      const context: LogContext = {
        accessToken: 'token-xyz',
        refreshToken: 'refresh-abc',
      };

      const pinoLogger = logger.getPinoLogger();
      const infoSpy = vi.spyOn(pinoLogger, 'info');

      logger.info(context, 'Token info');

      const loggedContext = infoSpy.mock.calls[0]?.[0];
      expect(loggedContext?.accessToken).toBe('[REDACTED]');
      expect(loggedContext?.refreshToken).toBe('[REDACTED]');
    });

    it('should mask nested sensitive fields', () => {
      const context: LogContext = {
        user: {
          name: 'John',
          settings: {
            password: 'nested-secret',
          },
        },
      };

      const pinoLogger = logger.getPinoLogger();
      const infoSpy = vi.spyOn(pinoLogger, 'info');

      logger.info(context, 'User data');

      const loggedContext = infoSpy.mock.calls[0]?.[0];
      // The user object is in the logged context
      const user = loggedContext?.user as Record<string, unknown> | undefined;
      expect(user?.name).toBe('John');
      // Check nested settings - password should be masked
      const settings = user?.settings as Record<string, unknown> | undefined;
      expect(settings?.password).toBe('[REDACTED]');
    });

    it('should mask secret in field name', () => {
      const context: LogContext = {
        client_secret: 'my-secret-value',
      };

      const pinoLogger = logger.getPinoLogger();
      const infoSpy = vi.spyOn(pinoLogger, 'info');

      logger.info(context, 'OAuth flow');

      const loggedContext = infoSpy.mock.calls[0]?.[0];
      expect(loggedContext?.client_secret).toBe('[REDACTED]');
    });
  });

  describe('warnFormatted', () => {
    it('should format warning with string argument', () => {
      expect(() => {
        logger.warnFormatted('Hello %s', 'World');
      }).not.toThrow();
    });

    it('should format warning with number argument', () => {
      expect(() => {
        logger.warnFormatted('Count: %d', 42);
      }).not.toThrow();
    });

    it('should format warning with multiple arguments', () => {
      expect(() => {
        logger.warnFormatted('User %s has %d items', 'Alice', 5);
      }).not.toThrow();
    });
  });

  describe('getPinoLogger', () => {
    it('should return the underlying Pino logger', () => {
      const pinoLogger = logger.getPinoLogger();

      expect(pinoLogger).toBeDefined();
      expect(typeof pinoLogger.info).toBe('function');
      expect(typeof pinoLogger.error).toBe('function');
      expect(typeof pinoLogger.warn).toBe('function');
      expect(typeof pinoLogger.debug).toBe('function');
    });
  });
});

describe('Global logger functions', () => {
  beforeEach(() => {
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
  });

  describe('initializeLogger', () => {
    it('should initialize and return the global logger', () => {
      const logger = initializeLogger({
        monitoring: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        service: 'global-test',
      });

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(StructuredLogger);
    });

    it('should return the same logger instance after initialization', () => {
      const logger1 = initializeLogger({
        monitoring: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
      });

      const logger2 = getLogger();

      expect(logger1).toBe(logger2);
    });
  });

  describe('getLogger', () => {
    it('should return a default logger if not initialized', () => {
      const logger = getLogger();

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(StructuredLogger);
    });

    it('should return the initialized logger', () => {
      initializeLogger({
        monitoring: {
          enabled: true,
          logLevel: 'debug',
          metricsEnabled: false,
          metricsPath: '/metrics',
        },
        service: 'initialized-service',
      });

      const logger = getLogger();

      expect(logger).toBeDefined();
    });
  });

  describe('resetLogger', () => {
    it('should reset the global logger', () => {
      initializeLogger({
        monitoring: {
          enabled: true,
          logLevel: 'info',
          metricsEnabled: true,
          metricsPath: '/metrics',
        },
        service: 'before-reset',
      });

      resetLogger();

      // getLogger should return a new default logger
      const logger = getLogger();
      expect(logger).toBeDefined();
    });
  });
});

describe('LogContext interface', () => {
  it('should accept standard context fields', () => {
    const context: LogContext = {
      service: 'test-service',
      component: 'TestComponent',
      requestId: 'req-123',
      taskId: 'task-456',
      jobId: 'job-789',
      workerType: 'claude_code',
    };

    expect(context).toBeDefined();
  });

  it('should accept additional metadata', () => {
    const context: LogContext = {
      component: 'TestComponent',
      customField: 'custom-value',
      count: 42,
      nested: {
        field: 'value',
      },
    };

    expect(context).toBeDefined();
  });
});