/**
 * OpenCode Session Registry
 *
 * Tracks sessions for reuse eligibility and lifecycle management.
 * Phase 2B: Enhanced orphan detection and cleanup with reason tracking.
 * Phase 2C: Agent-aware session policy, warm pool, reuse ranking, transcript indexing.
 */

import { getLogger } from '../../../monitoring/index.js';
import type { CleanupReason } from '../opencode-event-ingestor.js';
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
} from '../session-registry-types.js';

// Import utilities
import {
  checkReuseEligibility,
  rankCandidates,
} from './reuse.js';
import {
  isWarmPoolEligible,
  createWarmPoolManager,
} from './warm-pool.js';
import {
  calculateHealthScore,
  createInitialHealthScore,
  updateTranscriptMetadata,
} from './health.js';
import {
  findOrphanSessions,
  determineOrphanCleanupReason,
  findExpiredSessions,
} from './cleanup.js';

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
  private warmPoolManager = createWarmPoolManager();

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
      healthScore: createInitialHealthScore(),
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
      const reuseCheck = checkReuseEligibility(record, criteria, agentProfile, this.config);
      if (reuseCheck.eligible) {
        // Handle expired lease
        if (record.leasedBy && record.leaseExpiresAt && record.leaseExpiresAt < Date.now()) {
          record.leasedBy = undefined;
          record.leaseExpiresAt = undefined;
          record.state = 'idle';
          record.lastActivityAt = Date.now();
          this.logger.info('Expired lease cleared for reuse', {
            sessionId: record.sessionId,
          });
        }
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
    const ranked = rankCandidates(candidates);
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
    if (this.config.enableWarmPool && isWarmPoolEligible(record, this.config.sessionTtlMs)) {
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
    if (this.config.enableWarmPool && isWarmPoolEligible(record, this.config.sessionTtlMs)) {
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

  private addToWarmPool(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record || record.inWarmPool) {
      return;
    }

    this.warmPoolManager.add(sessionId, record, this.stats);

    this.logger.info('Session added to warm pool', {
      sessionId,
      taskId: record.taskId,
      stageBucket: record.stageBucket,
      agentProfile: record.agentProfile,
      warmPoolSize: this.stats.warmPoolSize,
    });
  }

  private removeFromWarmPool(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record || !record.inWarmPool) {
      return;
    }

    this.warmPoolManager.remove(sessionId, record, this.stats);

    this.logger.info('Session removed from warm pool', {
      sessionId,
      warmPoolSize: this.stats.warmPoolSize,
    });
  }

  getWarmPoolSession(criteria: SessionSearchCriteria): SessionRecord | null {
    if (!this.config.enableWarmPool) {
      return null;
    }

    const agentProfile = criteria.agentProfile || determineAgentProfile(criteria.stageBucket);

    for (const sessionId of this.warmPoolManager.sessions()) {
      const record = this.sessions.get(sessionId);
      if (!record) {
        continue;
      }

      // Phase 2C: Safety recheck on acquisition (SR-C1)
      const eligibility = checkReuseEligibility(record, criteria, agentProfile, this.config);
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

  getWarmPoolSize(): number {
    return this.warmPoolManager.size();
  }

  // ====================
  // Phase 2C: Health Score Methods (FR-C6)
  // ====================

  updateHealthScore(sessionId: string, success: boolean): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    const current = record.healthScore || createInitialHealthScore();
    const updated = calculateHealthScore(
      current,
      success,
      this.config.minHealthScoreForReuse,
      this.config.maxErrorCountForReuse,
    );
    record.healthScore = updated;

    this.logger.debug('Health score updated', {
      sessionId,
      score: updated.score,
      errorCount: updated.errorCount,
      successCount: updated.successCount,
      isHealthy: updated.isHealthy,
    });

    // If became unhealthy, remove from warm pool
    if (!updated.isHealthy && record.inWarmPool) {
      this.removeFromWarmPool(sessionId);
    }
  }

  // ====================
  // Phase 2C: Transcript Index Methods (FR-C5)
  // ====================

  updateTranscriptIndex(
    sessionId: string,
    metadata: Partial<TranscriptIndexMetadata>,
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    const updated = updateTranscriptMetadata(record.transcriptIndex, metadata);
    record.transcriptIndex = updated;

    this.logger.debug('Transcript index updated', {
      sessionId,
      messageCount: updated.messageCount,
      toolCount: updated.toolCount,
      permissionRequestCount: updated.permissionRequestCount,
      keywordsCount: updated.summaryKeywords.length,
    });
  }

  getTranscriptIndex(sessionId: string): TranscriptIndexMetadata | undefined {
    const record = this.sessions.get(sessionId);
    return record?.transcriptIndex;
  }

  // ====================
  // Session Access Methods
  // ====================

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsForTask(taskId: string): SessionRecord[] {
    return Array.from(this.sessions.values()).filter(r => r.taskId === taskId);
  }

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

  // ====================
  // Statistics Methods
  // ====================

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
    this.stats.warmPoolSize = this.warmPoolManager.size();

    return {
      total: this.sessions.size,
      byState,
      leased,
      warmPool: this.warmPoolManager.size(),
      lifecycleStats: this.stats,
    };
  }

  getPhase2CStats(): {
    warmPoolSize: number;
    warmPoolHits: number;
    warmPoolMisses: number;
    reuseHitReasons: Record<ReuseHitReason, number>;
    reuseSkipReasons: Record<ReuseSkipReason, number>;
    avgHealthScore: number;
  } {
    return {
      warmPoolSize: this.warmPoolManager.size(),
      warmPoolHits: this.stats.warmPoolHits,
      warmPoolMisses: this.stats.warmPoolMisses,
      reuseHitReasons: { ...this.stats.reuseHitReasons },
      reuseSkipReasons: { ...this.stats.reuseSkipReasons },
      avgHealthScore: this.calculateAverageHealthScore(),
    };
  }

  private calculateAverageHealthScore(): number {
    let totalHealthScore = 0;
    let healthySessions = 0;
    for (const record of this.sessions.values()) {
      if (record.healthScore) {
        totalHealthScore += record.healthScore.score;
        healthySessions++;
      }
    }
    return healthySessions > 0 ? totalHealthScore / healthySessions : 100;
  }

  // ====================
  // Orphan Detection Methods
  // ====================

  findOrphanSessions(): SessionRecord[] {
    return findOrphanSessions(this.sessions.values(), this.config.leaseTtlMs);
  }

  processOrphans(): number {
    const orphans = this.findOrphanSessions();

    for (const record of orphans) {
      const reason = determineOrphanCleanupReason(record);
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

  // ====================
  // Cleanup Methods
  // ====================

  private startCleanup(): void {
    // Cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private startOrphanDetection(): void {
    this.orphanDetectionInterval = setInterval(() => {
      this.processOrphans();
    }, this.config.orphanDetectionIntervalMs);
  }

  private cleanup(): void {
    const expired = findExpiredSessions(this.sessions, this.config.sessionTtlMs);

    for (const { sessionId, reason } of expired) {
      const record = this.sessions.get(sessionId);
      if (record) {
        if (reason === 'ttl_expired') {
          record.state = 'expired';
          record.cleanupReason = reason;
        }
        this.stats.cleanupByReason[reason as CleanupReason] =
          (this.stats.cleanupByReason[reason as CleanupReason] || 0) + 1;
        this.stats.sessionsCleaned++;
      }
      this.sessions.delete(sessionId);
      this.logger.info('Session cleaned up', {
        sessionId,
        cleanupReason: record?.cleanupReason || reason,
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