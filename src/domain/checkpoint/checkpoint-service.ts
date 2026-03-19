/**
 * Checkpoint Service
 *
 * Manages checkpoints for stage boundaries in task execution.
 * Supports both code checkpoints (commit SHA, branch, tag) and
 * approval checkpoints (manual acceptance, publish approval).
 */

import type { CheckpointRef, WorkerStage } from '../../types.js';

export type CheckpointStage = WorkerStage | 'integrate' | 'publish';

export interface CheckpointRecord extends CheckpointRef {
  task_id: string;
  run_id: string;
  summary?: string;
  actor?: string;
}

// Future: storage backend for checkpoints
export type CheckpointServiceDeps = Record<string, never>;

/**
 * Checkpoint Service
 *
 * Records and retrieves checkpoints for task execution stages.
 */
export class CheckpointService {
  private checkpoints = new Map<string, CheckpointRecord[]>();

  /**
   * Record a checkpoint for a task/run.
   */
  recordCheckpoint(params: {
    task_id: string;
    run_id: string;
    checkpoint_type: 'code' | 'approval';
    stage: CheckpointStage;
    ref: string;
    summary?: string;
    actor?: string;
  }): CheckpointRecord {
    const checkpoint: CheckpointRecord = {
      checkpoint_id: `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      task_id: params.task_id,
      run_id: params.run_id,
      checkpoint_type: params.checkpoint_type,
      stage: params.stage,
      ref: params.ref,
      created_at: new Date().toISOString(),
      summary: params.summary,
      actor: params.actor,
    };

    const key = params.task_id;
    const existing = this.checkpoints.get(key) ?? [];
    existing.push(checkpoint);
    this.checkpoints.set(key, existing);

    return checkpoint;
  }

  /**
   * List checkpoints for a task.
   */
  listCheckpointsForTask(taskId: string): CheckpointRecord[] {
    return this.checkpoints.get(taskId) ?? [];
  }

  /**
   * List checkpoints for a run.
   */
  listCheckpointsForRun(runId: string): CheckpointRecord[] {
    // For now, run_id === task_id
    return this.checkpoints.get(runId) ?? [];
  }

  /**
   * Get latest checkpoint for a specific stage.
   */
  getLatestCheckpointForStage(taskId: string, stage: CheckpointStage): CheckpointRecord | undefined {
    const checkpoints = this.checkpoints.get(taskId) ?? [];
    return checkpoints
      .filter(cp => cp.stage === stage)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  /**
   * Get checkpoints by type.
   */
  getCheckpointsByType(taskId: string, type: 'code' | 'approval'): CheckpointRecord[] {
    const checkpoints = this.checkpoints.get(taskId) ?? [];
    return checkpoints.filter(cp => cp.checkpoint_type === type);
  }

  /**
   * Clear checkpoints for a task (useful for testing).
   */
  clearCheckpoints(taskId: string): void {
    this.checkpoints.delete(taskId);
  }

  /**
   * Convert checkpoint records to CheckpointRef format.
   */
  toCheckpointRefs(records: CheckpointRecord[]): CheckpointRef[] {
    return records.map(record => ({
      checkpoint_id: record.checkpoint_id,
      checkpoint_type: record.checkpoint_type,
      stage: record.stage,
      ref: record.ref,
      created_at: record.created_at,
    }));
  }
}

/**
 * Default checkpoint service instance.
 */
export const defaultCheckpointService = new CheckpointService();