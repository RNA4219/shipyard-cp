import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ErrorTracker,
  initializeErrorTracker,
  getErrorTracker,
  resetErrorTracker,
  type CapturedError,
  type ErrorStats,
} from '../../src/monitoring/errors/error-tracker.js';

describe('ErrorTracker', () => {
  let tracker: ErrorTracker;

  beforeEach(() => {
    resetErrorTracker();
    tracker = new ErrorTracker();
  });

  afterEach(() => {
    resetErrorTracker();
  });

  describe('constructor', () => {
    it('should create a tracker with default configuration', () => {
      const testTracker = new ErrorTracker();
      expect(testTracker).toBeDefined();
    });

    it('should create a tracker with custom configuration', () => {
      const testTracker = new ErrorTracker({
        maxErrors: 100,
        maxAgeSeconds: 3600,
        captureStackTrace: false,
      });
      expect(testTracker).toBeDefined();
    });
  });

  describe('getErrorFingerprint', () => {
    it('should generate consistent fingerprint for same error', () => {
      const error1 = new Error('Test error message');
      const error2 = new Error('Test error message');

      const fingerprint1 = tracker.getErrorFingerprint(error1);
      const fingerprint2 = tracker.getErrorFingerprint(error2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should generate different fingerprints for different errors', () => {
      const error1 = new Error('First error');
      const error2 = new Error('Second error');

      const fingerprint1 = tracker.getErrorFingerprint(error1);
      const fingerprint2 = tracker.getErrorFingerprint(error2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should normalize UUIDs in error messages', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const error1 = new Error(`Error with UUID ${uuid}`);
      const error2 = new Error('Error with UUID 87654321-4321-4321-4321-cba987654321');

      const fingerprint1 = tracker.getErrorFingerprint(error1);
      const fingerprint2 = tracker.getErrorFingerprint(error2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should include HTTP context in fingerprint', () => {
      const error = new Error('Test error');

      const fingerprint1 = tracker.getErrorFingerprint(error, { method: 'GET', path: '/api/tasks' });
      const fingerprint2 = tracker.getErrorFingerprint(error, { method: 'POST', path: '/api/tasks' });
      const fingerprint3 = tracker.getErrorFingerprint(error, { method: 'GET', path: '/api/jobs' });

      expect(fingerprint1).not.toBe(fingerprint2);
      expect(fingerprint1).not.toBe(fingerprint3);
      expect(fingerprint2).not.toBe(fingerprint3);
    });

    it('should include status code in fingerprint', () => {
      const error = new Error('Test error');

      const fingerprint1 = tracker.getErrorFingerprint(error, { statusCode: 500 });
      const fingerprint2 = tracker.getErrorFingerprint(error, { statusCode: 404 });

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('captureError', () => {
    it('should capture an error and return CapturedError', () => {
      const error = new Error('Test error');
      const captured = tracker.captureError(error);

      expect(captured).toBeDefined();
      expect(captured.id).toBeDefined();
      expect(captured.id).toMatch(/^err_/);
      expect(captured.message).toBe('Test error');
      expect(captured.name).toBe('Error');
      expect(captured.fingerprint).toBeDefined();
      expect(captured.firstSeen).toBeDefined();
      expect(captured.lastSeen).toBeDefined();
      expect(captured.count).toBe(1);
      expect(captured.resolved).toBe(false);
    });

    it('should capture stack trace by default', () => {
      const error = new Error('Test error');
      const captured = tracker.captureError(error);

      expect(captured.stack).toBeDefined();
      expect(captured.stack).toContain('Error: Test error');
    });

    it('should not capture stack trace when disabled', () => {
      const noStackTraceTracker = new ErrorTracker({ captureStackTrace: false });
      const error = new Error('Test error');
      const captured = noStackTraceTracker.captureError(error);

      expect(captured.stack).toBeUndefined();
    });

    it('should capture context information', () => {
      const error = new Error('Test error');
      const captured = tracker.captureError(error, {
        method: 'POST',
        path: '/api/tasks',
        statusCode: 500,
        taskId: 'task-123',
      });

      expect(captured.context.method).toBe('POST');
      expect(captured.context.path).toBe('/api/tasks');
      expect(captured.context.statusCode).toBe(500);
      expect(captured.context.taskId).toBe('task-123');
    });

    it('should increment count for duplicate errors', () => {
      const error = new Error('Test error');

      const captured1 = tracker.captureError(error);
      expect(captured1.count).toBe(1);

      const captured2 = tracker.captureError(error);
      // Same fingerprint means same error record
      expect(captured1.id).toBe(captured2.id);
      // Both references point to the same object, so count is updated
      expect(captured1.count).toBe(2);
      expect(captured2.count).toBe(2);
    });

    it('should categorize errors correctly', () => {
      const validationError = new Error('Invalid input');
      validationError.name = 'ValidationError';
      const captured1 = tracker.captureError(validationError);
      expect(captured1.category).toBe('validation');

      const timeoutError = new Error('Connection timeout');
      timeoutError.name = 'TimeoutError';
      const captured2 = tracker.captureError(timeoutError);
      expect(captured2.category).toBe('timeout');

      const authError = new Error('Unauthorized access');
      authError.name = 'UnauthorizedError';
      const captured3 = tracker.captureError(authError);
      expect(captured3.category).toBe('auth');
    });

    it('should determine severity correctly', () => {
      const criticalError = new Error('Out of memory');
      const captured1 = tracker.captureError(criticalError);
      expect(captured1.severity).toBe('critical');

      const error500 = new Error('Server error');
      const captured2 = tracker.captureError(error500, { statusCode: 500 });
      expect(captured2.severity).toBe('high');

      const error404 = new Error('Not found');
      const captured3 = tracker.captureError(error404, { statusCode: 404 });
      expect(captured3.severity).toBe('medium');
    });
  });

  describe('getErrorStats', () => {
    it('should return empty stats when no errors captured', () => {
      const stats = tracker.getErrorStats();

      expect(stats.total).toBe(0);
      expect(stats.unresolved).toBe(0);
      expect(stats.uniqueCount).toBe(0);
    });

    it('should return correct stats after capturing errors', () => {
      tracker.captureError(new Error('Error 1'));
      tracker.captureError(new Error('Error 2'));
      tracker.captureError(new Error('Error 1')); // Duplicate

      const stats = tracker.getErrorStats();

      expect(stats.total).toBe(2); // 2 unique errors
      expect(stats.unresolved).toBe(2);
      expect(stats.uniqueCount).toBe(2);
    });

    it('should count errors by category', () => {
      const validationError = new Error('Invalid input');
      validationError.name = 'ValidationError';
      tracker.captureError(validationError);

      const authError = new Error('Unauthorized');
      authError.name = 'UnauthorizedError';
      tracker.captureError(authError);

      const stats = tracker.getErrorStats();

      expect(stats.byCategory.validation).toBe(1);
      expect(stats.byCategory.auth).toBe(1);
      expect(stats.byCategory.application).toBe(0);
    });

    it('should count errors by severity', () => {
      tracker.captureError(new Error('Low error'));

      const criticalError = new Error('Out of memory');
      tracker.captureError(criticalError);

      const stats = tracker.getErrorStats();

      expect(stats.bySeverity.low).toBe(1);
      expect(stats.bySeverity.critical).toBe(1);
    });
  });

  describe('getErrors', () => {
    it('should return all errors', () => {
      tracker.captureError(new Error('Error 1'));
      tracker.captureError(new Error('Error 2'));

      const errors = tracker.getErrors();

      expect(errors).toHaveLength(2);
    });

    it('should filter errors by severity', () => {
      tracker.captureError(new Error('Low error'));

      const criticalError = new Error('Out of memory');
      tracker.captureError(criticalError);

      const errors = tracker.getErrors({ severity: 'critical' });

      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('critical');
    });

    it('should filter errors by category', () => {
      const validationError = new Error('Invalid input');
      validationError.name = 'ValidationError';
      tracker.captureError(validationError);

      tracker.captureError(new Error('Application error'));

      const errors = tracker.getErrors({ category: 'validation' });

      expect(errors).toHaveLength(1);
      expect(errors[0].category).toBe('validation');
    });

    it('should limit number of errors returned', () => {
      for (let i = 0; i < 10; i++) {
        tracker.captureError(new Error(`Error ${i}`));
      }

      const errors = tracker.getErrors({ limit: 5 });

      expect(errors).toHaveLength(5);
    });

    it('should filter by unresolved status', () => {
      tracker.captureError(new Error('Error 1'));
      const captured = tracker.captureError(new Error('Error 2'));
      tracker.resolveError(captured.id);

      const unresolved = tracker.getErrors({ unresolved: true });

      expect(unresolved).toHaveLength(1);
    });
  });

  describe('getError', () => {
    it('should return specific error by ID', () => {
      const captured = tracker.captureError(new Error('Test error'));

      const error = tracker.getError(captured.id);

      expect(error).toBeDefined();
      expect(error?.id).toBe(captured.id);
    });

    it('should return undefined for non-existent ID', () => {
      const error = tracker.getError('non-existent-id');

      expect(error).toBeUndefined();
    });
  });

  describe('resolveError', () => {
    it('should mark error as resolved', () => {
      const captured = tracker.captureError(new Error('Test error'));

      const result = tracker.resolveError(captured.id);

      expect(result).toBe(true);
      expect(tracker.getError(captured.id)?.resolved).toBe(true);
    });

    it('should return false for non-existent error', () => {
      const result = tracker.resolveError('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('resolveAllErrors', () => {
    it('should mark all errors as resolved', () => {
      tracker.captureError(new Error('Error 1'));
      tracker.captureError(new Error('Error 2'));
      tracker.captureError(new Error('Error 3'));

      const count = tracker.resolveAllErrors();

      expect(count).toBe(3);

      const stats = tracker.getErrorStats();
      expect(stats.unresolved).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all errors', () => {
      tracker.captureError(new Error('Error 1'));
      tracker.captureError(new Error('Error 2'));

      tracker.clear();

      const stats = tracker.getErrorStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('maxErrors limit', () => {
    it('should enforce maximum error limit', () => {
      const limitedTracker = new ErrorTracker({ maxErrors: 5 });

      for (let i = 0; i < 10; i++) {
        limitedTracker.captureError(new Error(`Error ${i}`));
      }

      const errors = limitedTracker.getErrors();
      expect(errors.length).toBeLessThanOrEqual(5);
    });
  });

  describe('cleanOldErrors', () => {
    it('should clean errors older than maxAgeSeconds', () => {
      const shortAgeTracker = new ErrorTracker({ maxAgeSeconds: 1 });

      shortAgeTracker.captureError(new Error('Error 1'));

      // Wait for error to age out
      return new Promise<void>(resolve => {
        setTimeout(() => {
          const removed = shortAgeTracker.cleanOldErrors();
          expect(removed).toBe(1);

          const stats = shortAgeTracker.getErrorStats();
          expect(stats.total).toBe(0);
          resolve();
        }, 1100);
      });
    }, 2000);
  });
});

describe('Global error tracker functions', () => {
  beforeEach(() => {
    resetErrorTracker();
  });

  afterEach(() => {
    resetErrorTracker();
  });

  describe('initializeErrorTracker', () => {
    it('should initialize and return the global tracker', () => {
      const tracker = initializeErrorTracker({ maxErrors: 100 });
      expect(tracker).toBeDefined();
      expect(tracker).toBeInstanceOf(ErrorTracker);
    });

    it('should return the same tracker after initialization', () => {
      const tracker1 = initializeErrorTracker();
      const tracker2 = getErrorTracker();
      expect(tracker1).toBe(tracker2);
    });
  });

  describe('getErrorTracker', () => {
    it('should return a default tracker if not initialized', () => {
      const tracker = getErrorTracker();
      expect(tracker).toBeDefined();
      expect(tracker).toBeInstanceOf(ErrorTracker);
    });
  });

  describe('resetErrorTracker', () => {
    it('should reset the global tracker', () => {
      const tracker1 = initializeErrorTracker({ maxErrors: 50 });
      tracker1.captureError(new Error('Test'));

      resetErrorTracker();

      const tracker2 = getErrorTracker();
      const stats = tracker2.getErrorStats();
      expect(stats.total).toBe(0);
    });
  });
});