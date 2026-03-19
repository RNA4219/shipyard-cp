import { describe, it, expect, beforeEach } from 'vitest';
import {
  LiteLLMFailureHandler,
  type LiteLLMFailureContext,
} from '../src/domain/litellm/litellm-failure-handler.js';
import type { WorkerJob, AuditEventType } from '../src/types.js';

describe('LiteLLMFailureHandler', () => {
  let handler: LiteLLMFailureHandler;
  let auditEvents: Array<{ taskId: string; eventType: AuditEventType; payload: Record<string, unknown> }>;

  const mockContext: LiteLLMFailureContext = {
    emitAuditEvent: (taskId, eventType, payload) => {
      auditEvents.push({ taskId, eventType, payload });
    },
  };

  const mockJob: WorkerJob = {
    job_id: 'job-123',
    task_id: 'task-456',
    typed_ref: 'github:owner:repo:issue:1',
    worker_type: 'codex',
    stage: 'plan',
    repo_ref: {
      owner: 'owner',
      name: 'repo',
      base_sha: 'abc123',
    },
  };

  beforeEach(() => {
    handler = new LiteLLMFailureHandler();
    auditEvents = [];
  });

  describe('handleFailure', () => {
    it('should block on auth_error', () => {
      const result = handler.handleFailure(
        { type: 'auth_error', message: 'Invalid API key', retryable: false },
        'task-456',
        'job-123',
        'gpt-4o',
      );

      expect(result.shouldBlock).toBe(true);
      expect(result.blockedReason).toContain('auth_error');
      expect(result.auditEvent).toBeDefined();
      expect(result.auditEvent?.error_type).toBe('auth_error');
      expect(result.auditEvent?.retryable).toBe(false);
    });

    it('should block on model_not_found', () => {
      const result = handler.handleFailure(
        { type: 'model_not_found', message: 'Model does not exist', retryable: false },
        'task-456',
      );

      expect(result.shouldBlock).toBe(true);
      expect(result.blockedReason).toContain('model_not_found');
    });

    it('should block on content_filter', () => {
      const result = handler.handleFailure(
        { type: 'content_filter', message: 'Content policy violation', retryable: false },
        'task-456',
      );

      expect(result.shouldBlock).toBe(true);
    });

    it('should block on non-retryable internal_error', () => {
      const result = handler.handleFailure(
        { type: 'internal_error', message: 'Fatal error', retryable: false },
        'task-456',
      );

      expect(result.shouldBlock).toBe(true);
    });

    it('should not block on retryable rate_limit', () => {
      const result = handler.handleFailure(
        { type: 'rate_limit', message: 'Rate limit exceeded', retryable: true },
        'task-456',
      );

      expect(result.shouldBlock).toBe(false);
      expect(result.blockedReason).toBeUndefined();
    });

    it('should not block on retryable internal_error', () => {
      const result = handler.handleFailure(
        { type: 'internal_error', message: 'Temporary error', retryable: true },
        'task-456',
      );

      expect(result.shouldBlock).toBe(false);
    });
  });

  describe('createBlockedResult', () => {
    it('should create a blocked WorkerResult', () => {
      const result = handler.createBlockedResult(
        mockJob,
        { type: 'auth_error', message: 'Invalid API key', retryable: false },
        'gpt-4o',
      );

      expect(result.job_id).toBe('job-123');
      expect(result.status).toBe('blocked');
      expect(result.summary).toContain('auth_error');
      expect(result.metadata?.litellm_error_type).toBe('auth_error');
      expect(result.metadata?.litellm_error_message).toBe('Invalid API key');
      expect(result.metadata?.litellm_retryable).toBe(false);
    });

    it('should include artifacts', () => {
      const result = handler.createBlockedResult(
        mockJob,
        { type: 'model_not_found', message: 'Model not found', retryable: false },
      );

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('log');
    });
  });

  describe('emitFailureAuditEvent', () => {
    it('should emit audit event with failure details', () => {
      const result = handler.handleFailure(
        { type: 'auth_error', message: 'Invalid API key', retryable: false },
        'task-456',
        'job-123',
        'gpt-4o',
      );

      handler.emitFailureAuditEvent(mockContext, result);

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].eventType).toBe('run.litellmFailed');
      expect(auditEvents[0].taskId).toBe('task-456');
      expect(auditEvents[0].payload.error_type).toBe('auth_error');
      expect(auditEvents[0].payload.model).toBe('gpt-4o');
      expect(auditEvents[0].payload.blocked).toBe(true);
    });
  });

  describe('getFailureLog', () => {
    it('should track failures', () => {
      handler.handleFailure({ type: 'auth_error', message: 'Error 1', retryable: false }, 'task-1');
      handler.handleFailure({ type: 'rate_limit', message: 'Error 2', retryable: true }, 'task-2');

      const log = handler.getFailureLog();
      expect(log).toHaveLength(2);
      expect(log[0].task_id).toBe('task-1');
      expect(log[1].task_id).toBe('task-2');
    });

    it('should limit log size to 100 entries', () => {
      for (let i = 0; i < 150; i++) {
        handler.handleFailure({ type: 'internal_error', message: `Error ${i}`, retryable: true }, `task-${i}`);
      }

      const log = handler.getFailureLog();
      expect(log).toHaveLength(100);
      // Should keep the most recent entries
      expect(log[0].task_id).toBe('task-50');
      expect(log[99].task_id).toBe('task-149');
    });
  });

  describe('getFailureStats', () => {
    it('should aggregate failure statistics', () => {
      handler.handleFailure({ type: 'auth_error', message: 'E1', retryable: false }, 't1');
      handler.handleFailure({ type: 'auth_error', message: 'E2', retryable: false }, 't2');
      handler.handleFailure({ type: 'rate_limit', message: 'E3', retryable: true }, 't3');
      handler.handleFailure({ type: 'model_not_found', message: 'E4', retryable: false }, 't4');
      handler.handleFailure({ type: 'internal_error', message: 'E5', retryable: true }, 't5');

      const stats = handler.getFailureStats();

      expect(stats.total_failures).toBe(5);
      expect(stats.by_type['auth_error']).toBe(2);
      expect(stats.by_type['rate_limit']).toBe(1);
      expect(stats.by_type['model_not_found']).toBe(1);
      expect(stats.by_type['internal_error']).toBe(1);
      expect(stats.blocking_failures).toBe(3); // auth_error x2, model_not_found x1
      expect(stats.retryable_failures).toBe(2); // rate_limit, internal_error
    });
  });

  describe('clearFailureLog', () => {
    it('should clear the failure log', () => {
      handler.handleFailure({ type: 'auth_error', message: 'E1', retryable: false }, 't1');
      expect(handler.getFailureLog()).toHaveLength(1);

      handler.clearFailureLog();
      expect(handler.getFailureLog()).toHaveLength(0);
    });
  });
});