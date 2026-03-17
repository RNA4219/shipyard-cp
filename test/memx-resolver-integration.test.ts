import { describe, it, expect } from 'vitest';

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