/**
 * Session Registry Types
 *
 * Type definitions for OpenCode session registry.
 * Phase 2B: Enhanced orphan detection and cleanup with reason tracking.
 * Phase 2C: Agent-aware session policy, warm pool, reuse ranking, transcript indexing.
 */

import type { WorkerType, WorkerJob } from '../../types.js';
import type { CleanupReason } from './opencode-event-ingestor.js';

/**
 * Agent profile types for Phase 2C (FR-C1).
 * Determines the kind of work a session is optimized for.
 */
export type AgentProfile = 'planning-oriented' | 'build-oriented' | 'verification-oriented';

/**
 * Reuse skip reason for Phase 2C observability (OR-C2).
 */
export type ReuseSkipReason =
  | 'agent_profile_mismatch'
  | 'stage_bucket_mismatch'
  | 'policy_fingerprint_mismatch'
  | 'workspace_mismatch'
  | 'task_mismatch'
  | 'already_leased'
  | 'state_not_ready'
  | 'ttl_expired'
  | 'health_score_low'
  | 'error_history_high';

/**
 * Reuse hit reason for Phase 2C observability (OR-C2).
 */
export type ReuseHitReason =
  | 'same_stage_same_agent'
  | 'warm_pool_match'
  | 'fresh_idle_match';

/**
 * Transcript indexing metadata for Phase 2C (FR-C5).
 * Internal artifact, not exposed in public API.
 */
export interface TranscriptIndexMetadata {
  /** Number of messages in transcript */
  messageCount: number;
  /** Number of tool invocations */
  toolCount: number;
  /** Number of permission requests */
  permissionRequestCount: number;
  /** Keywords extracted from transcript summary */
  summaryKeywords: string[];
  /** Last N tool names used */
  lastToolNames: string[];
  /** Transcript size in bytes */
  transcriptSizeBytes?: number;
  /** Last updated timestamp */
  lastUpdated?: number;
}

/**
 * Session health score for Phase 2C (FR-C6).
 */
export interface SessionHealthScore {
  /** Overall health score (0-100) */
  score: number;
  /** Number of errors encountered in this session */
  errorCount: number;
  /** Number of successful operations */
  successCount: number;
  /** Whether session is considered healthy for reuse */
  isHealthy: boolean;
  /** Last calculated timestamp */
  lastCalculated: number;
}

export interface SessionRecord {
  /** OpenCode session ID */
  sessionId: string;
  /** Task ID this session belongs to */
  taskId: string;
  /** Workspace reference */
  workspaceRef: {
    kind: string;
    workspace_id: string;
  };
  /** Logical worker type */
  logicalWorker: WorkerType;
  /** Stage bucket (plan/dev/acceptance) */
  stageBucket: 'plan' | 'dev' | 'acceptance';
  /** Policy fingerprint for reuse eligibility */
  policyFingerprint: string;
  /** Agent profile for Phase 2C (FR-C1) */
  agentProfile: AgentProfile;
  /** Session state */
  state: 'initializing' | 'ready' | 'active' | 'idle' | 'draining' | 'dead' | 'expired';
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Last used timestamp (when session was leased) */
  lastUsedAt?: number;
  /** Current lease holder (job_id) if leased */
  leasedBy?: string;
  /** Lease expiration timestamp if leased */
  leaseExpiresAt?: number;
  /** Server base URL */
  serverBaseUrl: string;
  /** Error message if state is dead */
  error?: string;
  /** Cleanup reason (Phase 2B) */
  cleanupReason?: CleanupReason;
  /** Server instance ID if available */
  serverInstanceId?: string;
  /** Transcript indexing metadata (Phase 2C, FR-C5) */
  transcriptIndex?: TranscriptIndexMetadata;
  /** Health score (Phase 2C, FR-C6) */
  healthScore?: SessionHealthScore;
  /** Whether session is in warm pool (Phase 2C) */
  inWarmPool?: boolean;
  /** Warm pool entry timestamp */
  warmPoolEntryAt?: number;
}

export interface SessionSearchCriteria {
  taskId: string;
  workspaceRef: {
    kind: string;
    workspace_id: string;
  };
  logicalWorker: WorkerType;
  stageBucket: 'plan' | 'dev' | 'acceptance';
  policyFingerprint: string;
  /** Agent profile for Phase 2C matching (optional, defaults to build-oriented) */
  agentProfile?: AgentProfile;
}

export interface SessionRegistryConfig {
  /** Session TTL in milliseconds */
  sessionTtlMs: number;
  /** Lease TTL in milliseconds */
  leaseTtlMs: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Orphan detection interval in milliseconds */
  orphanDetectionIntervalMs?: number;
  /** Phase 2C: Enable warm pool */
  enableWarmPool?: boolean;
  /** Phase 2C: Minimum health score for reuse (default: 50) */
  minHealthScoreForReuse?: number;
  /** Phase 2C: Maximum error count for reuse (default: 3) */
  maxErrorCountForReuse?: number;
}

/**
 * Cleanup reason enum for categorization (Phase 2B: FR-B6).
 */
export const CleanupReasons: Record<string, CleanupReason> = {
  TASK_COMPLETED: 'task_completed',
  TASK_CANCELLED: 'task_cancelled',
  TASK_FAILED: 'task_failed',
  TIMEOUT: 'timeout',
  SERVER_CRASH: 'server_crash',
  POLICY_MISMATCH: 'policy_mismatch',
  TTL_EXPIRED: 'ttl_expired',
  MANUAL_CLEANUP: 'manual_cleanup',
  ORPHAN_DETECTED: 'orphan_detected',
  LEASE_EXPIRED: 'lease_expired',
};

/**
 * Session registry statistics type.
 * Phase 2C: Added warm pool and reuse ranking stats.
 */
export interface SessionRegistryStats {
  sessionsCreated: number;
  sessionsReused: number;
  sessionsCleaned: number;
  orphansDetected: number;
  cleanupByReason: Record<CleanupReason, number>;
  /** Phase 2C: Warm pool stats */
  warmPoolSize: number;
  warmPoolHits: number;
  warmPoolMisses: number;
  /** Phase 2C: Reuse ranking stats */
  reuseHitReasons: Record<ReuseHitReason, number>;
  reuseSkipReasons: Record<ReuseSkipReason, number>;
}

/**
 * Generate policy fingerprint from job approval policy.
 */
export function generatePolicyFingerprint(job: WorkerJob): string {
  const policy = job.approval_policy;
  const parts = [
    policy.mode,
    (policy.allowed_side_effect_categories || []).sort().join(','),
    policy.sandbox_profile || '',
    JSON.stringify(job.workspace_ref),
  ];
  return parts.join('|');
}

/**
 * Determine agent profile from job stage (Phase 2C, FR-C1).
 * - plan stage -> planning-oriented
 * - dev stage -> build-oriented
 * - acceptance stage -> verification-oriented
 */
export function determineAgentProfile(stage: 'plan' | 'dev' | 'acceptance'): AgentProfile {
  switch (stage) {
    case 'plan':
      return 'planning-oriented';
    case 'dev':
      return 'build-oriented';
    case 'acceptance':
      return 'verification-oriented';
    default:
      return 'build-oriented';
  }
}