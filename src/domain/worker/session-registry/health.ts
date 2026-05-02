/**
 * Health Score Utilities
 *
 * Helper functions for session health scoring and transcript indexing.
 * Phase 2C: FR-C5, FR-C6
 */

import type {
  SessionHealthScore,
  TranscriptIndexMetadata,
  SessionRecord,
} from '../session-registry-types.js';

/**
 * Calculate health score based on execution result.
 */
export function calculateHealthScore(
  current: SessionHealthScore,
  success: boolean,
  minHealthScoreForReuse: number,
  maxErrorCountForReuse: number,
): SessionHealthScore {
  const now = Date.now();

  // Update counts
  if (success) {
    current.successCount++;
  } else {
    current.errorCount++;
  }

  // Calculate new score
  // Score = 100 - (errorCount * 15) + (successCount * 2)
  // Clamped to 0-100
  current.score = Math.max(0, Math.min(100, 100 - (current.errorCount * 15) + Math.min(current.successCount * 2, 50)));
  current.lastCalculated = now;

  // Determine health status
  current.isHealthy = current.score >= minHealthScoreForReuse &&
    current.errorCount <= maxErrorCountForReuse;

  return current;
}

/**
 * Create initial health score for a new session.
 */
export function createInitialHealthScore(): SessionHealthScore {
  return {
    score: 100,
    errorCount: 0,
    successCount: 0,
    isHealthy: true,
    lastCalculated: Date.now(),
  };
}

/**
 * Update transcript indexing metadata.
 */
export function updateTranscriptMetadata(
  existing: TranscriptIndexMetadata | undefined,
  updates: Partial<TranscriptIndexMetadata>,
): TranscriptIndexMetadata {
  const now = Date.now();
  const base = existing || {
    messageCount: 0,
    toolCount: 0,
    permissionRequestCount: 0,
    summaryKeywords: [],
    lastToolNames: [],
  };

  return {
    ...base,
    ...updates,
    lastUpdated: now,
  };
}

/**
 * Calculate average health score across sessions.
 */
export function calculateAverageHealthScore(sessions: Iterable<SessionRecord>): number {
  let totalHealthScore = 0;
  let healthySessions = 0;

  for (const record of sessions) {
    if (record.healthScore) {
      totalHealthScore += record.healthScore.score;
      healthySessions++;
    }
  }

  return healthySessions > 0 ? totalHealthScore / healthySessions : 100;
}