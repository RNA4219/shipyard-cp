import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ContextRebuildService,
  type ExternalRef,
  type EntityLinkRequest,
  type LinkRole,
} from '../src/domain/context-rebuild/index.js';

describe('ContextRebuildService', () => {
  let service: ContextRebuildService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    service = new ContextRebuildService({
      baseUrl: 'http://localhost:8081',
      connectionRef: 'github-main',
    });
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      const defaultService = new ContextRebuildService();
      expect(defaultService).toBeDefined();
    });

    it('should create service with custom config', () => {
      const customService = new ContextRebuildService({
        baseUrl: 'http://custom:9090',
        connectionRef: 'custom-conn',
        timeout: 60000,
      });
      expect(customService).toBeDefined();
    });
  });

  describe('rebuildContext', () => {
    it('should rebuild context from github_issue ref', async () => {
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        owner: 'test-org',
        repo: 'test-repo',
        title: 'Bug in authentication',
        body: 'Description of the bug',
        state: 'open',
        labels: ['bug', 'priority:high'],
        assignees: ['developer1'],
        created_at: '2026-03-15T10:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
        cached_at: '2026-03-17T12:00:00Z',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIssue,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ comments: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ prs: [] }),
        });

      const trackerRefs: ExternalRef[] = [
        { kind: 'github_issue', value: '456' },
      ];

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: trackerRefs,
      });

      expect(result.task_id).toBe('task_123');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].title).toBe('Bug in authentication');
      expect(result.staleness.is_stale).toBe(false);
    });

    it('should detect stale cache', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        owner: 'test-org',
        repo: 'test-repo',
        title: 'Old issue',
        state: 'open',
        labels: [],
        created_at: '2026-03-01T10:00:00Z',
        updated_at: '2026-03-01T12:00:00Z',
        cached_at: oldDate,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIssue,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ comments: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ prs: [] }),
        });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'github_issue', value: '456' }],
        stale_after_ms: 24 * 60 * 60 * 1000, // 24 hours
      });

      expect(result.staleness.is_stale).toBe(true);
      expect(result.staleness.stale_refs).toContain('github_issue:456');
    });

    it('should fetch linked PRs when requested', async () => {
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        owner: 'test-org',
        repo: 'test-repo',
        title: 'Issue with PR',
        state: 'open',
        labels: [],
        created_at: '2026-03-17T10:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
        cached_at: new Date().toISOString(),
      };

      const mockPRs = [
        {
          pr_id: '789',
          provider: 'github',
          owner: 'test-org',
          repo: 'test-repo',
          title: 'Fix for issue 456',
          state: 'open',
          author: 'developer1',
          base_branch: 'main',
          head_branch: 'fix-456',
          draft: false,
          files_changed: 3,
          additions: 50,
          deletions: 10,
          commits: 2,
          created_at: '2026-03-17T11:00:00Z',
          updated_at: '2026-03-17T12:00:00Z',
        },
      ];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockIssue })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ prs: mockPRs }) });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'github_issue', value: '456' }],
        include_linked_prs: true,
      });

      expect(result.related_prs).toHaveLength(1);
      expect(result.related_prs[0].title).toBe('Fix for issue 456');
    });

    it('should fetch comments when requested', async () => {
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        title: 'Issue',
        state: 'open',
        labels: [],
        created_at: '2026-03-17T10:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
        cached_at: new Date().toISOString(),
      };

      const mockComments = [
        {
          comment_id: 'c1',
          author: 'user1',
          body: 'First comment',
          created_at: '2026-03-17T11:00:00Z',
        },
        {
          comment_id: 'c2',
          author: 'user2',
          body: 'Second comment',
          created_at: '2026-03-17T11:30:00Z',
        },
      ];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockIssue })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: mockComments }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ prs: [] }) });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'github_issue', value: '456' }],
        include_comments: true,
      });

      expect(result.comments_summary?.total_count).toBe(2);
      expect(result.comments_summary?.participants).toContain('user1');
      expect(result.comments_summary?.participants).toContain('user2');
    });

    it('should handle github_pr ref', async () => {
      const mockPR = {
        pr_id: '789',
        provider: 'github',
        owner: 'test-org',
        repo: 'test-repo',
        title: 'Feature implementation',
        state: 'open',
        author: 'developer1',
        base_branch: 'main',
        head_branch: 'feature',
        draft: false,
        files_changed: 5,
        additions: 100,
        deletions: 20,
        commits: 3,
        created_at: '2026-03-17T10:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
        cached_at: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPR,
      });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:789',
        tracker_refs: [{ kind: 'github_pr', value: '789' }],
      });

      expect(result.related_prs).toHaveLength(1);
      expect(result.related_prs[0].pr_id).toBe('789');
    });

    it('should handle github_project_item ref', async () => {
      const mockItem = {
        item_id: 'PVT_item_123',
        project_name: 'Sprint Backlog',
        status: 'In Progress',
        custom_fields: { priority: 'High', estimate: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockItem,
      });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:item123',
        tracker_refs: [{ kind: 'github_project_item', value: 'PVT_item_123' }],
      });

      expect(result.project_items).toHaveLength(1);
      expect(result.project_items[0].project_name).toBe('Sprint Backlog');
    });

    it('should handle sync_event ref', async () => {
      const mockSyncEvent = {
        sync_id: 'sync_123',
        source: 'github',
        entity_type: 'issue',
        entity_id: '456',
        operation: 'update',
        occurred_at: '2026-03-17T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSyncEvent,
      });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'sync_event', value: 'sync_123' }],
      });

      expect(result.sync_events).toHaveLength(1);
      expect(result.sync_events[0].operation).toBe('update');
    });

    it('should build tracker_context for ContextBundle', async () => {
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        title: 'Test Issue',
        state: 'open',
        labels: ['bug'],
        created_at: '2026-03-17T10:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
        cached_at: new Date().toISOString(),
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockIssue })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ prs: [] }) });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'github_issue', value: '456' }],
      });

      expect(result.tracker_context).toBeDefined();
      expect(result.tracker_context?.issues).toHaveLength(1);
      expect(result.tracker_context?.external_refs).toHaveLength(1);
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:999',
        tracker_refs: [{ kind: 'github_issue', value: '999' }],
      });

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('linkEntity', () => {
    it('should link entity to task', async () => {
      const mockResult = {
        success: true,
        sync_event_ref: 'sync:task:123:issue:456:2026-03-17T12:00:00Z',
        external_refs: [
          { kind: 'github_issue', value: '456' },
        ],
        linked_at: '2026-03-17T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const request: EntityLinkRequest = {
        typed_ref: 'agent-taskstate:task:github:123',
        entity_ref: 'github:issue:456',
      };

      const result = await service.linkEntity(request);

      expect(result.success).toBe(true);
      expect(result.sync_event_ref).toBeDefined();
    });

    it('should link entity with link_role', async () => {
      const mockResult = {
        success: true,
        sync_event_ref: 'sync:task:123:issue:456:2026-03-17T12:00:00Z',
        external_refs: [
          { kind: 'github_issue', value: '456', link_role: 'primary' },
        ],
        linked_at: '2026-03-17T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const request: EntityLinkRequest = {
        typed_ref: 'agent-taskstate:task:github:123',
        entity_ref: 'github:issue:456',
        link_role: 'primary',
      };

      const result = await service.linkEntity(request);

      expect(result.success).toBe(true);
      // Verify the request body included link_role
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"link_role":"primary"'),
        })
      );
    });

    it('should link entity with metadata_json', async () => {
      const mockResult = {
        success: true,
        sync_event_ref: 'sync:task:123:issue:456:2026-03-17T12:00:00Z',
        external_refs: [
          { kind: 'github_issue', value: '456', metadata_json: '{"priority":"high"}' },
        ],
        linked_at: '2026-03-17T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const metadataJson = JSON.stringify({ priority: 'high', assignee: 'user1' });
      const request: EntityLinkRequest = {
        typed_ref: 'agent-taskstate:task:github:123',
        entity_ref: 'github:issue:456',
        metadata_json: metadataJson,
      };

      const result = await service.linkEntity(request);

      expect(result.success).toBe(true);
      // Verify the request body included metadata_json
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"metadata_json"'),
        })
      );
    });

    it('should link entity with all link_role values', async () => {
      const roles: LinkRole[] = ['primary', 'related', 'duplicate', 'blocks', 'caused_by'];

      for (const role of roles) {
        const mockResult = {
          success: true,
          sync_event_ref: `sync:task:123:issue:456:${role}`,
          external_refs: [{ kind: 'entity_link', value: 'test', link_role: role }],
          linked_at: '2026-03-17T12:00:00Z',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResult,
        });

        const request: EntityLinkRequest = {
          typed_ref: 'agent-taskstate:task:github:123',
          entity_ref: 'github:issue:456',
          link_role: role,
        };

        const result = await service.linkEntity(request);
        expect(result.success).toBe(true);
      }
    });

    it('should throw on link failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        service.linkEntity({
          typed_ref: 'agent-taskstate:task:github:123',
          entity_ref: 'github:issue:456',
        })
      ).rejects.toThrow('Failed to link entity');
    });
  });

  describe('unlinkEntity', () => {
    it('should unlink entity from task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.unlinkEntity('agent-taskstate:task:github:123', 'github:issue:456')
      ).resolves.not.toThrow();
    });

    it('should not throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        service.unlinkEntity('agent-taskstate:task:github:123', 'github:issue:456')
      ).resolves.not.toThrow();
    });
  });

  describe('getConnectionStatus', () => {
    it('should get connection status', async () => {
      const mockStatus = {
        connection_ref: 'github-main',
        provider: 'github',
        status: 'active',
        last_sync: '2026-03-17T12:00:00Z',
        rate_limit_remaining: 4500,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await service.getConnectionStatus('github-main');

      expect(result.status).toBe('active');
      expect(result.rate_limit_remaining).toBe(4500);
    });

    it('should return error status on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await service.getConnectionStatus('unknown');

      expect(result.status).toBe('error');
    });
  });

  describe('listConnections', () => {
    it('should list connections', async () => {
      const mockConnections = {
        connections: [
          { connection_ref: 'github-main', provider: 'github', status: 'active' },
          { connection_ref: 'jira-main', provider: 'jira', status: 'active' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockConnections,
      });

      const result = await service.listConnections();

      expect(result).toHaveLength(2);
    });

    it('should return empty array on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      const result = await service.listConnections();

      expect(result).toHaveLength(0);
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate cache', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.invalidateCache('issue', '456')
      ).resolves.not.toThrow();
    });
  });

  describe('getSyncEvents', () => {
    it('should get sync events', async () => {
      const mockEvents = {
        events: [
          {
            sync_id: 'sync_1',
            source: 'github',
            entity_type: 'issue',
            entity_id: '456',
            operation: 'update',
            occurred_at: '2026-03-17T10:00:00Z',
          },
          {
            sync_id: 'sync_2',
            source: 'github',
            entity_type: 'issue',
            entity_id: '456',
            operation: 'comment',
            occurred_at: '2026-03-17T11:00:00Z',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEvents,
      });

      const result = await service.getSyncEvents('issue', '456');

      expect(result).toHaveLength(2);
    });

    it('should pass query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [] }),
      });

      await service.getSyncEvents('issue', '456', {
        limit: 10,
        since: '2026-03-01T00:00:00Z',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since=2026-03-01'),
        expect.anything()
      );
    });
  });

  describe('activity timeline', () => {
    it('should build sorted activity timeline', async () => {
      const mockIssue = {
        issue_id: '456',
        provider: 'github',
        title: 'Issue',
        state: 'open',
        labels: [],
        created_at: '2026-03-17T10:00:00Z',
        updated_at: '2026-03-17T15:00:00Z',
        cached_at: new Date().toISOString(),
      };

      const mockComments = [
        {
          comment_id: 'c2',
          author: 'user2',
          body: 'Later comment',
          created_at: '2026-03-17T14:00:00Z',
        },
        {
          comment_id: 'c1',
          author: 'user1',
          body: 'Earlier comment',
          created_at: '2026-03-17T11:00:00Z',
        },
      ];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockIssue })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: mockComments }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ prs: [] }) });

      const result = await service.rebuildContext({
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:456',
        tracker_refs: [{ kind: 'github_issue', value: '456' }],
        include_comments: true,
      });

      expect(result.activity_timeline.length).toBeGreaterThan(0);
      // Check timeline is sorted by timestamp
      for (let i = 1; i < result.activity_timeline.length; i++) {
        expect(
          result.activity_timeline[i].timestamp >= result.activity_timeline[i - 1].timestamp
        ).toBe(true);
      }
    });
  });
});