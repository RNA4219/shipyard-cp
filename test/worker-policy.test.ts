import { describe, it, expect } from 'vitest';
import { WorkerPolicy } from '../src/domain/worker/worker-policy.js';
import type { RiskLevel, WorkerStage, WorkerType } from '../src/types.js';

describe('WorkerPolicy', () => {
  describe('getDefaultWorker', () => {
    it('should return codex for plan stage', () => {
      expect(WorkerPolicy.getDefaultWorker('plan')).toBe('codex');
    });

    it('should return codex for dev stage', () => {
      expect(WorkerPolicy.getDefaultWorker('dev')).toBe('codex');
    });

    it('should return claude_code for acceptance stage', () => {
      expect(WorkerPolicy.getDefaultWorker('acceptance')).toBe('claude_code');
    });
  });

  describe('buildApprovalPolicy', () => {
    it('should return deny mode for plan stage', () => {
      const policy = WorkerPolicy.buildApprovalPolicy('plan', 'medium');

      expect(policy.mode).toBe('deny');
      expect(policy.sandbox_profile).toBe('read_only');
      expect(policy.operator_approval_required).toBe(false);
    });

    it('should require approval for high risk dev stage', () => {
      const policy = WorkerPolicy.buildApprovalPolicy('dev', 'high');

      expect(policy.mode).toBe('ask');
      expect(policy.operator_approval_required).toBe(true);
      expect(policy.sandbox_profile).toBe('workspace_write');
      expect(policy.allowed_side_effect_categories).toContain('network_access');
    });

    it('should not require approval for medium risk dev stage', () => {
      const policy = WorkerPolicy.buildApprovalPolicy('dev', 'medium');

      expect(policy.mode).toBe('ask');
      expect(policy.operator_approval_required).toBe(false);
      expect(policy.sandbox_profile).toBe('workspace_write');
    });

    it('should require approval for high risk acceptance stage', () => {
      const policy = WorkerPolicy.buildApprovalPolicy('acceptance', 'high');

      expect(policy.operator_approval_required).toBe(true);
    });
  });

  describe('getCapabilityRequirements', () => {
    it('should return plan capability for plan stage', () => {
      const caps = WorkerPolicy.getCapabilityRequirements('plan');

      expect(caps).toContain('plan');
      expect(caps).not.toContain('edit_repo');
    });

    it('should return edit_repo and run_tests for dev stage', () => {
      const caps = WorkerPolicy.getCapabilityRequirements('dev');

      expect(caps).toContain('edit_repo');
      expect(caps).toContain('run_tests');
      expect(caps).toContain('produces_patch');
    });

    it('should return run_tests and produces_verdict for acceptance stage', () => {
      const caps = WorkerPolicy.getCapabilityRequirements('acceptance');

      expect(caps).toContain('run_tests');
      expect(caps).toContain('produces_verdict');
    });
  });

  describe('getRequestedOutputs', () => {
    it('should return plan_notes and artifacts for plan stage', () => {
      const outputs = WorkerPolicy.getRequestedOutputs('plan');

      expect(outputs).toContain('plan_notes');
      expect(outputs).toContain('artifacts');
    });

    it('should return patch, tests, artifacts for dev stage', () => {
      const outputs = WorkerPolicy.getRequestedOutputs('dev');

      expect(outputs).toContain('patch');
      expect(outputs).toContain('tests');
      expect(outputs).toContain('artifacts');
    });

    it('should return verdict, tests, artifacts for acceptance stage', () => {
      const outputs = WorkerPolicy.getRequestedOutputs('acceptance');

      expect(outputs).toContain('verdict');
      expect(outputs).toContain('tests');
      expect(outputs).toContain('artifacts');
    });
  });

  describe('canFailover', () => {
    it('should return true for plan stage', () => {
      expect(WorkerPolicy.canFailover('plan')).toBe(true);
    });

    it('should return false for dev stage', () => {
      expect(WorkerPolicy.canFailover('dev')).toBe(false);
    });

    it('should return false for acceptance stage', () => {
      expect(WorkerPolicy.canFailover('acceptance')).toBe(false);
    });
  });

  describe('getFailoverWorker', () => {
    it('should return claude_code when failing over from codex in plan stage', () => {
      const nextWorker = WorkerPolicy.getFailoverWorker('plan', 'codex');
      expect(nextWorker).toBe('claude_code');
    });

    it('should return google_antigravity when failing over from claude_code in plan stage', () => {
      const nextWorker = WorkerPolicy.getFailoverWorker('plan', 'claude_code');
      expect(nextWorker).toBe('google_antigravity');
    });

    it('should return null when failing over from google_antigravity in plan stage (end of chain)', () => {
      const nextWorker = WorkerPolicy.getFailoverWorker('plan', 'google_antigravity');
      expect(nextWorker).toBeNull();
    });

    it('should return null for dev stage (no failover)', () => {
      const nextWorker = WorkerPolicy.getFailoverWorker('dev', 'codex');
      expect(nextWorker).toBeNull();
    });

    it('should return null for acceptance stage (no failover)', () => {
      const nextWorker = WorkerPolicy.getFailoverWorker('acceptance', 'claude_code');
      expect(nextWorker).toBeNull();
    });

    it('should return null when current worker is not in failover chain', () => {
      // codex is in the chain, but if we try with a worker not in the chain
      // For plan stage, all known workers are in the chain, so this tests
      // the edge case where the worker is not found
      const nextWorker = WorkerPolicy.getFailoverWorker('plan', 'unknown_worker' as WorkerType);
      expect(nextWorker).toBeNull();
    });
  });
});