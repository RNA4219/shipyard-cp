import type { BlockedContext } from '../../types.js';

export interface BaseShaCheckInput {
  original_base_sha: string | undefined;
  current_base_sha: string;
  integration_head_sha?: string;
  is_fast_forward?: boolean;
  has_conflicts?: boolean;
}

export interface BaseShaCheckResult {
  valid: boolean;
  can_proceed: boolean;
  reason?: 'base_sha_changed' | 'original_base_sha_missing' | 'conflicts_exist';
  needs_rebase?: boolean;
  can_fast_forward?: boolean;
  needs_merge?: boolean;
  has_conflicts?: boolean;
  action?: 'proceed' | 'rebase' | 'resolve_conflicts' | 'blocked';
}

export interface BlockedContextInput {
  reason: string;
  resume_state: 'integrating';
}

// SHA format: 7-40 hex characters
const SHA_PATTERN = /^[a-fA-F0-9]{7,40}$/;

export class BaseShaValidator {
  validateBaseSha(input: BaseShaCheckInput): BaseShaCheckResult {
    // Check if original base SHA exists
    if (!input.original_base_sha) {
      return {
        valid: false,
        can_proceed: false,
        reason: 'original_base_sha_missing',
        action: 'blocked',
      };
    }

    // Check for SHA change
    const shaChanged = input.original_base_sha !== input.current_base_sha;

    if (shaChanged) {
      const result: BaseShaCheckResult = {
        valid: false,
        can_proceed: false,
        reason: 'base_sha_changed',
        needs_rebase: true,
      };

      if (input.has_conflicts) {
        result.has_conflicts = true;
        result.action = 'resolve_conflicts';
      } else {
        result.action = 'rebase';
      }

      return result;
    }

    // SHA is unchanged
    const result: BaseShaCheckResult = {
      valid: true,
      can_proceed: true,
      needs_rebase: false,
      action: 'proceed',
    };

    // Check fast-forward status
    if (input.is_fast_forward !== undefined) {
      result.can_fast_forward = input.is_fast_forward;
      result.needs_merge = !input.is_fast_forward;
    }

    return result;
  }

  isValidShaFormat(sha: string): boolean {
    return SHA_PATTERN.test(sha);
  }

  getRebaseAction(input: BaseShaCheckInput): 'none' | 'rebase' | 'resolve_conflicts' {
    if (!input.original_base_sha || input.original_base_sha !== input.current_base_sha) {
      if (input.has_conflicts) {
        return 'resolve_conflicts';
      }
      return 'rebase';
    }
    return 'none';
  }

  generateBlockedContext(input: BlockedContextInput): Pick<BlockedContext, 'reason' | 'resume_state' | 'waiting_on'> {
    return {
      reason: input.reason,
      resume_state: input.resume_state,
      waiting_on: 'github',
    };
  }
}