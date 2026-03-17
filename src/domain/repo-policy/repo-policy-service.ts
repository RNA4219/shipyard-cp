import type { RepoPolicy } from '../../types.js';

export interface RepoPolicyCheckInput {
  policy: RepoPolicy;
  actor: 'bot' | 'human';
  target_branch: string;
  is_fast_forward: boolean;
  ci_passed: boolean;
}

export interface RepoPolicyCheckResult {
  allowed: boolean;
  reason?: 'human_push_not_allowed' | 'ci_not_passed' | 'not_fast_forward' | 'pr_required' | 'protected_branch';
}

const DEFAULT_INTEGRATION_BRANCH_PREFIX = 'cp/integrate/';

export class RepoPolicyService {
  validatePush(input: RepoPolicyCheckInput): RepoPolicyCheckResult {
    const { policy, actor, target_branch, is_fast_forward, ci_passed } = input;

    // Check actor permission
    if (policy.main_push_actor !== 'any' && actor !== policy.main_push_actor) {
      return { allowed: false, reason: 'human_push_not_allowed' };
    }

    // Check CI requirement
    if (policy.require_ci_pass && !ci_passed) {
      return { allowed: false, reason: 'ci_not_passed' };
    }

    // Check if target is a protected branch
    const protectedBranches = policy.protected_branches ?? ['main'];
    const isProtected = this.isProtectedBranch(target_branch, protectedBranches);

    // For pull_request strategy, deny direct push to protected branches
    if (policy.update_strategy === 'pull_request' && isProtected) {
      return { allowed: false, reason: 'pr_required' };
    }

    // For protected branches, check strategy constraints
    if (isProtected) {
      // Check fast-forward requirement
      if (policy.update_strategy === 'fast_forward_only' && !is_fast_forward) {
        return { allowed: false, reason: 'not_fast_forward' };
      }

      // Check if branch is explicitly protected
      if (policy.protected_branches && policy.protected_branches.length > 0) {
        return { allowed: false, reason: 'protected_branch' };
      }
    }

    return { allowed: true };
  }

  getDefaultIntegrationBranch(policy: RepoPolicy, taskId: string): string {
    const prefix = policy.integration_branch_prefix ?? DEFAULT_INTEGRATION_BRANCH_PREFIX;
    return `${prefix}${taskId}`;
  }

  canMergeMethod(policy: RepoPolicy, method: 'merge' | 'squash' | 'rebase'): boolean {
    if (!policy.allowed_merge_methods) {
      return true; // All methods allowed by default
    }
    return policy.allowed_merge_methods.includes(method);
  }

  private isProtectedBranch(branch: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern.includes('*')) {
        // Simple glob pattern matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(branch);
      }
      return branch === pattern;
    });
  }
}