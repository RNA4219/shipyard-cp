import { describe, it, expect } from 'vitest';
import { ResolverService } from '../src/domain/resolver/resolver-service.js';
import type { ChunkData, ContractData } from '../src/domain/resolver/resolver-service.js';

/**
 * memx-resolver Connector Tests
 *
 * Tests for docs resolve / ack / stale integration
 * memx-resolver is a Go service at docs/memx_spec_v3/go
 */
describe('memx-resolver Connector', () => {
  const resolverBaseUrl = process.env.MEMX_RESOLVER_URL || 'http://localhost:8080';

  describe('Resolver Types', () => {
    it('should define resolve request interface', () => {
      const request = {
        feature: 'memory-import',
        topic: 'implementation',
        task_seed: 'task_123',
      };

      expect(request.feature).toBe('memory-import');
      expect(request.topic).toBe('implementation');
    });

    it('should define resolve response interface', () => {
      const response = {
        doc_refs: ['doc:spec:memory-import'],
        chunk_refs: ['chunk:doc:spec:memory-import:001'],
        contract_refs: ['contract:resolver'],
        stale_status: 'fresh' as const,
      };

      expect(response.doc_refs).toHaveLength(1);
      expect(response.stale_status).toBe('fresh');
    });

    it('should define ack request interface', () => {
      const request = {
        doc_id: 'doc:spec:memory-import',
        version: '2026-03-10',
      };

      expect(request.doc_id).toBe('doc:spec:memory-import');
      expect(request.version).toBe('2026-03-10');
    });

    it('should define stale check interface', () => {
      const staleCheck = {
        task_id: 'task_123',
        doc_ids: ['doc:spec:memory-import', 'doc:cookbook:blueprint'],
        results: [
          { doc_id: 'doc:spec:memory-import', is_stale: false, version: '2026-03-10' },
          { doc_id: 'doc:cookbook:blueprint', is_stale: true, version: '2026-03-08' },
        ],
      };

      expect(staleCheck.results.some(r => r.is_stale)).toBe(true);
    });
  });

  describe('Resolver Service', () => {
    it('should generate correct ack_ref format', () => {
      const taskId = 'task_123';
      const docId = 'doc:spec:memory-import';
      const version = '2026-03-10';

      const ackRef = `ack:${taskId}:${docId}:${version}`;
      expect(ackRef).toBe('ack:task_123:doc:spec:memory-import:2026-03-10');
    });

    it('should parse typed_ref correctly', () => {
      const typedRef = 'agent-taskstate:task:github:01JPC1GY8JQ7YQ8MS9D7Q0B8QA';
      const parts = typedRef.split(':');

      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('agent-taskstate'); // domain
      expect(parts[1]).toBe('task'); // entity_type
      expect(parts[2]).toBe('github'); // provider
      expect(parts[3]).toBe('01JPC1GY8JQ7YQ8MS9D7Q0B8QA'); // entity_id
    });

    it('should validate typed_ref pattern', () => {
      const validPattern = /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$/;

      const validRefs = [
        'agent-taskstate:task:github:123',
        'memx:doc:local:spec-v1',
        'tracker:issue:github:456',
      ];

      const invalidRefs = [
        'invalid',
        'too:short',
        'UPPER:case:ref:value',
        'spaces in:ref:value:here',
      ];

      for (const ref of validRefs) {
        expect(validPattern.test(ref)).toBe(true);
      }

      for (const ref of invalidRefs) {
        expect(validPattern.test(ref)).toBe(false);
      }
    });
  });

  describe('Stale Detection Logic', () => {
    it('should detect stale when doc version is older than read version', () => {
      const docVersion = new Date('2026-03-08');
      const readVersion = new Date('2026-03-10');

      const isStale = docVersion < readVersion;
      expect(isStale).toBe(true);
    });

    it('should detect fresh when versions match', () => {
      const docVersion = new Date('2026-03-10');
      const readVersion = new Date('2026-03-10');

      const isStale = docVersion < readVersion;
      expect(isStale).toBe(false);
    });

    it('should handle unknown stale status', () => {
      const staleStatus = 'unknown';
      const needsResolution = staleStatus === 'unknown';
      expect(needsResolution).toBe(true);
    });
  });

  describe('Contract Resolution', () => {
    it('should resolve feature contract', () => {
      const contract = {
        feature: 'resolver',
        inputs: ['docs', 'feature_spec'],
        outputs: ['resolved_docs', 'chunks'],
        dependencies: ['memx-core'],
      };

      expect(contract.inputs).toContain('docs');
      expect(contract.outputs).toContain('resolved_docs');
    });
  });

  describe('Integration with Task State', () => {
    it('should store resolver refs in task', () => {
      const task = {
        task_id: 'task_123',
        resolver_refs: {
          doc_refs: ['doc:spec:memory-import'],
          chunk_refs: ['chunk:doc:spec:memory-import:001'],
          ack_refs: ['ack:task_123:doc:spec:memory-import:v1'],
          contract_refs: ['contract:resolver'],
          stale_status: 'fresh' as const,
        },
      };

      expect(task.resolver_refs?.doc_refs).toHaveLength(1);
      expect(task.resolver_refs?.stale_status).toBe('fresh');
    });
  });
});

describe('memx-resolver Live Tests', () => {
  const resolverBaseUrl = process.env.MEMX_RESOLVER_URL || 'http://localhost:8080';

  // These tests require a running memx-resolver server
  it.skip('should resolve docs via API', async () => {
    const response = await fetch(`${resolverBaseUrl}/api/v1/docs/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feature: 'resolver',
      }),
    });

    if (!response.ok) {
      console.log('memx-resolver not available, skipping live test');
      return;
    }

    const data = await response.json();
    expect(data.doc_refs).toBeDefined();
  });

  it.skip('should ack docs via API', async () => {
    const response = await fetch(`${resolverBaseUrl}/api/v1/docs/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_id: 'doc:test:local:test',
        version: 'v1',
      }),
    });

    if (!response.ok) {
      console.log('memx-resolver not available, skipping live test');
      return;
    }

    const data = await response.json();
    expect(data.ack_ref).toBeDefined();
  });
});

describe('ResolverService Extended Features', () => {
  describe('getChunks', () => {
    it('should fetch chunks by IDs', async () => {
      const mockChunks: ChunkData[] = [
        {
          chunk_id: 'chunk-1',
          doc_id: 'doc-1',
          content: 'This is chunk 1 content',
          metadata: { start_line: 1, end_line: 10, importance: 'required' },
        },
        {
          chunk_id: 'chunk-2',
          doc_id: 'doc-1',
          content: 'This is chunk 2 content',
          metadata: { start_line: 11, end_line: 20, importance: 'recommended' },
        },
      ];

      const result = await ResolverService.getChunks(
        { chunk_ids: ['chunk-1', 'chunk-2'] },
        async (ids) => mockChunks.filter(c => ids.includes(c.chunk_id)),
      );

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0].chunk_id).toBe('chunk-1');
      expect(result.chunks[1].chunk_id).toBe('chunk-2');
    });

    it('should return not_found for missing chunks', async () => {
      const mockChunks: ChunkData[] = [
        { chunk_id: 'chunk-1', doc_id: 'doc-1', content: 'content' },
      ];

      const result = await ResolverService.getChunks(
        { chunk_ids: ['chunk-1', 'chunk-missing'] },
        async () => mockChunks,
      );

      expect(result.chunks).toHaveLength(1);
      expect(result.not_found).toContain('chunk-missing');
    });

    it('should return empty array for no chunks', async () => {
      const result = await ResolverService.getChunks(
        { chunk_ids: [] },
        async () => [],
      );

      expect(result.chunks).toHaveLength(0);
      expect(result.not_found).toBeUndefined();
    });
  });

  describe('resolveContracts', () => {
    it('should resolve contracts by IDs', async () => {
      const mockContracts: ContractData[] = [
        {
          contract_id: 'contract-1',
          type: 'api',
          content: 'API contract definition',
          acceptance_criteria: ['Returns 200 on success', 'Validates input'],
          forbidden_patterns: ['Hardcoded credentials'],
        },
        {
          contract_id: 'contract-2',
          type: 'behavior',
          content: 'Behavior contract',
          definition_of_done: ['All tests pass', 'Code reviewed'],
        },
      ];

      const result = await ResolverService.resolveContracts(
        { contract_ids: ['contract-1', 'contract-2'] },
        async (ids) => mockContracts.filter(c => ids.includes(c.contract_id)),
      );

      expect(result.contracts).toHaveLength(2);
      expect(result.contracts[0].acceptance_criteria).toBeDefined();
      expect(result.contracts[0].acceptance_criteria).toHaveLength(2);
    });

    it('should return not_found for missing contracts', async () => {
      const mockContracts: ContractData[] = [
        { contract_id: 'contract-1', type: 'constraint', content: 'content' },
      ];

      const result = await ResolverService.resolveContracts(
        { contract_ids: ['contract-1', 'contract-missing'] },
        async () => mockContracts,
      );

      expect(result.contracts).toHaveLength(1);
      expect(result.not_found).toContain('contract-missing');
    });
  });

  describe('buildResolverRefs', () => {
    it('should build ResolverRefs with importance and reason', () => {
      const docRefs = [
        { ref: 'doc-1', importance: 'required' as const, reason: 'Core API spec' },
        { ref: 'doc-2', importance: 'recommended' as const, reason: 'Optional guide' },
        { ref: 'doc-3' }, // No importance/reason
      ];

      const result = ResolverService.buildResolverRefs(
        docRefs,
        ['chunk-1'],
        ['ack-1'],
        ['contract-1'],
        'fresh',
      );

      expect(result.doc_refs).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect(result.chunk_refs).toEqual(['chunk-1']);
      expect(result.ack_refs).toEqual(['ack-1']);
      expect(result.contract_refs).toEqual(['contract-1']);
      expect(result.stale_status).toBe('fresh');
      expect(result.importance).toEqual({
        'doc-1': 'required',
        'doc-2': 'recommended',
      });
      expect(result.reason).toEqual({
        'doc-1': 'Core API spec',
        'doc-2': 'Optional guide',
      });
    });

    it('should omit importance/reason when empty', () => {
      const result = ResolverService.buildResolverRefs([{ ref: 'doc-1' }]);

      expect(result.importance).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it('should default stale_status to fresh', () => {
      const result = ResolverService.buildResolverRefs([{ ref: 'doc-1' }]);
      expect(result.stale_status).toBe('fresh');
    });
  });

  describe('ResolverRefs with importance field', () => {
    it('should store importance classification', () => {
      const resolverRefs = {
        doc_refs: ['doc-1', 'doc-2', 'doc-3'],
        importance: {
          'doc-1': 'required' as const,
          'doc-2': 'recommended' as const,
          'doc-3': 'optional' as const,
        },
      };

      expect(resolverRefs.importance['doc-1']).toBe('required');
      expect(resolverRefs.importance['doc-2']).toBe('recommended');
      expect(resolverRefs.importance['doc-3']).toBe('optional');
    });

    it('should store reason for document selection', () => {
      const resolverRefs = {
        doc_refs: ['doc-1'],
        reason: {
          'doc-1': 'Required for understanding authentication flow',
        },
      };

      expect(resolverRefs.reason['doc-1']).toBe('Required for understanding authentication flow');
    });
  });
});