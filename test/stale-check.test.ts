import { describe, it, expect } from 'vitest';
import { StaleDocsValidator, type StaleCheckInput, type StaleCheckResult } from '../src/domain/stale-check/index.js';

describe('StaleDocsValidator', () => {
  const validator = new StaleDocsValidator();

  describe('checkStale', () => {
    it('should return fresh when no stale status', () => {
      const input: StaleCheckInput = {
        stale_status: 'fresh',
        has_resolver_refs: true,
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(true);
      expect(result.action).toBe('proceed');
    });

    it('should return blocked for stale docs without re-read', () => {
      const input: StaleCheckInput = {
        stale_status: 'stale',
        has_resolver_refs: true,
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(false);
      expect(result.action).toBe('blocked');
      expect(result.reason).toBe('stale_docs_require_reread');
    });

    it('should return proceed for stale docs with fresh re-read', () => {
      const input: StaleCheckInput = {
        stale_status: 'stale',
        has_resolver_refs: true,
        reread_performed: true,
        reread_status: 'fresh',
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(true);
      expect(result.action).toBe('proceed');
    });

    it('should return rework for stale docs with stale re-read', () => {
      const input: StaleCheckInput = {
        stale_status: 'stale',
        has_resolver_refs: true,
        reread_performed: true,
        reread_status: 'stale',
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(false);
      expect(result.action).toBe('rework');
      expect(result.reason).toBe('docs_still_stale_after_reread');
    });
  });

  describe('stale detection by timestamps', () => {
    it('should detect stale when doc is older than threshold', () => {
      const now = new Date();
      const oldDoc = new Date(now.getTime() - 3600000); // 1 hour ago

      const input: StaleCheckInput = {
        stale_status: 'unknown',
        has_resolver_refs: true,
        doc_updated_at: oldDoc.toISOString(),
        check_performed_at: now.toISOString(),
        stale_threshold_seconds: 1800, // 30 minutes
      };

      const result = validator.checkStale(input);
      expect(result.detected_stale).toBe(true);
    });

    it('should not detect stale when doc is within threshold', () => {
      const now = new Date();
      const recentDoc = new Date(now.getTime() - 600000); // 10 minutes ago

      const input: StaleCheckInput = {
        stale_status: 'unknown',
        has_resolver_refs: true,
        doc_updated_at: recentDoc.toISOString(),
        check_performed_at: now.toISOString(),
        stale_threshold_seconds: 1800, // 30 minutes
      };

      const result = validator.checkStale(input);
      expect(result.detected_stale).toBe(false);
    });
  });

  describe('no resolver refs', () => {
    it('should proceed when no resolver refs', () => {
      const input: StaleCheckInput = {
        stale_status: 'unknown',
        has_resolver_refs: false,
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(true);
      expect(result.action).toBe('proceed');
    });
  });

  describe('blocking stage', () => {
    it('should block acceptance stage for stale docs', () => {
      const input: StaleCheckInput = {
        stale_status: 'stale',
        has_resolver_refs: true,
        current_stage: 'acceptance',
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(false);
    });

    it('should allow plan stage even with stale docs (will be resolved)', () => {
      const input: StaleCheckInput = {
        stale_status: 'stale',
        has_resolver_refs: true,
        current_stage: 'plan',
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(true);
      expect(result.action).toBe('resolve_first');
    });
  });

  describe('multiple docs', () => {
    it('should block if any doc is stale', () => {
      const input: StaleCheckInput = {
        stale_status: 'mixed',
        has_resolver_refs: true,
        doc_stale_counts: { fresh: 3, stale: 1, unknown: 0 },
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(false);
      expect(result.action).toBe('blocked');
    });

    it('should proceed if all docs are fresh', () => {
      const input: StaleCheckInput = {
        stale_status: 'fresh',
        has_resolver_refs: true,
        doc_stale_counts: { fresh: 5, stale: 0, unknown: 0 },
      };

      const result = validator.checkStale(input);
      expect(result.can_proceed).toBe(true);
    });
  });

  describe('getBlockedContext', () => {
    it('should generate blocked context for stale docs', () => {
      const context = validator.getBlockedContext({
        stale_reason: 'stale_docs_require_reread',
        waiting_on: 'resolver',
      });

      expect(context.reason).toBe('stale_docs_require_reread');
      expect(context.waiting_on).toBe('resolver');
    });
  });
});