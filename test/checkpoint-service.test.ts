import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointService, defaultCheckpointService } from '../src/domain/checkpoint/checkpoint-service.js';

describe('CheckpointService', () => {
  let service: CheckpointService;

  beforeEach(() => {
    service = new CheckpointService();
  });

  describe('recordCheckpoint', () => {
    it('should record a code checkpoint', () => {
      const checkpoint = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc123',
        summary: 'Planning complete',
        actor: 'worker_1',
      });

      expect(checkpoint.checkpoint_id).toMatch(/^cp_/);
      expect(checkpoint.task_id).toBe('task_123');
      expect(checkpoint.run_id).toBe('run_456');
      expect(checkpoint.checkpoint_type).toBe('code');
      expect(checkpoint.stage).toBe('plan');
      expect(checkpoint.ref).toBe('sha:abc123');
      expect(checkpoint.summary).toBe('Planning complete');
      expect(checkpoint.actor).toBe('worker_1');
      expect(checkpoint.created_at).toBeDefined();
    });

    it('should record an approval checkpoint', () => {
      const checkpoint = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'approval',
        stage: 'acceptance',
        ref: 'approval:task_123:accepted',
        summary: 'Manual acceptance completed',
        actor: 'manual_acceptance',
      });

      expect(checkpoint.checkpoint_type).toBe('approval');
      expect(checkpoint.stage).toBe('acceptance');
    });

    it('should record checkpoint without optional fields', () => {
      const checkpoint = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'dev',
        ref: 'sha:def456',
      });

      expect(checkpoint.summary).toBeUndefined();
      expect(checkpoint.actor).toBeUndefined();
    });

    it('should support all checkpoint stages', () => {
      const stages = ['plan', 'dev', 'acceptance', 'integrate', 'publish'] as const;

      stages.forEach((stage, index) => {
        const checkpoint = service.recordCheckpoint({
          task_id: `task_${index}`,
          run_id: `run_${index}`,
          checkpoint_type: 'code',
          stage,
          ref: `ref_${stage}`,
        });
        expect(checkpoint.stage).toBe(stage);
      });
    });

    it('should generate unique checkpoint IDs', () => {
      const checkpoint1 = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      const checkpoint2 = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'dev',
        ref: 'sha:def',
      });

      expect(checkpoint1.checkpoint_id).not.toBe(checkpoint2.checkpoint_id);
    });
  });

  describe('listCheckpointsForTask', () => {
    it('should return all checkpoints for a task', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'dev',
        ref: 'sha:def',
      });

      const checkpoints = service.listCheckpointsForTask('task_123');
      expect(checkpoints).toHaveLength(2);
    });

    it('should return empty array for task with no checkpoints', () => {
      const checkpoints = service.listCheckpointsForTask('nonexistent_task');
      expect(checkpoints).toEqual([]);
    });
  });

  describe('listCheckpointsForRun', () => {
    it('should return checkpoints for a run', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'task_123', // run_id === task_id in current implementation
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      const checkpoints = service.listCheckpointsForRun('task_123');
      expect(checkpoints).toHaveLength(1);
    });

    it('should return empty array for run with no checkpoints', () => {
      const checkpoints = service.listCheckpointsForRun('nonexistent_run');
      expect(checkpoints).toEqual([]);
    });
  });

  describe('getLatestCheckpointForStage', () => {
    it('should return the latest checkpoint for a stage', async () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:first',
        summary: 'First commit',
      });

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:second',
        summary: 'Second commit',
      });

      const latest = service.getLatestCheckpointForStage('task_123', 'plan');
      expect(latest?.ref).toBe('sha:second');
    });

    it('should return undefined if no checkpoint for stage', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      const latest = service.getLatestCheckpointForStage('task_123', 'dev');
      expect(latest).toBeUndefined();
    });

    it('should return undefined if no checkpoints for task', () => {
      const latest = service.getLatestCheckpointForStage('nonexistent_task', 'plan');
      expect(latest).toBeUndefined();
    });
  });

  describe('getCheckpointsByType', () => {
    it('should return only code checkpoints', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'approval',
        stage: 'acceptance',
        ref: 'approval:task_123',
      });

      const codeCheckpoints = service.getCheckpointsByType('task_123', 'code');
      expect(codeCheckpoints).toHaveLength(1);
      expect(codeCheckpoints[0].checkpoint_type).toBe('code');
    });

    it('should return only approval checkpoints', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'approval',
        stage: 'acceptance',
        ref: 'approval:task_123',
      });

      const approvalCheckpoints = service.getCheckpointsByType('task_123', 'approval');
      expect(approvalCheckpoints).toHaveLength(1);
      expect(approvalCheckpoints[0].checkpoint_type).toBe('approval');
    });

    it('should return empty array if no checkpoints of type', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      const approvalCheckpoints = service.getCheckpointsByType('task_123', 'approval');
      expect(approvalCheckpoints).toEqual([]);
    });
  });

  describe('clearCheckpoints', () => {
    it('should clear all checkpoints for a task', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      service.clearCheckpoints('task_123');

      expect(service.listCheckpointsForTask('task_123')).toEqual([]);
    });

    it('should not affect other tasks', () => {
      service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
      });

      service.recordCheckpoint({
        task_id: 'task_456',
        run_id: 'run_789',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:def',
      });

      service.clearCheckpoints('task_123');

      expect(service.listCheckpointsForTask('task_123')).toEqual([]);
      expect(service.listCheckpointsForTask('task_456')).toHaveLength(1);
    });
  });

  describe('toCheckpointRefs', () => {
    it('should convert records to CheckpointRef format', () => {
      const checkpoint = service.recordCheckpoint({
        task_id: 'task_123',
        run_id: 'run_456',
        checkpoint_type: 'code',
        stage: 'plan',
        ref: 'sha:abc',
        summary: 'Test',
        actor: 'worker',
      });

      const refs = service.toCheckpointRefs([checkpoint]);

      expect(refs).toHaveLength(1);
      expect(refs[0].checkpoint_id).toBe(checkpoint.checkpoint_id);
      expect(refs[0].checkpoint_type).toBe('code');
      expect(refs[0].stage).toBe('plan');
      expect(refs[0].ref).toBe('sha:abc');
      expect(refs[0].created_at).toBe(checkpoint.created_at);
      // These should not be in the ref
      expect((refs[0] as any).task_id).toBeUndefined();
      expect((refs[0] as any).summary).toBeUndefined();
      expect((refs[0] as any).actor).toBeUndefined();
    });

    it('should handle empty array', () => {
      const refs = service.toCheckpointRefs([]);
      expect(refs).toEqual([]);
    });
  });

  describe('defaultCheckpointService', () => {
    it('should be a singleton instance', () => {
      expect(defaultCheckpointService).toBeInstanceOf(CheckpointService);
    });
  });
});