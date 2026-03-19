/**
 * LiteLLM Failure Handler
 *
 * Handles LiteLLM service failures by transitioning tasks to blocked state
 * with appropriate audit logging.
 */

import type { WorkerResult, WorkerJob, AuditEventType } from '../../types.js';
import type { LiteLLMError, LiteLLMUsage } from '../litellm/index.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger();

/**
 * Context for LiteLLM failure handling
 */
export interface LiteLLMFailureContext {
  emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options?: { jobId?: string },
  ): void;
}

/**
 * Result of handling a LiteLLM failure
 */
export interface LiteLLMFailureResult {
  shouldBlock: boolean;
  blockedReason?: string;
  auditEvent?: {
    task_id: string;
    job_id?: string;
    error_type: string;
    error_message: string;
    retryable: boolean;
    model?: string;
  };
}

/**
 * Non-retryable LiteLLM error types that should block the task
 */
const BLOCKING_ERROR_TYPES: Set<LiteLLMError['type']> = new Set([
  'auth_error',
  'model_not_found',
  'content_filter',
]);

/**
 * Service for handling LiteLLM failures.
 * Determines when to block tasks and emit audit events.
 */
export class LiteLLMFailureHandler {
  private failureLog: Array<{
    task_id: string;
    job_id?: string;
    error: LiteLLMError;
    timestamp: string;
  }> = [];

  /**
   * Handle a LiteLLM error and determine if task should be blocked.
   */
  handleFailure(
    error: LiteLLMError,
    taskId: string,
    jobId?: string,
    model?: string,
  ): LiteLLMFailureResult {
    // Log the failure
    const failureEntry = {
      task_id: taskId,
      job_id: jobId,
      error,
      timestamp: new Date().toISOString(),
    };
    this.failureLog.push(failureEntry);

    // Keep only last 100 failures
    if (this.failureLog.length > 100) {
      this.failureLog = this.failureLog.slice(-100);
    }

    logger.warn('LiteLLM failure occurred', {
      taskId,
      jobId,
      errorType: error.type,
      errorMessage: error.message,
      retryable: error.retryable,
    });

    // Determine if we should block
    const shouldBlock = BLOCKING_ERROR_TYPES.has(error.type) || !error.retryable;

    return {
      shouldBlock,
      blockedReason: shouldBlock ? `LiteLLM error: ${error.type} - ${error.message}` : undefined,
      auditEvent: {
        task_id: taskId,
        job_id: jobId,
        error_type: error.type,
        error_message: error.message,
        retryable: error.retryable,
        model,
      },
    };
  }

  /**
   * Create a blocked worker result from a LiteLLM failure.
   */
  createBlockedResult(
    job: WorkerJob,
    error: LiteLLMError,
    model?: string,
  ): WorkerResult {
    const failureResult = this.handleFailure(error, job.task_id, job.job_id, model);

    return {
      job_id: job.job_id,
      typed_ref: job.typed_ref,
      status: 'blocked',
      summary: failureResult.blockedReason ?? `LiteLLM error: ${error.type}`,
      artifacts: [
        {
          artifact_id: `${job.job_id}-litellm-error`,
          kind: 'log',
          uri: `log://litellm/${job.job_id}/error`,
        },
      ],
      test_results: [],
      requested_escalations: [],
      usage: {
        runtime_ms: 0,
        litellm: {
          model,
          provider: 'unknown',
        },
      },
      metadata: {
        litellm_error_type: error.type,
        litellm_error_message: error.message,
        litellm_retryable: error.retryable,
      },
    };
  }

  /**
   * Emit audit event for LiteLLM failure.
   */
  emitFailureAuditEvent(
    ctx: LiteLLMFailureContext,
    result: LiteLLMFailureResult,
  ): void {
    if (result.auditEvent) {
      ctx.emitAuditEvent(
        result.auditEvent.task_id,
        'run.litellmFailed',
        {
          error_type: result.auditEvent.error_type,
          error_message: result.auditEvent.error_message,
          retryable: result.auditEvent.retryable,
          model: result.auditEvent.model,
          blocked: result.shouldBlock,
        },
        result.auditEvent.job_id ? { jobId: result.auditEvent.job_id } : undefined,
      );
    }
  }

  /**
   * Get failure log for analysis.
   */
  getFailureLog(): Array<{
    task_id: string;
    job_id?: string;
    error: LiteLLMError;
    timestamp: string;
  }> {
    return [...this.failureLog];
  }

  /**
   * Clear failure log.
   */
  clearFailureLog(): void {
    this.failureLog = [];
  }

  /**
   * Get failure statistics.
   */
  getFailureStats(): {
    total_failures: number;
    by_type: Record<string, number>;
    blocking_failures: number;
    retryable_failures: number;
  } {
    const stats = {
      total_failures: this.failureLog.length,
      by_type: {} as Record<string, number>,
      blocking_failures: 0,
      retryable_failures: 0,
    };

    for (const entry of this.failureLog) {
      const type = entry.error.type;
      stats.by_type[type] = (stats.by_type[type] || 0) + 1;

      if (BLOCKING_ERROR_TYPES.has(type)) {
        stats.blocking_failures++;
      }
      if (entry.error.retryable) {
        stats.retryable_failures++;
      }
    }

    return stats;
  }
}

/**
 * Default failure handler instance.
 */
export const defaultLiteLLMFailureHandler = new LiteLLMFailureHandler();