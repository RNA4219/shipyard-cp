/**
 * Cleanup Utilities
 *
 * Helper functions for orphan detection and session cleanup.
 * Phase 2B: FR-B5
 */

import type { CleanupReason } from '../opencode-event-ingestor.js';
import type { SessionRecord } from '../session-registry-types.js';

/**
 * Find orphan sessions.
 * Phase 2B: FR-B5.
 * Orphan sessions are:
 * - Leased but lease expired
 * - Active but no recent heartbeat
 * - In unexpected states after server crash
 */
export function findOrphanSessions(
  sessions: Iterable<SessionRecord>,
  leaseTtlMs: number,
): SessionRecord[] {
  const now = Date.now();
  const orphans: SessionRecord[] = [];

  for (const record of sessions) {
    // Already dead or draining - not orphan
    if (record.state === 'dead' || record.state === 'draining') {
      continue;
    }

    // Check for expired lease
    if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt < now) {
      orphans.push(record);
      continue;
    }

    // Check for stale active session (no activity for > lease TTL)
    if (record.state === 'active') {
      const inactiveTime = now - record.lastActivityAt;
      if (inactiveTime > leaseTtlMs * 2) {
        orphans.push(record);
        continue;
      }
    }

    // Check for initializing sessions that never became ready
    if (record.state === 'initializing') {
      const age = now - record.createdAt;
      if (age > 60000) { // 1 minute
        orphans.push(record);
        continue;
      }
    }
  }

  return orphans;
}

/**
 * Determine cleanup reason for orphan session.
 */
export function determineOrphanCleanupReason(record: SessionRecord): CleanupReason {
  if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt < Date.now()) {
    return 'lease_expired';
  } else if (record.state === 'active') {
    return 'timeout';
  } else if (record.state === 'initializing') {
    return 'server_crash';
  } else {
    return 'orphan_detected';
  }
}

/**
 * Find expired sessions for cleanup.
 */
export function findExpiredSessions(
  sessions: Map<string, SessionRecord>,
  sessionTtlMs: number,
): { sessionId: string; reason: CleanupReason }[] {
  const now = Date.now();
  const expired: { sessionId: string; reason: CleanupReason }[] = [];

  for (const [sessionId, record] of sessions.entries()) {
    // Skip draining sessions (in progress)
    if (record.state === 'draining') {
      continue;
    }

    // Check TTL expiration
    const age = now - record.createdAt;
    if (age > sessionTtlMs) {
      expired.push({ sessionId, reason: 'ttl_expired' });
      continue;
    }

    // Check inactivity expiration (idle sessions)
    const inactiveTime = now - record.lastActivityAt;
    if (record.state === 'idle' && inactiveTime > sessionTtlMs / 2) {
      expired.push({ sessionId, reason: 'ttl_expired' });
      continue;
    }

    // Remove dead sessions after 5 minutes
    if (record.state === 'dead' && inactiveTime > 5 * 60 * 1000) {
      expired.push({ sessionId, reason: record.cleanupReason || 'manual_cleanup' });
    }
  }

  return expired;
}