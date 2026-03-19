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

// Failure code constants for consistent classification
export const FAILURE_CODES = {
  // Capacity (rate limiting, timeouts)
  CAPACITY: ['rate_limit', 'timeout', 'quota_exceeded', 'capacity_exceeded', 'too_many_requests'],
  // Transient (network/infrastructure)
  TRANSIENT: ['network_error', 'connection_error', 'connection_refused', 'dns_failure', 'service_unavailable'],
  // Policy (authorization violations)
  POLICY: ['policy_violation', 'unauthorized', 'forbidden', 'sandbox_violation', 'permission_denied', 'authorization_error'],
  // Logic (application errors)
  LOGIC: ['invalid_input', 'parse_error', 'logic_error', 'assertion_failed', 'validation_error'],
} as const;

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

export interface DetermineNextActionWithFailoverParams extends DetermineNextActionParams {
  current_worker: string;
}

export interface NextAction {
  action: 'retry' | 'blocked' | 'rework_required' | 'failed' | 'failover';
  reason?: string;
  retry_scheduled_at?: string;
  failover_worker?: string;  // Worker type to failover to
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