/**
 * OpenCode Session Registry
 *
 * Tracks sessions for reuse eligibility and lifecycle management.
 * Phase 2B: Enhanced orphan detection and cleanup with reason tracking.
 * Phase 2C: Agent-aware session policy, warm pool, reuse ranking, transcript indexing.
 */

import { getLogger } from '../../monitoring/index.js';
import type { CleanupReason } from './opencode-event-ingestor.js';
import {
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
} from './session-registry-types.js';

// Re-export types for backward compatibility
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
};

export class OpenCodeSessionRegistry {
  private readonly logger = getLogger().child({ component: 'OpenCodeSessionRegistry' });
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly config: Required<SessionRegistryConfig>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private orphanDetectionInterval: NodeJS.Timeout | null = null;

  // Phase 2C: Warm pool tracking
  private warmPoolSessions = new Set<string>();

  // Statistics tracking
  private stats: SessionRegistryStats = {
    sessionsCreated: 0,
    sessionsReused: 0,
    sessionsCleaned: 0,
    orphansDetected: 0,
    cleanupByReason: {} as Record<CleanupReason, number>,
    // Phase 2C
    warmPoolSize: 0,
    warmPoolHits: 0,
    warmPoolMisses: 0,
    reuseHitReasons: {} as Record<ReuseHitReason, number>,
    reuseSkipReasons: {} as Record<ReuseSkipReason, number>,
  };

  constructor(config: SessionRegistryConfig) {
    this.config = {
      sessionTtlMs: config.sessionTtlMs,
      leaseTtlMs: config.leaseTtlMs,
      debug: config.debug || false,
      orphanDetectionIntervalMs: config.orphanDetectionIntervalMs || 30000, // 30 seconds
      // Phase 2C
      enableWarmPool: config.enableWarmPool ?? true,
      minHealthScoreForReuse: config.minHealthScoreForReuse ?? 50,
      maxErrorCountForReuse: config.maxErrorCountForReuse ?? 3,
    };

    // Start periodic cleanup and orphan detection
    this.startCleanup();
    this.startOrphanDetection();
  }

  /**
   * Shutdown the registry and stop all intervals.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.orphanDetectionInterval) {
      clearInterval(this.orphanDetectionInterval);
      this.orphanDetectionInterval = null;
    }
  }

  /**
   * Create a new session record.
   * Phase 2C: Includes agent profile and initial health score.
   */
  createSessionRecord(
    sessionId: string,
    criteria: SessionSearchCriteria,
    serverBaseUrl: string,
  ): SessionRecord {
    const now = Date.now();
    const agentProfile = criteria.agentProfile || determineAgentProfile(criteria.stageBucket);
    const record: SessionRecord = {
      sessionId,
      taskId: criteria.taskId,
      workspaceRef: criteria.workspaceRef,
      logicalWorker: criteria.logicalWorker,
      stageBucket: criteria.stageBucket,
      policyFingerprint: criteria.policyFingerprint,
      agentProfile,
      state: 'initializing',
      createdAt: now,
      lastActivityAt: now,
      serverBaseUrl,
      // Phase 2C: Initial health score
      healthScore: {
        score: 100,
        errorCount: 0,
        successCount: 0,
        isHealthy: true,
        lastCalculated: now,
      },
      inWarmPool: false,
    };

    this.sessions.set(sessionId, record);
    this.stats.sessionsCreated++;

    this.logger.info('Session record created', {
      sessionId,
      taskId: criteria.taskId,
      logicalWorker: criteria.logicalWorker,
      stageBucket: criteria.stageBucket,
      agentProfile,
    });

    return record;
  }

  /**
   * Find a reusable session matching the criteria.
   * Phase 2C: Implements reuse ranking with warm pool support.
   * Returns null if no suitable session exists.
   */
  findReusableSession(criteria: SessionSearchCriteria): SessionRecord | null {
    const candidates: SessionRecord[] = [];
    const skipReasons: ReuseSkipReason[] = [];
    const agentProfile = criteria.agentProfile || determineAgentProfile(criteria.stageBucket);

    for (const record of this.sessions.values()) {
      // Check all reuse eligibility conditions
      const reuseCheck = this.checkReuseEligibility(record, criteria, agentProfile);
      if (reuseCheck.eligible) {
        candidates.push(record);
      } else if (reuseCheck.skipReason) {
        skipReasons.push(reuseCheck.skipReason);
      }
    }

    // Track skip reasons for observability
    for (const reason of skipReasons) {
      this.stats.reuseSkipReasons[reason] = (this.stats.reuseSkipReasons[reason] || 0) + 1;
      this.logger.debug('Reuse skipped', {
        reason,
        taskId: criteria.taskId,
        stageBucket: criteria.stageBucket,
        agentProfile,
      });
    }

    if (candidates.length === 0) {
      this.logger.debug('No reusable session found', {
        taskId: criteria.taskId,
        logicalWorker: criteria.logicalWorker,
        stageBucket: criteria.stageBucket,
        agentProfile,
      });

      return null;
    }

    // Phase 2C: Rank candidates and select best
    const ranked = this.rankCandidates(candidates);
    const selected = ranked[0];

    // Determine hit reason
    const hitReason: ReuseHitReason = selected.inWarmPool ? 'warm_pool_match' : 'fresh_idle_match';
    this.stats.reuseHitReasons[hitReason] = (this.stats.reuseHitReasons[hitReason] || 0) + 1;

    // Remove from warm pool if present
    if (selected.inWarmPool) {
      this.removeFromWarmPool(selected.sessionId);
      this.stats.warmPoolHits++;
    }

    this.logger.info('Reusable session found', {
      sessionId: selected.sessionId,
      taskId: criteria.taskId,
      stageBucket: criteria.stageBucket,
      agentProfile,
      hitReason,
      healthScore: selected.healthScore?.score,
      ranking: candidates.length > 1 ? `ranked among ${candidates.length} candidates` : 'single candidate',
    });

    this.stats.sessionsReused++;
    return selected;
  }

  /**
   * Check if a session is eligible for reuse.
   * Phase 2C: Includes agent profile matching and health score check.
   * Returns both eligibility and skip reason for observability.
   */
  private checkReuseEligibility(
    record: SessionRecord,
    criteria: SessionSearchCriteria,
    agentProfile: AgentProfile,
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
        record.leasedBy = undefined;
        record.leaseExpiresAt = undefined;
        record.state = 'idle';
        record.lastActivityAt = Date.now();
        this.logger.info('Expired lease cleared for reuse', {
          sessionId: record.sessionId,
        });
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
    if (record.healthScore && record.healthScore.errorCount > this.config.maxErrorCountForReuse) {
      return { eligible: false, skipReason: 'error_history_high' };
    }

    return { eligible: true };
  }

  /**
   * Phase 2C (FR-C4): Rank reuse candidates.
   * Ranking factors: last_used_at, health score, error history, transcript size.
   * Higher score = better candidate.
   */
  private rankCandidates(candidates: SessionRecord[]): SessionRecord[] {
    return candidates
      .map(record => ({
        record,
        score: this.calculateReuseScore(record),
      }))
      .sort((a, b) => b.score - a.score) // Higher score first
      .map(item => item.record);
  }

  /**
   * Calculate reuse score for ranking.
   * Phase 2C (FR-C4).
   */
  private calculateReuseScore(record: SessionRecord): number {
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
   * Lease a session for a job.
   * Phase 2C: Track lastUsedAt and remove from warm pool.
   */
  leaseSession(sessionId: string, jobId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) {
      this.logger.warn('Cannot lease non-existent session', { sessionId });
      return false;
    }

    if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt > Date.now()) {
      this.logger.warn('Session already leased', { sessionId, leasedBy: record.leasedBy });
      return false;
    }

    const now = Date.now();
    record.leasedBy = jobId;
    record.leaseExpiresAt = now + this.config.leaseTtlMs;
    record.state = 'active';
    record.lastActivityAt = now;
    // Phase 2C: Track last used timestamp
    record.lastUsedAt = now;

    // Phase 2C: Remove from warm pool when leased
    if (record.inWarmPool) {
      this.removeFromWarmPool(sessionId);
    }

    this.logger.info('Session leased', {
      sessionId,
      jobId,
      leaseExpiresAt: record.leaseExpiresAt,
      agentProfile: record.agentProfile,
    });

    return true;
  }

  /**
   * Release a session lease.
   * Phase 2C: Consider adding to warm pool if eligible.
   */
  releaseSession(sessionId: string, jobId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) {
      this.logger.warn('Cannot release non-existent session', { sessionId });
      return false;
    }

    if (record.leasedBy !== jobId) {
      this.logger.warn('Session not leased by this job', {
        sessionId,
        jobId,
        leasedBy: record.leasedBy,
      });
      return false;
    }

    const now = Date.now();
    record.leasedBy = undefined;
    record.leaseExpiresAt = undefined;
    record.state = 'idle';
    record.lastActivityAt = now;

    // Phase 2C: Update health score on successful release
    this.updateHealthScore(sessionId, true);

    // Phase 2C: Consider adding to warm pool
    if (this.config.enableWarmPool && this.isWarmPoolEligible(record)) {
      this.addToWarmPool(sessionId);
    }

    this.logger.info('Session released', {
      sessionId,
      jobId,
      state: record.state,
      inWarmPool: record.inWarmPool,
      healthScore: record.healthScore?.score,
    });

    return true;
  }

  /**
   * Mark a session as dead (unusable) with cleanup reason.
   * Phase 2B: Enhanced with reason tracking.
   * Phase 2C: Remove from warm pool.
   */
  markSessionDead(sessionId: string, error?: string, cleanupReason?: CleanupReason): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    record.state = 'dead';
    record.error = error;
    record.cleanupReason = cleanupReason || 'task_failed';
    record.lastActivityAt = Date.now();

    // Phase 2C: Remove from warm pool
    if (record.inWarmPool) {
      this.removeFromWarmPool(sessionId);
    }

    // Phase 2C: Update health score on failure
    this.updateHealthScore(sessionId, false);

    // Track cleanup by reason
    if (record.cleanupReason) {
      this.stats.cleanupByReason[record.cleanupReason] =
        (this.stats.cleanupByReason[record.cleanupReason] || 0) + 1;
    }

    this.logger.warn('Session marked dead', {
      sessionId,
      error,
      cleanupReason: record.cleanupReason,
      agentProfile: record.agentProfile,
    });
  }

  /**
   * Mark a session as draining (cleanup in progress).
   * Phase 2B: New state for orphan sessions.
   */
  markSessionDraining(sessionId: string, cleanupReason: CleanupReason): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    const previousState = record.state;
    record.state = 'draining';
    record.cleanupReason = cleanupReason;
    record.lastActivityAt = Date.now();

    this.logger.info('Session marked draining', {
      sessionId,
      previousState,
      cleanupReason,
    });
  }

  /**
   * Mark an orphan session and transition it to draining -> dead.
   * Phase 2B: FR-B5 orphan recovery.
   */
  private markSessionOrphan(record: SessionRecord, reason: CleanupReason): void {
    this.stats.orphansDetected++;

    this.logger.warn('Orphan session detected', {
      sessionId: record.sessionId,
      taskId: record.taskId,
      reason,
      previousState: record.state,
      leasedBy: record.leasedBy,
    });

    // Transition: draining -> dead
    record.state = 'draining';
    record.cleanupReason = reason;
    record.leasedBy = undefined;
    record.leaseExpiresAt = undefined;

    // Immediately transition to dead after marking draining
    record.state = 'dead';
    record.error = `Orphan session: ${reason}`;

    // Track cleanup by reason
    this.stats.cleanupByReason[reason] = (this.stats.cleanupByReason[reason] || 0) + 1;

    this.logger.info('Orphan session cleaned', {
      sessionId: record.sessionId,
      cleanupReason: reason,
    });
  }

  /**
   * Mark a session as ready (healthy and usable).
   * Phase 2C: Consider adding to warm pool.
   */
  markSessionReady(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    record.state = 'ready';
    record.lastActivityAt = Date.now();

    // Phase 2C: Consider adding to warm pool if eligible
    if (this.config.enableWarmPool && this.isWarmPoolEligible(record)) {
      this.addToWarmPool(sessionId);
    }

    this.logger.debug('Session marked ready', {
      sessionId,
      inWarmPool: record.inWarmPool,
    });
  }

  // ====================
  // Phase 2C: Warm Pool Methods (FR-C3)
  // ====================

  /**
   * Check if a session is eligible for warm pool.
   * Warm pool conditions: idle/ready state, not leased, healthy, safe for reuse.
   */
  private isWarmPoolEligible(record: SessionRecord): boolean {
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
    if (age > this.config.sessionTtlMs) {
      return false;
    }

    return true;
  }

  /**
   * Add a session to warm pool.
   */
  private addToWarmPool(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record || record.inWarmPool) {
      return;
    }

    record.inWarmPool = true;
    record.warmPoolEntryAt = Date.now();
    this.warmPoolSessions.add(sessionId);
    this.stats.warmPoolSize = this.warmPoolSessions.size;

    this.logger.info('Session added to warm pool', {
      sessionId,
      taskId: record.taskId,
      stageBucket: record.stageBucket,
      agentProfile: record.agentProfile,
      warmPoolSize: this.stats.warmPoolSize,
    });
  }

  /**
   * Remove a session from warm pool.
   */
  private removeFromWarmPool(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record || !record.inWarmPool) {
      return;
    }

    record.inWarmPool = false;
    record.warmPoolEntryAt = undefined;
    this.warmPoolSessions.delete(sessionId);
    this.stats.warmPoolSize = this.warmPoolSessions.size;

    this.logger.info('Session removed from warm pool', {
      sessionId,
      warmPoolSize: this.stats.warmPoolSize,
    });
  }

  /**
   * Get warm pool session for criteria (Phase 2C, FR-C3).
   * Rechecks task/workspace/policy/stage conditions on acquisition.
   */
  getWarmPoolSession(criteria: SessionSearchCriteria): SessionRecord | null {
    if (!this.config.enableWarmPool) {
      return null;
    }

    const agentProfile = criteria.agentProfile || determineAgentProfile(criteria.stageBucket);

    for (const sessionId of this.warmPoolSessions) {
      const record = this.sessions.get(sessionId);
      if (!record) {
        this.warmPoolSessions.delete(sessionId);
        continue;
      }

      // Phase 2C: Safety recheck on acquisition (SR-C1)
      // Must match all conditions before allowing warm pool reuse
      const eligibility = this.checkReuseEligibility(record, criteria, agentProfile);
      if (eligibility.eligible) {
        this.stats.warmPoolHits++;
        this.stats.reuseHitReasons['warm_pool_match'] =
          (this.stats.reuseHitReasons['warm_pool_match'] || 0) + 1;

        this.logger.info('Warm pool session acquired', {
          sessionId,
          taskId: criteria.taskId,
          stageBucket: criteria.stageBucket,
          agentProfile,
        });

        return record;
      }
    }

    this.stats.warmPoolMisses++;
    return null;
  }

  /**
   * Get warm pool size for observability (OR-C1).
   */
  getWarmPoolSize(): number {
    return this.warmPoolSessions.size;
  }

  // ====================
  // Phase 2C: Health Score Methods (FR-C6)
  // ====================

  /**
   * Update health score based on execution result.
   */
  updateHealthScore(sessionId: string, success: boolean): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    const now = Date.now();
    const current = record.healthScore || {
      score: 100,
      errorCount: 0,
      successCount: 0,
      isHealthy: true,
      lastCalculated: now,
    };

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
    current.isHealthy = current.score >= this.config.minHealthScoreForReuse &&
      current.errorCount <= this.config.maxErrorCountForReuse;

    record.healthScore = current;

    this.logger.debug('Health score updated', {
      sessionId,
      score: current.score,
      errorCount: current.errorCount,
      successCount: current.successCount,
      isHealthy: current.isHealthy,
    });

    // If became unhealthy, remove from warm pool
    if (!current.isHealthy && record.inWarmPool) {
      this.removeFromWarmPool(sessionId);
    }
  }

  // ====================
  // Phase 2C: Transcript Index Methods (FR-C5)
  // ====================

  /**
   * Update transcript indexing metadata.
   * Internal artifact, not exposed in public API.
   */
  updateTranscriptIndex(
    sessionId: string,
    metadata: Partial<TranscriptIndexMetadata>,
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    const now = Date.now();
    record.transcriptIndex = {
      ...(record.transcriptIndex || {
        messageCount: 0,
        toolCount: 0,
        permissionRequestCount: 0,
        summaryKeywords: [],
        lastToolNames: [],
      }),
      ...metadata,
      lastUpdated: now,
    };

    this.logger.debug('Transcript index updated', {
      sessionId,
      messageCount: record.transcriptIndex.messageCount,
      toolCount: record.transcriptIndex.toolCount,
      permissionRequestCount: record.transcriptIndex.permissionRequestCount,
      keywordsCount: record.transcriptIndex.summaryKeywords.length,
    });
  }

  /**
   * Get transcript index for a session.
   */
  getTranscriptIndex(sessionId: string): TranscriptIndexMetadata | undefined {
    const record = this.sessions.get(sessionId);
    return record?.transcriptIndex;
  }

  /**
   * Get a session record by ID.
   */
  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a task.
   */
  getSessionsForTask(taskId: string): SessionRecord[] {
    return Array.from(this.sessions.values()).filter(r => r.taskId === taskId);
  }

  /**
   * Delete a session record with cleanup reason tracking.
   * Phase 2C: Remove from warm pool on delete.
   */
  deleteSession(sessionId: string, cleanupReason?: CleanupReason): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return false;
    }

    // Phase 2C: Remove from warm pool
    if (record.inWarmPool) {
      this.removeFromWarmPool(sessionId);
    }

    // Track cleanup reason
    const reason = cleanupReason || record.cleanupReason || 'manual_cleanup';
    this.stats.cleanupByReason[reason] = (this.stats.cleanupByReason[reason] || 0) + 1;
    this.stats.sessionsCleaned++;

    const existed = this.sessions.delete(sessionId);
    if (existed) {
      this.logger.info('Session deleted', {
        sessionId,
        cleanupReason: reason,
        agentProfile: record.agentProfile,
      });
    }
    return existed;
  }

  /**
   * Get registry statistics.
   * Phase 2C: Includes warm pool and reuse ranking stats.
   */
  getStats(): {
    total: number;
    byState: Record<SessionRecord['state'], number>;
    leased: number;
    warmPool: number;
    lifecycleStats: SessionRegistryStats;
  } {
    const byState: Record<SessionRecord['state'], number> = {
      initializing: 0,
      ready: 0,
      active: 0,
      idle: 0,
      draining: 0,
      dead: 0,
      expired: 0,
    };

    let leased = 0;

    for (const record of this.sessions.values()) {
      byState[record.state]++;
      if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt > Date.now()) {
        leased++;
      }
    }

    // Update warm pool size in stats
    this.stats.warmPoolSize = this.warmPoolSessions.size;

    return {
      total: this.sessions.size,
      byState,
      leased,
      warmPool: this.warmPoolSessions.size,
      lifecycleStats: this.stats,
    };
  }

  /**
   * Get Phase 2C specific statistics for observability.
   */
  getPhase2CStats(): {
    warmPoolSize: number;
    warmPoolHits: number;
    warmPoolMisses: number;
    reuseHitReasons: Record<ReuseHitReason, number>;
    reuseSkipReasons: Record<ReuseSkipReason, number>;
    avgHealthScore: number;
  } {
    // Calculate average health score
    let totalHealthScore = 0;
    let healthySessions = 0;
    for (const record of this.sessions.values()) {
      if (record.healthScore) {
        totalHealthScore += record.healthScore.score;
        healthySessions++;
      }
    }
    const avgHealthScore = healthySessions > 0 ? totalHealthScore / healthySessions : 100;

    return {
      warmPoolSize: this.warmPoolSessions.size,
      warmPoolHits: this.stats.warmPoolHits,
      warmPoolMisses: this.stats.warmPoolMisses,
      reuseHitReasons: { ...this.stats.reuseHitReasons },
      reuseSkipReasons: { ...this.stats.reuseSkipReasons },
      avgHealthScore,
    };
  }

  /**
   * Find orphan sessions (Phase 2B: FR-B5).
   * Orphan sessions are:
   * - Leased but lease expired
   * - Active but no recent heartbeat
   * - In unexpected states after server crash
   */
  findOrphanSessions(): SessionRecord[] {
    const now = Date.now();
    const orphans: SessionRecord[] = [];

    for (const record of this.sessions.values()) {
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
        if (inactiveTime > this.config.leaseTtlMs * 2) {
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
   * Process orphan sessions (transition draining -> dead).
   */
  processOrphans(): number {
    const orphans = this.findOrphanSessions();

    for (const record of orphans) {
      // Determine cleanup reason based on session state
      let reason: CleanupReason;

      if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt < Date.now()) {
        reason = 'lease_expired';
      } else if (record.state === 'active') {
        reason = 'timeout';
      } else if (record.state === 'initializing') {
        reason = 'server_crash';
      } else {
        reason = 'orphan_detected';
      }

      this.markSessionOrphan(record, reason);
    }

    if (orphans.length > 0) {
      this.logger.info('Orphan sessions processed', {
        count: orphans.length,
        sessions: orphans.map(o => ({ sessionId: o.sessionId, reason: o.cleanupReason })),
      });
    }

    return orphans.length;
  }

  /**
   * Cleanup all sessions for a task (Phase 2B).
   */
  cleanupSessionsForTask(taskId: string, reason: CleanupReason): number {
    const sessions = this.getSessionsForTask(taskId);
    let cleaned = 0;

    for (const record of sessions) {
      if (record.state !== 'dead') {
        this.markSessionDead(record.sessionId, `Task cleanup: ${reason}`, reason);
      }
      this.deleteSession(record.sessionId, reason);
      cleaned++;
    }

    this.logger.info('Sessions cleaned up for task', {
      taskId,
      count: cleaned,
      reason,
    });

    return cleaned;
  }

  /**
   * Start periodic cleanup of expired/dead sessions.
   */
  private startCleanup(): void {
    // Cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Start orphan detection interval.
   */
  private startOrphanDetection(): void {
    this.orphanDetectionInterval = setInterval(() => {
      this.processOrphans();
    }, this.config.orphanDetectionIntervalMs);
  }

  /**
   * Cleanup expired and dead sessions with reason tracking.
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [sessionId, record] of this.sessions.entries()) {
      // Skip draining sessions (in progress)
      if (record.state === 'draining') {
        continue;
      }

      // Check TTL expiration
      const age = now - record.createdAt;
      if (age > this.config.sessionTtlMs) {
        record.state = 'expired';
        record.cleanupReason = 'ttl_expired';
        expiredIds.push(sessionId);
        continue;
      }

      // Check inactivity expiration (idle sessions)
      const inactiveTime = now - record.lastActivityAt;
      if (record.state === 'idle' && inactiveTime > this.config.sessionTtlMs / 2) {
        record.state = 'expired';
        record.cleanupReason = 'ttl_expired';
        expiredIds.push(sessionId);
        continue;
      }

      // Remove dead sessions after 5 minutes
      if (record.state === 'dead' && inactiveTime > 5 * 60 * 1000) {
        expiredIds.push(sessionId);
      }
    }

    for (const sessionId of expiredIds) {
      const record = this.sessions.get(sessionId);
      if (record) {
        this.stats.cleanupByReason['ttl_expired'] =
          (this.stats.cleanupByReason['ttl_expired'] || 0) + 1;
        this.stats.sessionsCleaned++;
      }
      this.sessions.delete(sessionId);
      this.logger.info('Session cleaned up', {
        sessionId,
        cleanupReason: record?.cleanupReason || 'ttl_expired',
      });
    }
  }
}

/**
 * Create a session registry from config.
 */
export function createOpenCodeSessionRegistry(config: SessionRegistryConfig): OpenCodeSessionRegistry {
  return new OpenCodeSessionRegistry(config);
}