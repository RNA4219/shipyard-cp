import { describe, it, expect } from 'vitest';
import { BaseShaValidator, type BaseShaCheckInput, type BaseShaCheckResult } from '../src/domain/integration-check/index.js';

describe('BaseShaValidator', () => {
  const validator = new BaseShaValidator();

  const validSha = 'abc123def456789012345678901234567890abcd';

  describe('validateBaseSha', () => {
    it('should pass when base SHA is unchanged', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: validSha,
      };

      const result = validator.validateBaseSha(input);
      expect(result.valid).toBe(true);
      expect(result.can_proceed).toBe(true);
    });

    it('should fail when base SHA has changed', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: 'different' + validSha.slice(10),
      };

      const result = validator.validateBaseSha(input);
      expect(result.valid).toBe(false);
      expect(result.can_proceed).toBe(false);
      expect(result.reason).toBe('base_sha_changed');
    });

    it('should fail when original base SHA is missing', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: undefined as unknown as string,
        current_base_sha: validSha,
      };

      const result = validator.validateBaseSha(input);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('original_base_sha_missing');
    });
  });

  describe('SHA format validation', () => {
    it('should validate SHA format (40 hex chars)', () => {
      expect(validator.isValidShaFormat('abc123def456789012345678901234567890abcd')).toBe(true);
    });

    it('should validate SHA format (7 hex chars minimum)', () => {
      expect(validator.isValidShaFormat('abc123d')).toBe(true);
    });

    it('should reject invalid SHA format', () => {
      expect(validator.isValidShaFormat('not-a-sha')).toBe(false);
    });

    it('should reject too short SHA', () => {
      expect(validator.isValidShaFormat('abc')).toBe(false);
    });

    it('should reject SHA with non-hex chars', () => {
      expect(validator.isValidShaFormat('g' + validSha.slice(1))).toBe(false);
    });
  });

  describe('rebase detection', () => {
    it('should detect rebase needed', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: 'different' + validSha.slice(10),
        integration_head_sha: validSha,
      };

      const result = validator.validateBaseSha(input);
      expect(result.needs_rebase).toBe(true);
    });

    it('should not need rebase when SHAs match', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: validSha,
        integration_head_sha: validSha,
      };

      const result = validator.validateBaseSha(input);
      expect(result.needs_rebase).toBe(false);
    });
  });

  describe('fast-forward check', () => {
    it('should detect fast-forward possible', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: validSha,
        integration_head_sha: validSha,
        is_fast_forward: true,
      };

      const result = validator.validateBaseSha(input);
      expect(result.can_fast_forward).toBe(true);
    });

    it('should require merge when not fast-forward', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: validSha,
        integration_head_sha: validSha,
        is_fast_forward: false,
      };

      const result = validator.validateBaseSha(input);
      expect(result.can_fast_forward).toBe(false);
      expect(result.needs_merge).toBe(true);
    });
  });

  describe('conflict detection', () => {
    it('should detect potential conflicts', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: 'different' + validSha.slice(10),
        integration_head_sha: validSha,
        has_conflicts: true,
      };

      const result = validator.validateBaseSha(input);
      expect(result.has_conflicts).toBe(true);
      expect(result.action).toBe('resolve_conflicts');
    });
  });

  describe('generateBlockedContext', () => {
    it('should generate blocked context for SHA change', () => {
      const context = validator.generateBlockedContext({
        reason: 'base_sha_changed',
        resume_state: 'integrating',
      });

      expect(context.reason).toBe('base_sha_changed');
      expect(context.resume_state).toBe('integrating');
      expect(context.waiting_on).toBe('github');
    });
  });

  describe('getRebaseAction', () => {
    it('should return rebase action when SHA changed', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: 'different' + validSha.slice(10),
      };

      const action = validator.getRebaseAction(input);
      expect(action).toBe('rebase');
    });

    it('should return none when SHA unchanged', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: validSha,
      };

      const action = validator.getRebaseAction(input);
      expect(action).toBe('none');
    });

    it('should return conflict when conflicts exist', () => {
      const input: BaseShaCheckInput = {
        original_base_sha: validSha,
        current_base_sha: 'different' + validSha.slice(10),
        has_conflicts: true,
      };

      const action = validator.getRebaseAction(input);
      expect(action).toBe('resolve_conflicts');
    });
  });
});