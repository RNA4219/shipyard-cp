/**
 * Session Reuse Utilities
 *
 * Helper functions for session reuse eligibility and ranking.
 * Phase 2C: FR-C2, FR-C4
 */

import type {
  AgentProfile,
  ReuseSkipReason,
  ReuseHitReason,
  SessionRecord,
  SessionSearchCriteria,
  SessionRegistryConfig,
} from '../session-registry-types.js';

/**
 * Check if a session is eligible for reuse.
 * Phase 2C: Includes agent profile matching and health score check.
 * Returns both eligibility and skip reason for observability.
 */
export function checkReuseEligibility(
  record: SessionRecord,
  criteria: SessionSearchCriteria,
  agentProfile: AgentProfile,
  config: Required<SessionRegistryConfig>,
): { eligible: boolean; skipReason?: ReuseSkipReason } {
  // Condition 1: Same task_id
  if (record.taskId !== criteria.taskId) {
    return { eligible: false, skipReason: 'task_mismatch' };
  }

  // Condition 2: Same workspace_ref
  if (record.workspaceRef.kind !== criteria.workspaceRef.kind ||
      record.workspaceRef.workspace_id !== criteria.workspaceRef.workspace_id) {
    return { eligible: false, skipReason: 'workspace_mismatch' };
  }

  // Condition 3: Same logical_worker
  if (record.logicalWorker !== criteria.logicalWorker) {
    return { eligible: false, skipReason: 'task_mismatch' };
  }

  // Condition 4: Same stage_bucket (same-stage reuse only) - CRITICAL: dev->acceptance forbidden
  if (record.stageBucket !== criteria.stageBucket) {
    return { eligible: false, skipReason: 'stage_bucket_mismatch' };
  }

  // Condition 5: Same policy_fingerprint
  if (record.policyFingerprint !== criteria.policyFingerprint) {
    return { eligible: false, skipReason: 'policy_fingerprint_mismatch' };
  }

  // Phase 2C (FR-C2): Same agent profile
  if (record.agentProfile !== agentProfile) {
    return { eligible: false, skipReason: 'agent_profile_mismatch' };
  }

  // Condition 7: Session is not leased by another job (check before state)
  if (record.leasedBy) {
    // Check if lease expired
    if (record.leaseExpiresAt && record.leaseExpiresAt < Date.now()) {
      // Lease expired, clear it and reset state to idle for reuse
      // Note: The actual clearing is done by the caller
      return { eligible: true };
    } else {
      // Lease still valid, cannot reuse
      return { eligible: false, skipReason: 'already_leased' };
    }
  }

  // Condition 6: Session state is ready or idle (after lease check)
  if (record.state !== 'ready' && record.state !== 'idle') {
    return { eligible: false, skipReason: 'state_not_ready' };
  }

  // Phase 2C (FR-C6): Health score check
  if (record.healthScore && !record.healthScore.isHealthy) {
    return { eligible: false, skipReason: 'health_score_low' };
  }

  // Phase 2C: Error history check
  if (record.healthScore && record.healthScore.errorCount > config.maxErrorCountForReuse) {
    return { eligible: false, skipReason: 'error_history_high' };
  }

  return { eligible: true };
}

/**
 * Calculate reuse score for ranking.
 * Phase 2C (FR-C4).
 * Higher score = better candidate.
 */
export function calculateReuseScore(record: SessionRecord): number {
  const now = Date.now();
  let score = 100;

  // Factor 1: Recent last_used_at is better (up to -30 points for stale sessions)
  const lastUsed = record.lastUsedAt || record.lastActivityAt;
  const staleHours = (now - lastUsed) / (1000 * 60 * 60);
  score -= Math.min(30, staleHours * 5);

  // Factor 2: Higher health score is better
  if (record.healthScore) {
    score += record.healthScore.score * 0.3;
  }

  // Factor 3: Lower error count is better
  if (record.healthScore) {
    score -= record.healthScore.errorCount * 10;
  }

  // Factor 4: Appropriate transcript size (not too large, not too small)
  if (record.transcriptIndex) {
    const transcriptSize = record.transcriptIndex.transcriptSizeBytes || 0;
    // Ideal size: 10KB - 100KB
    if (transcriptSize < 10240) {
      score -= 5; // Too small, may lack context
    } else if (transcriptSize > 102400) {
      score -= 10; // Too large, may be slow
    }
  }

  // Factor 5: Warm pool bonus (warm sessions are pre-validated)
  if (record.inWarmPool) {
    score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Phase 2C (FR-C4): Rank reuse candidates.
 * Ranking factors: last_used_at, health score, error history, transcript size.
 * Higher score = better candidate.
 */
export function rankCandidates(candidates: SessionRecord[]): SessionRecord[] {
  return candidates
    .map(record => ({
      record,
      score: calculateReuseScore(record),
    }))
    .sort((a, b) => b.score - a.score) // Higher score first
    .map(item => item.record);
}