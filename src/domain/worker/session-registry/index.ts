/**
 * Session Registry Package
 *
 * Re-export all types and utilities for backward compatibility.
 */

// Re-export types from session-registry-types.js
export {
  type AgentProfile,
  type ReuseSkipReason,
  type ReuseHitReason,
  type TranscriptIndexMetadata,
  type SessionHealthScore,
  type SessionRecord,
  type SessionSearchCriteria,
  type SessionRegistryConfig,
  type SessionRegistryStats,
  CleanupReasons,
  generatePolicyFingerprint,
  determineAgentProfile,
} from '../session-registry-types.js';

// Re-export utilities
export {
  checkReuseEligibility,
  calculateReuseScore,
  rankCandidates,
} from './reuse.js';

export {
  isWarmPoolEligible,
  findWarmPoolSession,
  createWarmPoolManager,
} from './warm-pool.js';

export {
  calculateHealthScore,
  createInitialHealthScore,
  updateTranscriptMetadata,
  calculateAverageHealthScore,
} from './health.js';

export {
  findOrphanSessions,
  determineOrphanCleanupReason,
  findExpiredSessions,
} from './cleanup.js';

// Re-export main class and factory
export { OpenCodeSessionRegistry, createOpenCodeSessionRegistry } from './registry.js';