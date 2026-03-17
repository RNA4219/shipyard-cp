import type { BlockedContext } from '../../types.js';

export interface StaleCheckInput {
  stale_status: 'fresh' | 'stale' | 'unknown' | 'mixed';
  has_resolver_refs: boolean;
  current_stage?: 'plan' | 'dev' | 'acceptance';
  reread_performed?: boolean;
  reread_status?: 'fresh' | 'stale' | 'unknown';
  doc_updated_at?: string;
  check_performed_at?: string;
  stale_threshold_seconds?: number;
  doc_stale_counts?: { fresh: number; stale: number; unknown: number };
}

export interface StaleCheckResult {
  can_proceed: boolean;
  action: 'proceed' | 'blocked' | 'rework' | 'resolve_first';
  reason?: string;
  detected_stale?: boolean;
}

export interface BlockedContextInput {
  stale_reason: string;
  waiting_on: 'resolver' | 'human';
}

// Default stale threshold: 30 minutes
const DEFAULT_STALE_THRESHOLD_SECONDS = 1800;

export class StaleDocsValidator {
  checkStale(input: StaleCheckInput): StaleCheckResult {
    // No resolver refs means no docs to check
    if (!input.has_resolver_refs) {
      return { can_proceed: true, action: 'proceed' };
    }

    // Plan stage can proceed but should resolve first
    if (input.current_stage === 'plan') {
      if (input.stale_status === 'stale' || input.stale_status === 'mixed') {
        return { can_proceed: true, action: 'resolve_first' };
      }
      return { can_proceed: true, action: 'proceed' };
    }

    // Check for timestamp-based staleness
    if (input.stale_status === 'unknown' && input.doc_updated_at && input.check_performed_at) {
      const detectedStale = this.detectStaleByTimestamp(
        input.doc_updated_at,
        input.check_performed_at,
        input.stale_threshold_seconds ?? DEFAULT_STALE_THRESHOLD_SECONDS,
      );

      if (detectedStale) {
        return {
          can_proceed: false,
          action: 'blocked',
          reason: 'stale_docs_require_reread',
          detected_stale: true,
        };
      }

      return { can_proceed: true, action: 'proceed', detected_stale: false };
    }

    // Fresh docs can proceed
    if (input.stale_status === 'fresh') {
      return { can_proceed: true, action: 'proceed' };
    }

    // Check if there are any stale docs in mixed status
    if (input.stale_status === 'mixed' && input.doc_stale_counts) {
      if (input.doc_stale_counts.stale > 0) {
        return {
          can_proceed: false,
          action: 'blocked',
          reason: 'stale_docs_require_reread',
        };
      }
    }

    // Stale docs need re-read
    if (input.stale_status === 'stale' || input.stale_status === 'mixed') {
      // Check if re-read was performed
      if (input.reread_performed) {
        if (input.reread_status === 'fresh') {
          return { can_proceed: true, action: 'proceed' };
        }
        if (input.reread_status === 'stale') {
          return {
            can_proceed: false,
            action: 'rework',
            reason: 'docs_still_stale_after_reread',
          };
        }
      }

      return {
        can_proceed: false,
        action: 'blocked',
        reason: 'stale_docs_require_reread',
      };
    }

    // Unknown status needs to be resolved
    if (input.stale_status === 'unknown') {
      return {
        can_proceed: false,
        action: 'blocked',
        reason: 'stale_status_unknown',
      };
    }

    return { can_proceed: true, action: 'proceed' };
  }

  getBlockedContext(input: BlockedContextInput): Pick<BlockedContext, 'reason' | 'waiting_on'> {
    return {
      reason: input.stale_reason,
      waiting_on: input.waiting_on,
    };
  }

  private detectStaleByTimestamp(
    docUpdatedAt: string,
    checkPerformedAt: string,
    thresholdSeconds: number,
  ): boolean {
    const docTime = new Date(docUpdatedAt).getTime();
    const checkTime = new Date(checkPerformedAt).getTime();
    const ageSeconds = (checkTime - docTime) / 1000;

    return ageSeconds > thresholdSeconds;
  }
}