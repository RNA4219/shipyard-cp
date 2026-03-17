import { describe, it, expect } from 'vitest';
import { ResolverService } from '../src/domain/resolver/resolver-service.js';

describe('ResolverService', () => {
  describe('resolveDocs', () => {
    it('should return feature docs when feature is specified', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', { feature: 'auth' });

      expect(result.doc_refs).toContain('doc:feature:auth');
      expect(result.chunk_refs).toContain('chunk:feature:auth:1');
    });

    it('should return topic docs when topic is specified', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', { topic: 'oauth' });

      expect(result.doc_refs).toContain('doc:topic:oauth');
    });

    it('should return task seed docs when task_seed is specified', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', { task_seed: 'task-123' });

      expect(result.doc_refs).toContain('doc:task:task-123');
    });

    it('should return multiple docs when feature and topic are specified', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', { feature: 'auth', topic: 'oauth' });

      expect(result.doc_refs).toContain('doc:feature:auth');
      expect(result.doc_refs).toContain('doc:topic:oauth');
    });

    it('should return default docs when no specific request', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', {});

      expect(result.doc_refs).toContain('doc:workflow-cookbook:blueprint');
    });

    it('should return fresh stale_status', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test', {});

      expect(result.stale_status).toBe('fresh');
    });

    it('should include typed_ref in response', () => {
      const result = ResolverService.resolveDocs('shipyard:task:github:test-001', {});

      expect(result.typed_ref).toBe('shipyard:task:github:test-001');
    });
  });

  describe('buildAckRef', () => {
    it('should build ack ref with all components', () => {
      const ackRef = ResolverService.buildAckRef('task_123', 'doc:feature:auth', 'v1');

      expect(ackRef).toBe('ack:task_123:doc:feature:auth:v1');
    });

    it('should handle doc_id with colons', () => {
      const ackRef = ResolverService.buildAckRef('task_123', 'doc:feature:auth:oauth', 'v2');

      expect(ackRef).toBe('ack:task_123:doc:feature:auth:oauth:v2');
    });
  });
});