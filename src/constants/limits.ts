/**
 * Limit Constants
 *
 * Centralized limit values for consistent configuration across the codebase.
 */

// =============================================================================
// Retry Limits
// =============================================================================

/** Default maximum number of retries for failed operations */
export const MAX_RETRIES_DEFAULT = 3;

// =============================================================================
// Agent Limits
// =============================================================================

/** Maximum number of concurrent agents that can be spawned */
export const MAX_CONCURRENT_AGENTS = 300;

/** Maximum number of agent spawns per time window */
export const MAX_SPAWNS_PER_WINDOW = 150;

// =============================================================================
// Rate Limiting
// =============================================================================

/** Time window for rate limiting in seconds (60 seconds = 1 minute) */
export const SPAWN_RATE_WINDOW_SECONDS = 60;