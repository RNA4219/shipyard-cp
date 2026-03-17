import { describe, it, expect } from 'vitest';
import { ResolverService, type DocVersionInfo } from '../src/domain/resolver/resolver-service.js';
import type { ResolverRefs } from '../src/types.js';

describe('ResolverService', () => {
  describe('resolveDocs', () => {
    it('should return feature docs when feature is specified', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', { feature: 'auth' });

      expect(result.doc_refs).toContain('doc:feature:auth');
      expect(result.chunk_refs).toContain('chunk:feature:auth:1');
    });

    it('should return topic docs when topic is specified', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', { topic: 'oauth' });

      expect(result.doc_refs).toContain('doc:topic:oauth');
    });

    it('should return task seed docs when task_seed is specified', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', { task_seed: 'task-123' });

      expect(result.doc_refs).toContain('doc:task:task-123');
    });

    it('should return multiple docs when feature and topic are specified', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', { feature: 'auth', topic: 'oauth' });

      expect(result.doc_refs).toContain('doc:feature:auth');
      expect(result.doc_refs).toContain('doc:topic:oauth');
    });

    it('should return default docs when no specific request', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', {});

      expect(result.doc_refs).toContain('doc:workflow-cookbook:blueprint');
    });

    it('should return fresh stale_status', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test', {});

      expect(result.stale_status).toBe('fresh');
    });

    it('should include typed_ref in response', () => {
      const result = ResolverService.resolveDocs('agent-taskstate:task:github:test-001', {});

      expect(result.typed_ref).toBe('agent-taskstate:task:github:test-001');
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

  describe('checkStale', () => {
    it('should return empty stale list when no ack_refs', () => {
      const response = ResolverService.checkStale(
        'task_123',
        undefined,
        {},
        () => [],
      );

      expect(response.task_id).toBe('task_123');
      expect(response.stale).toEqual([]);
    });

    it('should return empty stale list when ack_refs is empty', () => {
      const resolverRefs: ResolverRefs = { ack_refs: [] };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        () => [],
      );

      expect(response.stale).toEqual([]);
    });

    it('should detect version mismatch', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: ['ack:task_123:doc:feature:auth:2026-03-01'],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: '2026-03-10',
          exists: true,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        getCurrentVersions,
      );

      expect(response.stale.length).toBe(1);
      expect(response.stale[0].doc_id).toBe('doc:feature:auth');
      expect(response.stale[0].previous_version).toBe('2026-03-01');
      expect(response.stale[0].current_version).toBe('2026-03-10');
      expect(response.stale[0].reason).toBe('version_mismatch');
    });

    it('should detect document_missing', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: ['ack:task_123:doc:feature:auth:v1'],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: 'missing',
          exists: false,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        getCurrentVersions,
      );

      expect(response.stale.length).toBe(1);
      expect(response.stale[0].reason).toBe('document_missing');
    });

    it('should return no stale when versions match', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: ['ack:task_123:doc:feature:auth:2026-03-10'],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: '2026-03-10',
          exists: true,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        getCurrentVersions,
      );

      expect(response.stale).toEqual([]);
    });

    it('should check only specified doc_ids when provided', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: [
          'ack:task_123:doc:feature:auth:v1',
          'ack:task_123:doc:feature:oauth:v1',
        ],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: 'v2',
          exists: true,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        { doc_ids: ['doc:feature:auth'] },
        getCurrentVersions,
      );

      // Only check doc:feature:auth, not doc:feature:oauth
      expect(response.stale.length).toBe(1);
      expect(response.stale[0].doc_id).toBe('doc:feature:auth');
    });

    it('should handle multiple stale documents', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: [
          'ack:task_123:doc:feature:auth:v1',
          'ack:task_123:doc:feature:oauth:v1',
          'ack:task_123:doc:feature:login:v1',
        ],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: docId.includes('oauth') ? 'v1' : 'v2', // oauth is fresh
          exists: true,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        getCurrentVersions,
      );

      expect(response.stale.length).toBe(2);
      const staleDocIds = response.stale.map(s => s.doc_id);
      expect(staleDocIds).toContain('doc:feature:auth');
      expect(staleDocIds).toContain('doc:feature:login');
      expect(staleDocIds).not.toContain('doc:feature:oauth');
    });

    it('should include detected_at timestamp', () => {
      const resolverRefs: ResolverRefs = {
        ack_refs: ['ack:task_123:doc:feature:auth:v1'],
      };

      const getCurrentVersions = (docIds: string[]): DocVersionInfo[] => {
        return docIds.map(docId => ({
          doc_id: docId,
          version: 'v2',
          exists: true,
        }));
      };

      const response = ResolverService.checkStale(
        'task_123',
        resolverRefs,
        {},
        getCurrentVersions,
      );

      expect(response.stale[0].detected_at).toBeDefined();
      expect(new Date(response.stale[0].detected_at).toISOString()).toBe(response.stale[0].detected_at);
    });
  });
});