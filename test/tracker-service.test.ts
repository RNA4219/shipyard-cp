import { describe, it, expect } from 'vitest';
import { TrackerService } from '../src/domain/tracker/tracker-service.js';
import type { ExternalRef } from '../src/types.js';

describe('TrackerService', () => {
  describe('parseEntityRef', () => {
    it('should parse github_issue entity_ref', () => {
      const result = TrackerService.parseEntityRef('github_issue:123', 'conn_gh');

      expect(result.kind).toBe('github_issue');
      expect(result.value).toBe('123');
      expect(result.connection_ref).toBe('conn_gh');
    });

    it('should parse github_project_item entity_ref', () => {
      const result = TrackerService.parseEntityRef('github_project_item:PVT_item_456');

      expect(result.kind).toBe('github_project_item');
      expect(result.value).toBe('PVT_item_456');
    });

    it('should parse tracker_issue entity_ref', () => {
      const result = TrackerService.parseEntityRef('tracker_issue:JIRA-789');

      expect(result.kind).toBe('tracker_issue');
      expect(result.value).toBe('JIRA-789');
    });

    it('should handle entity_ref with multiple colons', () => {
      const result = TrackerService.parseEntityRef('github_issue:org:repo:123');

      expect(result.kind).toBe('github_issue');
      expect(result.value).toBe('org:repo:123');
    });

    it('should fallback to entity_link for unknown kind', () => {
      const result = TrackerService.parseEntityRef('unknown_type:some_value');

      expect(result.kind).toBe('entity_link');
      expect(result.value).toBe('some_value');
    });

    it('should fallback to entity_link for single segment', () => {
      const result = TrackerService.parseEntityRef('single_value');

      expect(result.kind).toBe('entity_link');
      expect(result.value).toBe('single_value');
    });
  });

  describe('generateSyncEventRef', () => {
    it('should generate sync event ref with task_id and timestamp', () => {
      const ref = TrackerService.generateSyncEventRef('task_123');

      expect(ref).toContain('sync_evt_');
      expect(ref).toContain('task_123');
    });

    it('should generate unique refs', async () => {
      const ref1 = TrackerService.generateSyncEventRef('task_123');
      await new Promise(r => setTimeout(r, 2));
      const ref2 = TrackerService.generateSyncEventRef('task_123');

      expect(ref1).not.toBe(ref2);
    });
  });

  describe('buildSyncEventRef', () => {
    it('should build sync event external_ref', () => {
      const ref = TrackerService.buildSyncEventRef('sync_evt_123', 'conn_gh');

      expect(ref.kind).toBe('sync_event');
      expect(ref.value).toBe('sync_evt_123');
      expect(ref.connection_ref).toBe('conn_gh');
    });
  });

  describe('mergeExternalRefs', () => {
    it('should merge new refs with existing refs', () => {
      const existing: ExternalRef[] = [{ kind: 'github_issue', value: '100' }];
      const newRefs: ExternalRef[] = [{ kind: 'github_project_item', value: 'PVT_200' }];

      const result = TrackerService.mergeExternalRefs(existing, newRefs);

      expect(result).toHaveLength(2);
      expect(result.map(r => r.kind)).toContain('github_issue');
      expect(result.map(r => r.kind)).toContain('github_project_item');
    });

    it('should not add duplicate refs', () => {
      const existing: ExternalRef[] = [{ kind: 'github_issue', value: '100' }];
      const newRefs: ExternalRef[] = [{ kind: 'github_issue', value: '100' }];

      const result = TrackerService.mergeExternalRefs(existing, newRefs);

      expect(result).toHaveLength(1);
    });

    it('should handle undefined existing refs', () => {
      const newRefs: ExternalRef[] = [{ kind: 'github_issue', value: '100' }];

      const result = TrackerService.mergeExternalRefs(undefined, newRefs);

      expect(result).toHaveLength(1);
    });
  });
});