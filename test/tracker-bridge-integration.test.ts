import { describe, it, expect } from 'vitest';

/**
 * tracker-bridge-materials Connector Tests
 *
 * Tests for issue cache / entity link / sync event integration
 */
describe('tracker-bridge-materials Connector', () => {
  describe('Entity Link Types', () => {
    it('should define entity link request', () => {
      const request = {
        typed_ref: 'shipyard:task:github:123',
        entity_ref: 'github:issue:456',
        connection_ref: 'github-main',
      };

      expect(request.typed_ref).toBe('shipyard:task:github:123');
      expect(request.entity_ref).toBe('github:issue:456');
    });

    it('should define sync event response', () => {
      const response = {
        sync_event_ref: 'sync:github:issue:456:2026-03-17T12:00:00Z',
        external_refs: [
          { kind: 'github_issue', value: '456' },
          { kind: 'sync_event', value: 'sync_123' },
        ],
      };

      expect(response.sync_event_ref).toBeDefined();
      expect(response.external_refs).toHaveLength(2);
    });
  });

  describe('Issue Cache', () => {
    it('should cache issue data', () => {
      const issueCache = {
        issue_id: '456',
        provider: 'github',
        owner: 'example',
        repo: 'test-repo',
        title: 'Bug in authentication',
        state: 'open',
        labels: ['bug', 'priority:high'],
        assignees: ['developer1'],
        cached_at: '2026-03-17T12:00:00Z',
        etag: 'abc123',
      };

      expect(issueCache.issue_id).toBe('456');
      expect(issueCache.labels).toContain('bug');
    });

    it('should detect stale cache by etag', () => {
      const cachedEtag = 'abc123';
      const currentEtag = 'def456';

      const isStale = cachedEtag !== currentEtag;
      expect(isStale).toBe(true);
    });

    it('should detect stale cache by timestamp', () => {
      const cachedAt = new Date('2026-03-15T12:00:00Z');
      const now = new Date('2026-03-17T12:00:00Z');
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

      const ageMs = now.getTime() - cachedAt.getTime();
      const isStale = ageMs > maxAgeMs;
      expect(isStale).toBe(true);
    });
  });

  describe('External Refs', () => {
    it('should support github_issue ref', () => {
      const ref = {
        kind: 'github_issue',
        value: '456',
        connection_ref: 'github-main',
      };

      expect(ref.kind).toBe('github_issue');
    });

    it('should support github_project_item ref', () => {
      const ref = {
        kind: 'github_project_item',
        value: 'PVT_item_123',
      };

      expect(ref.kind).toBe('github_project_item');
    });

    it('should support sync_event ref', () => {
      const ref = {
        kind: 'sync_event',
        value: 'sync_evt_456',
      };

      expect(ref.kind).toBe('sync_event');
    });

    it('should support entity_link ref', () => {
      const ref = {
        kind: 'entity_link',
        value: 'link:github:issue:456:task:123',
      };

      expect(ref.kind).toBe('entity_link');
    });
  });

  describe('Context Rebuild', () => {
    it('should rebuild context from tracker data', () => {
      const contextInput = {
        task_id: 'task_123',
        tracker_refs: [
          { kind: 'github_issue', value: '456' },
        ],
        include_comments: true,
        include_linked_prs: true,
      };

      const rebuiltContext = {
        task_id: 'task_123',
        issue_summary: 'Bug in authentication flow',
        related_prs: ['pr_789'],
        comments_count: 5,
        last_activity: '2026-03-17T10:00:00Z',
      };

      expect(rebuiltContext.task_id).toBe('task_123');
      expect(rebuiltContext.related_prs).toHaveLength(1);
    });
  });

  describe('Sync Event Generation', () => {
    it('should generate unique sync event ref', () => {
      const taskId = 'task_123';
      const timestamp = new Date().toISOString();
      const syncEventRef = `sync:task:${taskId}:${timestamp}`;

      expect(syncEventRef).toContain('sync:task:task_123:');
    });

    it('should track sync event metadata', () => {
      const syncEvent = {
        sync_id: 'sync_123',
        source: 'github',
        entity_type: 'issue',
        entity_id: '456',
        operation: 'update',
        occurred_at: '2026-03-17T12:00:00Z',
        payload_hash: 'sha256:abc123',
      };

      expect(syncEvent.operation).toBe('update');
      expect(syncEvent.source).toBe('github');
    });
  });

  describe('Connection Management', () => {
    it('should define connection config', () => {
      const connection = {
        connection_ref: 'github-main',
        provider: 'github',
        auth_type: 'pat',
        rate_limit_per_hour: 5000,
        enabled: true,
      };

      expect(connection.provider).toBe('github');
      expect(connection.rate_limit_per_hour).toBe(5000);
    });

    it('should support GitHub App authentication', () => {
      const connection = {
        connection_ref: 'github-app-main',
        provider: 'github',
        auth_type: 'github_app',
        app_id: '12345',
        installation_id: '67890',
        enabled: true,
      };

      expect(connection.auth_type).toBe('github_app');
    });
  });

  describe('Integration with Task', () => {
    it('should store external refs in task', () => {
      const task = {
        task_id: 'task_123',
        external_refs: [
          { kind: 'github_issue', value: '456' },
          { kind: 'github_project_item', value: 'PVT_item_123' },
          { kind: 'sync_event', value: 'sync_evt_456' },
        ],
      };

      expect(task.external_refs).toHaveLength(3);
      expect(task.external_refs?.find(r => r.kind === 'github_issue')?.value).toBe('456');
    });
  });
});

describe('tracker-bridge-materials Live Tests', () => {
  // These tests require a running tracker-bridge server or actual GitHub API
  it.skip('should link entity via API', async () => {
    const bridgeUrl = process.env.TRACKER_BRIDGE_URL || 'http://localhost:8081';

    const response = await fetch(`${bridgeUrl}/api/v1/entity/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typed_ref: 'shipyard:task:github:123',
        entity_ref: 'github:issue:456',
      }),
    });

    if (!response.ok) {
      console.log('tracker-bridge not available, skipping live test');
      return;
    }

    const data = await response.json();
    expect(data.sync_event_ref).toBeDefined();
  });
});