/**
 * Timeouts and Duration Constants
 *
 * Centralized timeout values for consistent configuration across the codebase.
 */

// =============================================================================
// Job Timeouts
// =============================================================================

/** Default timeout for job execution (10 minutes) */
export const JOB_TIMEOUT_MS = 600000;

/** Polling interval for job status checks (5 seconds) */
export const JOB_POLL_INTERVAL_MS = 5000;

/** Maximum poll attempts before considering job stalled (120 attempts = 10 min at 5s intervals) */
export const JOB_MAX_POLL_ATTEMPTS = 120;

/** Duration of a lease for job ownership (5 minutes) */
export const LEASE_DURATION_MS = 300000;

// =============================================================================
// Heartbeat
// =============================================================================

/** Interval between heartbeat signals (1 minute) */
export const HEARTBEAT_INTERVAL_MS = 60000;

/** Multiplier for heartbeat grace period (3x heartbeat interval) */
export const HEARTBEAT_GRACE_MULTIPLIER = 3;

/** Default orphan scanner interval (1 minute) */
export const ORPHAN_SCAN_INTERVAL_MS = 60000;

// =============================================================================
// TTL Values (in seconds)
// =============================================================================

/** Time-to-live for task data (7 days) */
export const TASK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Time-to-live for job data (24 hours) */
export const JOB_TTL_SECONDS = 24 * 60 * 60;

/** Time-to-live for result data (24 hours) */
export const RESULT_TTL_SECONDS = 24 * 60 * 60;

/** Time-to-live for event data (30 days) */
export const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;