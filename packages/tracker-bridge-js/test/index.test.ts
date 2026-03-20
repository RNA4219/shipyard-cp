import { describe, it, expect, beforeEach } from 'vitest';
import {
  TrackerBridge,
  InMemoryBackend,
  TypedRef,
  makeTrackerIssueRef,
  isTrackerRef,
  isMemxRef,
  type NormalizedIssue,
  type NormalizedPR,
} from '../src/index.js';

describe('TrackerBridge', () => {
  let bridge: TrackerBridge;

  beforeEach(() => {
    bridge = new TrackerBridge({ backend: new InMemoryBackend() });
  });

  describe('CacheService', () => {
    it('should cache an issue', async () => {
      const normalized: NormalizedIssue = {
        remote_issue_id: '123',
        remote_issue_key: 'PROJ-123',
        title: 'Test Issue',
        labels: ['bug'],
        raw: {},
      };

      const cached = await bridge.cache.cacheIssue('conn-1', normalized);
      expect(cached.remote_issue_key).toBe('PROJ-123');

      const retrieved = await bridge.cache.getIssue(cached.id);
      expect(retrieved?.title).toBe('Test Issue');
    });

    it('should cache a PR', async () => {
      const normalized: NormalizedPR = {
        remote_pr_id: '456',
        remote_pr_key: 'PROJ-456',
        title: 'Test PR',
        raw: {},
      };

      const cached = await bridge.cache.cachePR('conn-1', normalized);
      expect(cached.remote_pr_key).toBe('PROJ-456');
    });

    it('should get issue by key', async () => {
      const normalized: NormalizedIssue = {
        remote_issue_id: '123',
        remote_issue_key: 'PROJ-123',
        title: 'Test Issue',
        labels: [],
        raw: {},
      };

      await bridge.cache.cacheIssue('conn-1', normalized);
      const found = await bridge.cache.getIssueByKey('PROJ-123');
      expect(found?.title).toBe('Test Issue');
    });
  });

  describe('LinkService', () => {
    it('should create an entity link', async () => {
      const result = await bridge.link.link({
        typed_ref: 'agent-taskstate:task:local:task-1',
        entity_ref: 'tracker:issue:github:123',
        link_role: 'tracks',
      });

      expect(result.success).toBe(true);
      expect(result.external_refs).toBeDefined();
    });

    it('should find links by local ref', async () => {
      await bridge.link.link({
        typed_ref: 'agent-taskstate:task:local:task-1',
        entity_ref: 'tracker:issue:github:123',
        link_role: 'tracks',
      });

      const links = await bridge.link.getLinksByLocalRef('agent-taskstate:task:local:task-1');
      expect(links.length).toBeGreaterThan(0);
    });

    it('should check if linked', async () => {
      await bridge.link.link({
        typed_ref: 'agent-taskstate:task:local:task-1',
        entity_ref: 'tracker:issue:github:123',
      });

      const linked = await bridge.link.isLinked('agent-taskstate:task:local:task-1', 'tracker:issue:github:123');
      expect(linked).toBe(true);
    });
  });

  describe('SyncService', () => {
    it('should record a sync event', async () => {
      const event = await bridge.sync.recordSyncEvent({
        trackerConnectionId: 'conn-1',
        direction: 'inbound',
        remoteRef: 'tracker:issue:github:123',
        localRef: 'agent-taskstate:task:local:task-1',
        eventType: 'created',
        payload: {},
      });

      expect(event.id).toBeDefined();
    });

    it('should get sync events', async () => {
      await bridge.sync.recordSyncEvent({
        trackerConnectionId: 'conn-1',
        direction: 'inbound',
        remoteRef: 'tracker:issue:github:123',
        eventType: 'created',
        payload: {},
      });

      const events = await bridge.sync.getSyncEvents('issue', '123');
      expect(events.length).toBeGreaterThan(0);
    });
  });
});

describe('TypedRef', () => {
  describe('makeTrackerIssueRef', () => {
    it('should create a tracker issue ref', () => {
      const ref = makeTrackerIssueRef('github', '123');
      expect(ref).toContain('tracker');
      expect(ref).toContain('github');
      expect(ref).toContain('123');
    });
  });

  describe('isTrackerRef', () => {
    it('should identify tracker refs', () => {
      expect(isTrackerRef('tracker:issue:github:123')).toBe(true);
      expect(isTrackerRef('agent-taskstate:task:local:task-123')).toBe(false);
    });
  });

  describe('isMemxRef', () => {
    it('should identify memx refs', () => {
      expect(isMemxRef('memx:evidence:local:123')).toBe(true);
      expect(isMemxRef('agent-taskstate:task:local:task-123')).toBe(false);
    });
  });

  describe('TypedRef class', () => {
    it('should parse a typed ref', () => {
      const ref = new TypedRef('tracker', 'issue', '123', 'github');
      expect(ref.domain).toBe('tracker');
      expect(ref.entity_type).toBe('issue');
      expect(ref.entity_id).toBe('123');
      expect(ref.provider).toBe('github');
    });

    it('should stringify back to original', () => {
      const ref = new TypedRef('tracker', 'issue', '123', 'github');
      expect(ref.toString()).toBe('tracker:issue:github:123');
    });

    it('should use local provider for local domains', () => {
      const ref = new TypedRef('agent-taskstate', 'task', 'task-123');
      expect(ref.provider).toBe('local');
    });
  });
});

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend;

  beforeEach(() => {
    backend = new InMemoryBackend();
  });

  it('should store and retrieve issues', async () => {
    const issue = {
      id: 'issue-1',
      tracker_connection_id: 'conn-1',
      remote_issue_id: '123',
      remote_issue_key: 'PROJ-123',
      title: 'Test',
      raw_json: '{}',
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await backend.setIssue(issue);
    const retrieved = await backend.getIssue('issue-1');
    expect(retrieved?.title).toBe('Test');
  });

  it('should store and retrieve entity links', async () => {
    const link = {
      id: 'link-1',
      local_ref: 'agent-taskstate:task:local:task-1',
      remote_ref: 'tracker:issue:github:123',
      link_role: 'tracks',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await backend.setEntityLink(link);
    const retrieved = await backend.getEntityLink('link-1');
    expect(retrieved?.link_role).toBe('tracks');
  });

  it('should return null for non-existent issue', async () => {
    const issue = await backend.getIssue('non-existent');
    expect(issue).toBeNull();
  });
});