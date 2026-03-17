import { describe, it, expect } from 'vitest';
import { RepoPolicyService, type RepoPolicyCheckInput } from '../src/domain/repo-policy/index.js';
import type { RepoPolicy } from '../../src/types.js';

describe('RepoPolicyService', () => {
  const service = new RepoPolicyService();

  const defaultPolicy: RepoPolicy = {
    update_strategy: 'fast_forward_only',
    main_push_actor: 'bot',
    require_ci_pass: true,
  };

  describe('validatePush', () => {
    it('should allow bot push with bot policy', () => {
      const result = service.validatePush({
        policy: defaultPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny human push with bot-only policy', () => {
      const result = service.validatePush({
        policy: defaultPolicy,
        actor: 'human',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('human_push_not_allowed');
    });

    it('should allow any actor with any policy', () => {
      const policy: RepoPolicy = {
        ...defaultPolicy,
        main_push_actor: 'any',
      };

      const result = service.validatePush({
        policy,
        actor: 'human',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny push without CI pass when required', () => {
      const result = service.validatePush({
        policy: defaultPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: false,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ci_not_passed');
    });

    it('should allow push without CI pass when not required', () => {
      const policy: RepoPolicy = {
        ...defaultPolicy,
        require_ci_pass: false,
      };

      const result = service.validatePush({
        policy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: false,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('fast_forward_only strategy', () => {
    it('should allow fast-forward push', () => {
      const result = service.validatePush({
        policy: defaultPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny non-fast-forward push', () => {
      const result = service.validatePush({
        policy: defaultPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: false,
        ci_passed: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_fast_forward');
    });
  });

  describe('direct_push strategy', () => {
    const directPushPolicy: RepoPolicy = {
      update_strategy: 'direct_push',
      main_push_actor: 'bot',
      require_ci_pass: true,
    };

    it('should allow any push method', () => {
      const result = service.validatePush({
        policy: directPushPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: false,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('pull_request strategy', () => {
    const prPolicy: RepoPolicy = {
      update_strategy: 'pull_request',
      main_push_actor: 'bot',
      require_ci_pass: true,
    };

    it('should deny direct push to main', () => {
      const result = service.validatePush({
        policy: prPolicy,
        actor: 'bot',
        target_branch: 'main',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('pr_required');
    });

    it('should allow push to non-protected branch', () => {
      const result = service.validatePush({
        policy: prPolicy,
        actor: 'bot',
        target_branch: 'feature/test',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('protected branches', () => {
    const policyWithProtected: RepoPolicy = {
      ...defaultPolicy,
      protected_branches: ['main', 'release/*'],
    };

    it('should deny push to protected branch pattern', () => {
      const result = service.validatePush({
        policy: policyWithProtected,
        actor: 'bot',
        target_branch: 'release/v1.0',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('protected_branch');
    });

    it('should allow push to non-protected branch', () => {
      const result = service.validatePush({
        policy: policyWithProtected,
        actor: 'bot',
        target_branch: 'feature/test',
        is_fast_forward: true,
        ci_passed: true,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('getDefaultIntegrationBranch', () => {
    it('should return default prefix when not configured', () => {
      const branch = service.getDefaultIntegrationBranch(defaultPolicy, 'task_123');
      expect(branch).toBe('cp/integrate/task_123');
    });

    it('should use custom prefix when configured', () => {
      const policy: RepoPolicy = {
        ...defaultPolicy,
        integration_branch_prefix: 'auto/',
      };

      const branch = service.getDefaultIntegrationBranch(policy, 'task_123');
      expect(branch).toBe('auto/task_123');
    });
  });

  describe('canMergeMethod', () => {
    it('should allow default merge methods when not restricted', () => {
      expect(service.canMergeMethod(defaultPolicy, 'merge')).toBe(true);
      expect(service.canMergeMethod(defaultPolicy, 'squash')).toBe(true);
      expect(service.canMergeMethod(defaultPolicy, 'rebase')).toBe(true);
    });

    it('should restrict to allowed methods only', () => {
      const policy: RepoPolicy = {
        ...defaultPolicy,
        allowed_merge_methods: ['squash'],
      };

      expect(service.canMergeMethod(policy, 'squash')).toBe(true);
      expect(service.canMergeMethod(policy, 'merge')).toBe(false);
      expect(service.canMergeMethod(policy, 'rebase')).toBe(false);
    });
  });
});