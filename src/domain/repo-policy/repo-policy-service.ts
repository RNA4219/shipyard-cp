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

export interface IntegrationPolicyInput {
  policy: RepoPolicy;
  task_id: string;
  base_sha: string;
  integration_head_sha?: string;
  main_sha?: string;
  checks_passed: boolean;
}

export interface IntegrationPolicyResult {
  allowed: boolean;
  integration_branch: string;
  can_fast_forward: boolean;
  requires_pr: boolean;
  reason?: string;
}

export interface PublishPolicyInput {
  policy: RepoPolicy;
  actor: 'bot' | 'human';
  target_branch: string;
  checks_passed: boolean;
  is_fast_forward: boolean;
}

export interface PublishPolicyResult {
  allowed: boolean;
  strategy: 'direct_push' | 'pull_request' | 'fast_forward_only';
  reason?: string;
  warnings?: string[];
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

  /**
   * Validate integration policy for a task.
   * Determines if integration can proceed based on policy.
   */
  validateIntegrationPolicy(input: IntegrationPolicyInput): IntegrationPolicyResult {
    const { policy, task_id, base_sha, integration_head_sha, main_sha, checks_passed } = input;

    const integration_branch = this.getDefaultIntegrationBranch(policy, task_id);

    // Check if CI is required and passed
    if (policy.require_ci_pass && !checks_passed) {
      return {
        allowed: false,
        integration_branch,
        can_fast_forward: false,
        requires_pr: false,
        reason: 'CI checks must pass before integration',
      };
    }

    // Check if we can fast-forward
    // Fast-forward is possible if integration_head_sha is a descendant of main_sha
    const canFastForward = this.canFastForward(
      base_sha,
      integration_head_sha,
      main_sha
    );

    // Determine if PR is required based on strategy
    const requiresPr = policy.update_strategy === 'pull_request';

    return {
      allowed: true,
      integration_branch,
      can_fast_forward: canFastForward,
      requires_pr: requiresPr,
    };
  }

  /**
   * Validate publish policy for a task.
   * Determines if publish can proceed based on policy.
   */
  validatePublishPolicy(input: PublishPolicyInput): PublishPolicyResult {
    const { policy, actor, target_branch, checks_passed, is_fast_forward } = input;
    const warnings: string[] = [];

    // Check actor permission
    if (policy.main_push_actor !== 'any' && actor !== policy.main_push_actor) {
      return {
        allowed: false,
        strategy: policy.update_strategy,
        reason: `Only ${policy.main_push_actor} can push to ${target_branch}`,
      };
    }

    // Check CI requirement
    if (policy.require_ci_pass && !checks_passed) {
      return {
        allowed: false,
        strategy: policy.update_strategy,
        reason: 'CI checks must pass before publish',
      };
    }

    // Check if target is a protected branch
    const protectedBranches = policy.protected_branches ?? ['main'];
    const isProtected = this.isProtectedBranch(target_branch, protectedBranches);

    if (isProtected) {
      // For pull_request strategy, deny direct publish
      if (policy.update_strategy === 'pull_request') {
        return {
          allowed: false,
          strategy: 'pull_request',
          reason: 'PR required for protected branches',
          warnings: ['Create a PR instead of direct publish'],
        };
      }

      // For fast_forward_only, check if it's actually fast-forward
      if (policy.update_strategy === 'fast_forward_only' && !is_fast_forward) {
        return {
          allowed: false,
          strategy: 'fast_forward_only',
          reason: 'Only fast-forward pushes allowed to protected branches',
        };
      }

      warnings.push(`Publishing to protected branch: ${target_branch}`);
    }

    return {
      allowed: true,
      strategy: policy.update_strategy,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Check if fast-forward is possible.
   * This is a simplified check - in production, would use git operations.
   */
  private canFastForward(
    base_sha: string,
    integration_head_sha?: string,
    main_sha?: string
  ): boolean {
    // If we don't have the necessary SHAs, we can't determine fast-forward
    if (!integration_head_sha || !main_sha) {
      return false;
    }

    // Fast-forward is possible if:
    // 1. main_sha matches base_sha (no new commits on main), OR
    // 2. integration_head_sha is a descendant of main_sha
    // This is a simplified check - in production, use git merge-base
    return main_sha === base_sha;
  }

  /**
   * Get the default branch protection settings.
   */
  getDefaultBranchProtection(): string[] {
    return ['main', 'master'];
  }

  /**
   * Check if a merge method is allowed for the given policy.
   */
  isMergeAllowed(
    policy: RepoPolicy,
    target_branch: string
  ): { allowed: boolean; method?: 'merge' | 'squash' | 'rebase' } {
    const protectedBranches = policy.protected_branches ?? ['main'];
    const isProtected = this.isProtectedBranch(target_branch, protectedBranches);

    if (!isProtected) {
      return { allowed: true, method: 'merge' };
    }

    // Use first allowed method, or default to merge
    const methods = policy.allowed_merge_methods ?? ['merge'];
    return {
      allowed: methods.length > 0,
      method: methods[0] as 'merge' | 'squash' | 'rebase',
    };
  }
}