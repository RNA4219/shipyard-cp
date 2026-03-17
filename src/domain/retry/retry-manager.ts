import type {
  RetryPolicy,
  FailureClass,
  ShouldRetryParams,
  DetermineNextActionParams,
  NextAction,
  ClassifyFailureParams,
} from './types.js';
import { DEFAULT_RETRY_POLICY, FAILURE_CODES } from './types.js';
import type { WorkerResult } from '../../types.js';

export class RetryManager {
  private readonly defaultMaxRetriesByStage: Record<string, number> = {
    plan: 2,
    dev: 3,
    acceptance: 1,
    integrate: 2,
    publish: 1,
  };

  shouldRetry(params: ShouldRetryParams): boolean {
    const { failure_class, retry_count, max_retries } = params;

    // Non-retryable failures never retry
    if (failure_class === 'non_retryable_policy' || failure_class === 'non_retryable_logic') {
      return false;
    }

    // Check retry limit
    if (retry_count >= max_retries) {
      return false;
    }

    return true;
  }

  calculateBackoff(retryCount: number, policy: RetryPolicy): number {
    // Exponential backoff: base^(retry_count + 1)
    const baseBackoff = Math.pow(policy.backoff_base_seconds, retryCount + 1);

    // Cap at max_backoff_seconds
    let backoff = Math.min(baseBackoff, policy.max_backoff_seconds);

    // Add jitter if enabled (random value between 0 and backoff)
    if (policy.jitter_enabled) {
      backoff = Math.random() * backoff;
    }

    return backoff;
  }

  determineNextAction(params: DetermineNextActionParams): NextAction {
    const { stage, failure_class, retry_count, max_retries } = params;

    // Check if retryable
    if (this.shouldRetry({ failure_class, retry_count, max_retries })) {
      const backoffSeconds = this.calculateBackoff(retry_count, DEFAULT_RETRY_POLICY);
      const scheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
      return {
        action: 'retry',
        retry_scheduled_at: scheduledAt,
      };
    }

    // Max retries reached or non-retryable
    if (retry_count >= max_retries) {
      return {
        action: 'blocked',
        reason: 'max_retries_reached',
      };
    }

    // Non-retryable failure in acceptance stage requires rework
    if (stage === 'acceptance') {
      return {
        action: 'rework_required',
        reason: 'non_retryable_failure',
      };
    }

    return {
      action: 'blocked',
      reason: 'max_retries_reached',
    };
  }

  getDefaultMaxRetries(stage: string): number {
    return this.defaultMaxRetriesByStage[stage] ?? 2;
  }

  /**
   * Classify failure from error code and message.
   */
  classifyFailure(params: ClassifyFailureParams): FailureClass {
    const { error_code } = params;
    const code = error_code.toLowerCase();

    if (FAILURE_CODES.TRANSIENT.some(c => code.includes(c))) {
      return 'retryable_transient';
    }
    if (FAILURE_CODES.CAPACITY.some(c => code.includes(c))) {
      return 'retryable_capacity';
    }
    if (FAILURE_CODES.POLICY.some(c => code.includes(c))) {
      return 'non_retryable_policy';
    }
    if (FAILURE_CODES.LOGIC.some(c => code.includes(c))) {
      return 'non_retryable_logic';
    }

    return 'retryable_transient';
  }

  /**
   * Classify failure from WorkerResult.
   * Uses failure_code if present, otherwise infers from summary.
   */
  classifyFromResult(result: WorkerResult): FailureClass {
    // Use explicit failure_code if provided
    if (result.failure_code) {
      return this.classifyFailure({
        error_code: result.failure_code,
        error_message: result.summary ?? '',
      });
    }

    // Infer from summary text
    const summary = result.summary?.toLowerCase() ?? '';

    if (FAILURE_CODES.TRANSIENT.some(c => summary.includes(c))) {
      return 'retryable_transient';
    }
    if (FAILURE_CODES.CAPACITY.some(c => summary.includes(c))) {
      return 'retryable_capacity';
    }
    if (FAILURE_CODES.POLICY.some(c => summary.includes(c))) {
      return 'non_retryable_policy';
    }
    if (FAILURE_CODES.LOGIC.some(c => summary.includes(c))) {
      return 'non_retryable_logic';
    }

    // Default to retryable_transient (conservative - retry rather than fail permanently)
    return 'retryable_transient';
  }
}