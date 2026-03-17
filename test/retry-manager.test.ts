import { describe, it, expect, beforeEach } from 'vitest';
import { RetryPolicy, RetryManager } from '../src/domain/retry/index.js';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  const defaultPolicy: RetryPolicy = {
    max_retries: 3,
    backoff_base_seconds: 1,
    max_backoff_seconds: 60,
    jitter_enabled: true,
  };

  beforeEach(() => {
    retryManager = new RetryManager();
  });

  describe('shouldRetry', () => {
    it('should allow retry for retryable_transient', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'retryable_transient',
        retry_count: 0,
        max_retries: 3,
      });

      expect(result).toBe(true);
    });

    it('should allow retry for retryable_capacity', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'retryable_capacity',
        retry_count: 0,
        max_retries: 3,
      });

      expect(result).toBe(true);
    });

    it('should not allow retry for non_retryable_policy', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'non_retryable_policy',
        retry_count: 0,
        max_retries: 3,
      });

      expect(result).toBe(false);
    });

    it('should not allow retry for non_retryable_logic', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'non_retryable_logic',
        retry_count: 0,
        max_retries: 3,
      });

      expect(result).toBe(false);
    });

    it('should not allow retry when max_retries reached', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'retryable_transient',
        retry_count: 3,
        max_retries: 3,
      });

      expect(result).toBe(false);
    });

    it('should allow retry when retry_count < max_retries', () => {
      const result = retryManager.shouldRetry({
        failure_class: 'retryable_transient',
        retry_count: 2,
        max_retries: 3,
      });

      expect(result).toBe(true);
    });
  });

  describe('calculateBackoff', () => {
    it('should return exponential backoff', () => {
      const policy: RetryPolicy = {
        max_retries: 3,
        backoff_base_seconds: 2,
        max_backoff_seconds: 60,
        jitter_enabled: false,
      };

      const backoff0 = retryManager.calculateBackoff(0, policy);
      const backoff1 = retryManager.calculateBackoff(1, policy);
      const backoff2 = retryManager.calculateBackoff(2, policy);

      expect(backoff0).toBe(2);  // 2^1
      expect(backoff1).toBe(4);  // 2^2
      expect(backoff2).toBe(8);  // 2^3
    });

    it('should cap at max_backoff_seconds', () => {
      const policy: RetryPolicy = {
        max_retries: 10,
        backoff_base_seconds: 2,
        max_backoff_seconds: 10,
        jitter_enabled: false,
      };

      const backoff = retryManager.calculateBackoff(5, policy);

      expect(backoff).toBe(10);
    });

    it('should add jitter when enabled', () => {
      const policy: RetryPolicy = {
        max_retries: 3,
        backoff_base_seconds: 2,
        max_backoff_seconds: 60,
        jitter_enabled: true,
      };

      // Run multiple times to check jitter is applied
      const backoffs = new Set<number>();
      for (let i = 0; i < 10; i++) {
        const backoff = retryManager.calculateBackoff(0, policy);
        backoffs.add(backoff);
      }

      // With jitter, we should see different values
      expect(backoffs.size).toBeGreaterThan(1);
    });
  });

  describe('determineNextAction', () => {
    it('should return retry for retryable failure under limit', () => {
      const action = retryManager.determineNextAction({
        stage: 'plan',
        failure_class: 'retryable_transient',
        retry_count: 0,
        max_retries: 3,
      });

      expect(action).toEqual({ action: 'retry', retry_scheduled_at: expect.any(String) });
    });

    it('should return blocked for plan/dev/acceptance at limit', () => {
      const action = retryManager.determineNextAction({
        stage: 'dev',
        failure_class: 'retryable_transient',
        retry_count: 3,
        max_retries: 3,
      });

      expect(action).toEqual({ action: 'blocked', reason: 'max_retries_reached' });
    });

    it('should return rework_required for acceptance at limit', () => {
      const action = retryManager.determineNextAction({
        stage: 'acceptance',
        failure_class: 'non_retryable_logic',
        retry_count: 0,
        max_retries: 1,
      });

      expect(action).toEqual({ action: 'rework_required', reason: 'non_retryable_failure' });
    });

    it('should return failed for integrate at limit', () => {
      const action = retryManager.determineNextAction({
        stage: 'integrate',
        failure_class: 'retryable_transient',
        retry_count: 2,
        max_retries: 2,
      });

      expect(action).toEqual({ action: 'blocked', reason: 'max_retries_reached' });
    });

    it('should return blocked for publish at limit', () => {
      const action = retryManager.determineNextAction({
        stage: 'publish',
        failure_class: 'retryable_capacity',
        retry_count: 1,
        max_retries: 1,
      });

      expect(action).toEqual({ action: 'blocked', reason: 'max_retries_reached' });
    });
  });

  describe('getDefaultMaxRetries', () => {
    it('should return 2 for plan stage', () => {
      expect(retryManager.getDefaultMaxRetries('plan')).toBe(2);
    });

    it('should return 3 for dev stage', () => {
      expect(retryManager.getDefaultMaxRetries('dev')).toBe(3);
    });

    it('should return 1 for acceptance stage', () => {
      expect(retryManager.getDefaultMaxRetries('acceptance')).toBe(1);
    });

    it('should return 2 for integrate stage', () => {
      expect(retryManager.getDefaultMaxRetries('integrate')).toBe(2);
    });

    it('should return 1 for publish stage', () => {
      expect(retryManager.getDefaultMaxRetries('publish')).toBe(1);
    });
  });

  describe('classifyFailure', () => {
    it('should classify timeout as retryable_capacity', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'TIMEOUT',
        error_message: 'Request timed out',
      });

      expect(failureClass).toBe('retryable_capacity');
    });

    it('should classify rate_limit as retryable_capacity', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'RATE_LIMIT',
        error_message: 'Too many requests',
      });

      expect(failureClass).toBe('retryable_capacity');
    });

    it('should classify network_error as retryable_transient', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'NETWORK_ERROR',
        error_message: 'Connection refused',
      });

      expect(failureClass).toBe('retryable_transient');
    });

    it('should classify permission_denied as non_retryable_policy', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'PERMISSION_DENIED',
        error_message: 'Insufficient permissions',
      });

      expect(failureClass).toBe('non_retryable_policy');
    });

    it('should classify validation_error as non_retryable_logic', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'VALIDATION_ERROR',
        error_message: 'Invalid input',
      });

      expect(failureClass).toBe('non_retryable_logic');
    });

    it('should classify unknown as retryable_transient by default', () => {
      const failureClass = retryManager.classifyFailure({
        error_code: 'UNKNOWN',
        error_message: 'Unknown error',
      });

      expect(failureClass).toBe('retryable_transient');
    });
  });
});