import { describe, it, expect } from 'vitest';
import { applyTaskUpdate, mergeTaskUpdates, type TaskUpdate } from '../src/domain/task/task-update.js';
import type { Task, ArtifactRef, ExternalRef, Verdict, BlockedContext } from '../src/types.js';

describe('task-update', () => {
  const createBaseTask = (): Task => ({
    task_id: 'task_123',
    typed_ref: 'agent-taskstate:task:test:123',
    state: 'planning',
    title: 'Test Task',
    objective: 'Test objective',
    repo_ref: {
      provider: 'github',
      owner: 'test',
      name: 'repo',
      default_branch: 'main',
    },
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Task);

  describe('applyTaskUpdate', () => {
    it('should return a new task object', () => {
      const task = createBaseTask();
      const updated = applyTaskUpdate(task, {});

      expect(updated).not.toBe(task);
      expect(updated.task_id).toBe(task.task_id);
    });

    it('should increment version and update timestamp', () => {
      const task = createBaseTask();
      const originalUpdatedAt = task.updated_at;
      const updated = applyTaskUpdate(task, {});

      expect(updated.version).toBe(task.version + 1);
      // The timestamp should be updated (allowing for same millisecond in tests)
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
    });

    describe('direct replacements', () => {
      it('should replace artifacts', () => {
        const task = createBaseTask();
        const artifacts: ArtifactRef[] = [
          { artifact_id: 'art_1', kind: 'log', uri: 's3://logs/1', created_at: new Date().toISOString() },
        ];

        const updated = applyTaskUpdate(task, { artifacts });

        expect(updated.artifacts).toEqual(artifacts);
      });

      it('should update resolver_refs', () => {
        const task = createBaseTask();
        task.resolver_refs = { doc_refs: ['doc_1'], ack_refs: [] } as any;

        const updated = applyTaskUpdate(task, {
          resolver_refs: { doc_refs: ['doc_2'] },
        });

        expect(updated.resolver_refs?.doc_refs).toEqual(['doc_2']);
        expect(updated.resolver_refs?.ack_refs).toEqual([]);
      });

      it('should replace external_refs', () => {
        const task = createBaseTask();
        const externalRefs: ExternalRef[] = [
          { kind: 'deployment', value: 'deploy_1' },
        ];

        const updated = applyTaskUpdate(task, { external_refs: externalRefs });

        expect(updated.external_refs).toEqual(externalRefs);
      });

      it('should set context_bundle_ref', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { context_bundle_ref: 'bundle_123' });

        expect(updated.context_bundle_ref).toBe('bundle_123');
      });

      it('should set rollback_notes', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { rollback_notes: 'Rollback to v1' });

        expect(updated.rollback_notes).toBe('Rollback to v1');
      });

      it('should set last_verdict', () => {
        const task = createBaseTask();
        const verdict: Verdict = {
          outcome: 'accept',
          reason: 'All tests passed',
          timestamp: new Date().toISOString(),
        };

        const updated = applyTaskUpdate(task, { last_verdict: verdict });

        expect(updated.last_verdict).toEqual(verdict);
      });

      it('should set last_failure_class', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { last_failure_class: 'test_failure' });

        expect(updated.last_failure_class).toBe('test_failure');
      });

      it('should set loop_fingerprint', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { loop_fingerprint: 'fp_123' });

        expect(updated.loop_fingerprint).toBe('fp_123');
      });

      it('should set detected_side_effects', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { detected_side_effects: ['file_write', 'network'] });

        expect(updated.detected_side_effects).toEqual(['file_write', 'network']);
      });

      it('should set blocked_context', () => {
        const task = createBaseTask();
        const blocked: BlockedContext = {
          resume_state: 'planning',
          reason: 'waiting for approval',
          waiting_on: 'human',
        };

        const updated = applyTaskUpdate(task, { blocked_context: blocked });

        expect(updated.blocked_context).toEqual(blocked);
      });

      it('should set active_job_id', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, { active_job_id: 'job_123' });

        expect(updated.active_job_id).toBe('job_123');
      });

      it('should set manual_checklist', () => {
        const task = createBaseTask();
        const checklist = [{ id: 'item_1', description: 'Check this', required: true, checked: false }];

        const updated = applyTaskUpdate(task, { manual_checklist: checklist });

        expect(updated.manual_checklist).toEqual(checklist);
      });
    });

    describe('merge operations', () => {
      it('should merge artifacts', () => {
        const task = createBaseTask();
        task.artifacts = [
          { artifact_id: 'art_1', kind: 'log', uri: 's3://logs/1', created_at: new Date().toISOString() },
        ];

        const updated = applyTaskUpdate(task, {
          mergeArtifacts: [
            { artifact_id: 'art_2', kind: 'patch', uri: 's3://patches/1', created_at: new Date().toISOString() },
          ],
        });

        expect(updated.artifacts).toHaveLength(2);
        expect(updated.artifacts?.map(a => a.artifact_id)).toEqual(['art_1', 'art_2']);
      });

      it('should merge resolver_refs', () => {
        const task = createBaseTask();
        task.resolver_refs = { doc_refs: ['doc_1'], ack_refs: ['ack_1'] } as any;

        const updated = applyTaskUpdate(task, {
          mergeResolverRefs: { doc_refs: ['doc_2'] },
        });

        expect(updated.resolver_refs?.doc_refs).toEqual(['doc_2']);
        expect(updated.resolver_refs?.ack_refs).toEqual(['ack_1']);
      });

      it('should merge external_refs without duplicates', () => {
        const task = createBaseTask();
        task.external_refs = [
          { kind: 'deployment', value: 'deploy_1' },
          { kind: 'pr', value: 'pr_123' },
        ];

        const updated = applyTaskUpdate(task, {
          mergeExternalRefs: [
            { kind: 'deployment', value: 'deploy_2' },
            { kind: 'pr', value: 'pr_123' }, // Duplicate
          ],
        });

        expect(updated.external_refs).toHaveLength(3);
        expect(updated.external_refs?.map(e => e.value)).toEqual(['deploy_1', 'pr_123', 'deploy_2']);
      });

      it('should merge retry_counts', () => {
        const task = createBaseTask();
        task.retry_counts = { plan: 1, dev: 0 };

        const updated = applyTaskUpdate(task, {
          retry_counts: { dev: 1 },
        });

        expect(updated.retry_counts?.plan).toBe(1);
        expect(updated.retry_counts?.dev).toBe(1);
      });
    });

    describe('combined updates', () => {
      it('should apply multiple updates at once', () => {
        const task = createBaseTask();
        const updated = applyTaskUpdate(task, {
          active_job_id: 'job_123',
          last_verdict: { outcome: 'accept', reason: 'OK', timestamp: new Date().toISOString() },
          rollback_notes: 'Notes',
        });

        expect(updated.active_job_id).toBe('job_123');
        expect(updated.last_verdict?.outcome).toBe('accept');
        expect(updated.rollback_notes).toBe('Notes');
      });
    });
  });

  describe('mergeTaskUpdates', () => {
    it('should return empty update when no updates provided', () => {
      const result = mergeTaskUpdates();
      expect(result).toEqual({});
    });

    it('should return single update unchanged', () => {
      const update: TaskUpdate = { active_job_id: 'job_123' };
      const result = mergeTaskUpdates(update);

      expect(result.active_job_id).toBe('job_123');
    });

    it('should merge direct fields with later winning', () => {
      const update1: TaskUpdate = { active_job_id: 'job_1' };
      const update2: TaskUpdate = { active_job_id: 'job_2' };

      const result = mergeTaskUpdates(update1, update2);

      expect(result.active_job_id).toBe('job_2');
    });

    it('should merge resolver_refs deeply', () => {
      const update1: TaskUpdate = { resolver_refs: { doc_refs: ['doc_1'] } };
      const update2: TaskUpdate = { resolver_refs: { ack_refs: ['ack_1'] } };

      const result = mergeTaskUpdates(update1, update2);

      expect(result.resolver_refs?.doc_refs).toEqual(['doc_1']);
      expect(result.resolver_refs?.ack_refs).toEqual(['ack_1']);
    });

    it('should combine mergeArtifacts from all updates', () => {
      const update1: TaskUpdate = {
        mergeArtifacts: [
          { artifact_id: 'art_1', kind: 'log', uri: 's3://logs/1', created_at: new Date().toISOString() },
        ],
      };
      const update2: TaskUpdate = {
        mergeArtifacts: [
          { artifact_id: 'art_2', kind: 'patch', uri: 's3://patches/1', created_at: new Date().toISOString() },
        ],
      };

      const result = mergeTaskUpdates(update1, update2);

      expect(result.mergeArtifacts).toHaveLength(2);
      expect(result.mergeArtifacts?.map(a => a.artifact_id)).toEqual(['art_1', 'art_2']);
    });

    it('should combine mergeExternalRefs from all updates', () => {
      const update1: TaskUpdate = { mergeExternalRefs: [{ kind: 'pr', value: 'pr_1' }] };
      const update2: TaskUpdate = { mergeExternalRefs: [{ kind: 'pr', value: 'pr_2' }] };

      const result = mergeTaskUpdates(update1, update2);

      expect(result.mergeExternalRefs).toHaveLength(2);
    });

    it('should combine retry_counts from all updates', () => {
      const update1: TaskUpdate = { retry_counts: { plan: 1 } };
      const update2: TaskUpdate = { retry_counts: { dev: 2 } };

      const result = mergeTaskUpdates(update1, update2);

      expect(result.retry_counts?.plan).toBe(1);
      expect(result.retry_counts?.dev).toBe(2);
    });

    it('should merge multiple updates correctly', () => {
      const updates: TaskUpdate[] = [
        { active_job_id: 'job_1', rollback_notes: 'Note 1' },
        { active_job_id: 'job_2', last_verdict: { outcome: 'accept', reason: 'OK', timestamp: new Date().toISOString() } },
        { rollback_notes: 'Note 2' },
      ];

      const result = mergeTaskUpdates(...updates);

      expect(result.active_job_id).toBe('job_2');
      expect(result.rollback_notes).toBe('Note 2');
      expect(result.last_verdict?.outcome).toBe('accept');
    });
  });
});