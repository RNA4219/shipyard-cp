/**
 * Centralized Error Handling for Shipyard Control Plane
 *
 * This module provides:
 * - Error codes for consistent error identification
 * - Error messages with template support for context
 * - ShipyardError class for structured error handling
 */

/**
 * Error codes for the Shipyard Control Plane
 */
export const ErrorCodes = {
  // Task errors
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_INVALID_STATE: 'TASK_INVALID_STATE',
  TASK_ALREADY_TERMINAL: 'TASK_ALREADY_TERMINAL',
  OBJECTIVE_REQUIRED: 'OBJECTIVE_REQUIRED',
  TYPED_REF_REQUIRED: 'TYPED_REF_REQUIRED',
  TYPED_REF_INVALID_FORMAT: 'TYPED_REF_INVALID_FORMAT',
  TASK_ID_MISMATCH: 'TASK_ID_MISMATCH',
  FROM_STATE_MISMATCH: 'FROM_STATE_MISMATCH',

  // Job errors
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_ID_MISMATCH: 'JOB_ID_MISMATCH',
  JOB_HEARTBEAT_REJECTED: 'JOB_HEARTBEAT_REJECTED',

  // State machine errors
  TRANSITION_NOT_ALLOWED: 'TRANSITION_NOT_ALLOWED',
  CANNOT_DISPATCH_WORKER: 'CANNOT_DISPATCH_WORKER',

  // Typed ref errors
  TYPED_REF_MISMATCH: 'TYPED_REF_MISMATCH',

  // Integration errors
  INTEGRATION_STATE_NOT_FOUND: 'INTEGRATION_STATE_NOT_FOUND',

  // Run errors
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Error messages with template support using {placeholder} syntax
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // Task errors
  TASK_NOT_FOUND: 'task not found: {taskId}',
  TASK_INVALID_STATE: 'task is not in {expected} state (current: {current})',
  TASK_ALREADY_TERMINAL: 'task already terminal: {state}',
  OBJECTIVE_REQUIRED: 'objective is required',
  TYPED_REF_REQUIRED: 'typed_ref is required',
  TYPED_REF_INVALID_FORMAT: 'typed_ref invalid format: {typedRef}',
  TASK_ID_MISMATCH: 'task_id mismatch: expected {expected}, got {actual}',
  FROM_STATE_MISMATCH: 'from_state mismatch: task is in {current}, not {expected}',

  // Job errors
  JOB_NOT_FOUND: 'job not found',
  JOB_ID_MISMATCH: 'job_id does not match active_job_id',
  JOB_HEARTBEAT_REJECTED: 'heartbeat rejected: not lease owner or job orphaned',

  // State machine errors
  TRANSITION_NOT_ALLOWED: 'transition not allowed: {from} -> {to}',
  CANNOT_DISPATCH_WORKER: 'state {state} cannot dispatch a worker job',

  // Typed ref errors
  TYPED_REF_MISMATCH: 'typed_ref mismatch: expected {expected}, got {actual}',

  // Integration errors
  INTEGRATION_STATE_NOT_FOUND: 'integration state not found',

  // Run errors
  RUN_NOT_FOUND: 'run not found: {runId}',
};

/**
 * Custom error class for Shipyard Control Plane errors
 *
 * Provides structured error information including:
 * - Error code for programmatic handling
 * - Human-readable message
 * - Optional context for debugging
 */
export class ShipyardError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ShipyardError';
  }

  /**
   * Create a ShipyardError from an error code with optional context
   *
   * @param code - The error code
   * @param context - Optional context to interpolate into the message
   * @returns A new ShipyardError instance
   */
  static fromCode(code: ErrorCode, context?: Record<string, unknown>): ShipyardError {
    let message = ErrorMessages[code];
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        message = message.replace(`{${key}}`, String(value));
      }
    }
    return new ShipyardError(code, message, context);
  }

  /**
   * Check if an error is a ShipyardError with a specific code
   */
  static is(error: unknown, code?: ErrorCode): error is ShipyardError {
    if (!(error instanceof ShipyardError)) {
      return false;
    }
    return code === undefined || error.code === code;
  }

  /**
   * Convert to JSON for logging/serialization
   */
  toJSON(): { name: string; code: ErrorCode; message: string; context?: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Helper function to create a ShipyardError from an error code
 */
export function createError(code: ErrorCode, context?: Record<string, unknown>): ShipyardError {
  return ShipyardError.fromCode(code, context);
}