/**
 * Warm Pool Utilities
 *
 * Helper functions for warm pool session management.
 * Phase 2C: FR-C3
 */

import type {
  SessionRecord,
  SessionSearchCriteria,
  SessionRegistryStats,
  SessionRegistryConfig,
} from '../session-registry-types.js';
import { determineAgentProfile } from '../session-registry-types.js';
import { checkReuseEligibility } from './reuse.js';

/**
 * Check if a session is eligible for warm pool.
 * Warm pool conditions: idle/ready state, not leased, healthy, safe for reuse.
 */
export function isWarmPoolEligible(
  record: SessionRecord,
  sessionTtlMs: number,
): boolean {
  // Must be idle or ready state
  if (record.state !== 'idle' && record.state !== 'ready') {
    return false;
  }

  // Must not be leased
  if (record.leasedBy) {
    return false;
  }

  // Must be healthy
  if (record.healthScore && !record.healthScore.isHealthy) {
    return false;
  }

  // Must not exceed TTL
  const age = Date.now() - record.createdAt;
  if (age > sessionTtlMs) {
    return false;
  }

  return true;
}

/**
 * Find a warm pool session matching criteria.
 * Phase 2C, FR-C3.
 * Rechecks task/workspace/policy/stage conditions on acquisition.
 */
export function findWarmPoolSession(
  warmPoolSessions: Set<string>,
  sessions: Map<string, SessionRecord>,
  criteria: SessionSearchCriteria,
  config: {
    minHealthScoreForReuse: number;
    maxErrorCountForReuse: number;
    sessionTtlMs: number;
    leaseTtlMs: number;
  },
  stats: SessionRegistryStats,
): SessionRecord | null {
  const agentProfile = criteria.agentProfile || determineAgentProfile(criteria.stageBucket);

  for (const sessionId of warmPoolSessions) {
    const record = sessions.get(sessionId);
    if (!record) {
      continue;
    }

    // Phase 2C: Safety recheck on acquisition (SR-C1)
    // Must match all conditions before allowing warm pool reuse
    const eligibility = checkReuseEligibility(record, criteria, agentProfile, config as Required<SessionRegistryConfig>);
    if (eligibility.eligible) {
      stats.warmPoolHits++;
      stats.reuseHitReasons['warm_pool_match'] =
        (stats.reuseHitReasons['warm_pool_match'] || 0) + 1;

      return record;
    }
  }

  stats.warmPoolMisses++;
  return null;
}

/**
 * Create a new warm pool set and return management functions.
 */
export function createWarmPoolManager() {
  const warmPoolSessions = new Set<string>();

  return {
    add: (sessionId: string, record: SessionRecord, stats: SessionRegistryStats) => {
      if (record.inWarmPool) return false;

      record.inWarmPool = true;
      record.warmPoolEntryAt = Date.now();
      warmPoolSessions.add(sessionId);
      stats.warmPoolSize = warmPoolSessions.size;

      return true;
    },

    remove: (sessionId: string, record: SessionRecord, stats: SessionRegistryStats) => {
      if (!record.inWarmPool) return false;

      record.inWarmPool = false;
      record.warmPoolEntryAt = undefined;
      warmPoolSessions.delete(sessionId);
      stats.warmPoolSize = warmPoolSessions.size;

      return true;
    },

    size: () => warmPoolSessions.size,

    sessions: () => warmPoolSessions,

    has: (sessionId: string) => warmPoolSessions.has(sessionId),
  };
}