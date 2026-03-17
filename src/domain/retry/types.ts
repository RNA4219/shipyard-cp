export interface RetryPolicy {
  max_retries: number;
  backoff_base_seconds: number;
  max_backoff_seconds: number;
  jitter_enabled: boolean;
}

export type FailureClass =
  | 'retryable_transient'
  | 'retryable_capacity'
  | 'non_retryable_policy'
  | 'non_retryable_logic';

export interface ShouldRetryParams {
  failure_class: FailureClass;
  retry_count: number;
  max_retries: number;
}

export interface CalculateBackoffParams {
  retry_count: number;
  policy: RetryPolicy;
}

export interface DetermineNextActionParams {
  stage: string;
  failure_class: FailureClass;
  retry_count: number;
  max_retries: number;
}

export interface NextAction {
  action: 'retry' | 'blocked' | 'rework_required' | 'failed';
  reason?: string;
  retry_scheduled_at?: string;
}

export interface ClassifyFailureParams {
  error_code: string;
  error_message: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_retries: 3,
  backoff_base_seconds: 1,
  max_backoff_seconds: 60,
  jitter_enabled: true,
};