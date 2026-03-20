/**
 * Unit tests for RunService
 *
 * Tests the Run read model operations including:
 * - Task to Run conversion
 * - Status mapping
 * - Timeline and audit summary
 * - Pagination and filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunService } from '../src/domain/run/run-service.js';
import type { Task, Run, StateTransitionEvent, AuditEvent, RunStatus } from '../src/types.js';
import type { CheckpointService } from '../src/domain/checkpoint/index.js';

function createMockCheckpointService() {
  return {
    listCheckpointsForRun: vi.fn(() => []),
    listCheckpointsForTask: vi.fn(() => []),
    toCheckpointRefs: vi.fn(() => []),
    recordCheckpoint: vi.fn(),
  } as unknown as CheckpointService;
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_001',
    typed_ref: 'github:owner/repo:main:path',
    objective: 'Test objective',
    state: 'planning',
    version: 1,
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T01:00:00Z',
    risk_level: 'medium',
    ...overrides,
  };
}

function createMockContext(events: StateTransitionEvent[] = [], auditEvents: AuditEvent[] = []) {
  const taskMap = new Map<string, Task>();
  return {
    context: {
      getTask: vi.fn((id: string) => taskMap.get(id)),
      getEvents: vi.fn(() => events),
      getAuditEvents: vi.fn(() => auditEvents),
    },
    taskMap,
    setTask: (task: Task) => taskMap.set(task.task_id, task),
  };
}

describe('RunService', () => {
  let service: RunService;
  let checkpointService: CheckpointService;

  beforeEach(() => {
    checkpointService = createMockCheckpointService();
    service = new RunService({ checkpointService });
  });

  describe('taskToRun', () => {
    it('should convert task to run with correct mapping', () => {
      const task = createMockTask();
      const { context } = createMockContext();

      const run = service.taskToRun(task, context);

      expect(run.run_id).toBe('task_001');
      expect(run.task_id).toBe('task_001');
      expect(run.status).toBe('running');
      expect(run.current_stage).toBe('plan');
      expect(run.current_state).toBe('planning');
      expect(run.objective).toBe('Test objective');
    });

    it('should map blocked state correctly', () => {
      const task = createMockTask({
        state: 'blocked',
        blocked_context: { reason: 'Waiting for approval', resume_state: 'developing', waiting_on: 'human' }
      });
      const { context } = createMockContext();

      const run = service.taskToRun(task, context);

      expect(run.status).toBe('blocked');
      expect(run.blocked_reason).toBe('Waiting for approval');
    });

    it('should map published state to succeeded', () => {
      const task = createMockTask({ state: 'published', completed_at: '2026-03-20T02:00:00Z' });
      const { context } = createMockContext();

      const run = service.taskToRun(task, context);

      expect(run.status).toBe('succeeded');
      expect(run.ended_at).toBe('2026-03-20T02:00:00Z');
    });

    it('should include job IDs from task', () => {
      const task = createMockTask({
        active_job_id: 'job_001',
        latest_job_ids: { plan: 'job_001', dev: 'job_002' }
      });
      const { context } = createMockContext();

      const run = service.taskToRun(task, context);

      expect(run.job_ids).toContain('job_001');
      expect(run.job_ids).toContain('job_002');
    });
  });

  describe('mapTaskStateToRunStatus', () => {
    const testCases: [Task['state'], RunStatus][] = [
      ['queued', 'running'],
      ['planning', 'running'],
      ['planned', 'running'],
      ['developing', 'running'],
      ['dev_completed', 'running'],
      ['accepting', 'running'],
      ['accepted', 'running'],
      ['integrating', 'running'],
      ['integrated', 'running'],
      ['publishing', 'running'],
      ['published', 'succeeded'],
      ['blocked', 'blocked'],
      ['cancelled', 'cancelled'],
      ['failed', 'failed'],
      ['rework_required', 'running'],
      ['publish_pending_approval', 'running'],
    ];

    testCases.forEach(([state, expectedStatus]) => {
      it(`should map ${state} to ${expectedStatus}`, () => {
        expect(service.mapTaskStateToRunStatus(state)).toBe(expectedStatus);
      });
    });
  });

  describe('getCurrentStage', () => {
    it('should return plan for planning states', () => {
      expect(service.getCurrentStage('queued')).toBe('plan');
      expect(service.getCurrentStage('planning')).toBe('plan');
      expect(service.getCurrentStage('planned')).toBe('plan');
    });

    it('should return dev for development states', () => {
      expect(service.getCurrentStage('developing')).toBe('dev');
      expect(service.getCurrentStage('dev_completed')).toBe('dev');
      expect(service.getCurrentStage('rework_required')).toBe('dev');
    });

    it('should return acceptance for acceptance states', () => {
      expect(service.getCurrentStage('accepting')).toBe('acceptance');
      expect(service.getCurrentStage('accepted')).toBe('acceptance');
    });

    it('should return undefined for other states', () => {
      expect(service.getCurrentStage('integrating')).toBeUndefined();
      expect(service.getCurrentStage('published')).toBeUndefined();
      expect(service.getCurrentStage('failed')).toBeUndefined();
    });
  });

  describe('getRun', () => {
    it('should return run for existing task', () => {
      const task = createMockTask();
      const { context, setTask } = createMockContext();
      setTask(task);

      const run = service.getRun('task_001', context);

      expect(run).toBeDefined();
      expect(run?.run_id).toBe('task_001');
    });

    it('should return undefined for non-existing task', () => {
      const { context } = createMockContext();

      const run = service.getRun('nonexistent', context);

      expect(run).toBeUndefined();
    });
  });

  describe('listRuns', () => {
    it('should list all runs sorted by updated_at descending', () => {
      const task1 = createMockTask({ task_id: 'task_001', updated_at: '2026-03-20T01:00:00Z' });
      const task2 = createMockTask({ task_id: 'task_002', updated_at: '2026-03-20T02:00:00Z' });
      const task3 = createMockTask({ task_id: 'task_003', updated_at: '2026-03-20T00:00:00Z' });
      const { context } = createMockContext();

      const runs = service.listRuns([task1, task2, task3], context);

      expect(runs).toHaveLength(3);
      expect(runs[0].task_id).toBe('task_002'); // Most recent first
      expect(runs[1].task_id).toBe('task_001');
      expect(runs[2].task_id).toBe('task_003');
    });

    it('should filter by status', () => {
      const task1 = createMockTask({ task_id: 'task_001', state: 'planning' });
      const task2 = createMockTask({ task_id: 'task_002', state: 'blocked' });
      const task3 = createMockTask({ task_id: 'task_003', state: 'published' });
      const { context } = createMockContext();

      const runs = service.listRuns([task1, task2, task3], context, { status: ['blocked', 'succeeded'] });

      expect(runs).toHaveLength(2);
      expect(runs.map(r => r.status)).toContain('blocked');
      expect(runs.map(r => r.status)).toContain('succeeded');
    });

    it('should apply pagination', () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createMockTask({ task_id: `task_${i.toString().padStart(3, '0')}`, updated_at: `2026-03-20T0${i}:00:00Z` })
      );
      const { context } = createMockContext();

      const page1 = service.listRuns(tasks, context, { limit: 3, offset: 0 });
      const page2 = service.listRuns(tasks, context, { limit: 3, offset: 3 });

      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);
      expect(page1[0].task_id).not.toBe(page2[0].task_id);
    });
  });

  describe('getRunTimeline', () => {
    it('should return events sorted chronologically', () => {
      const events: StateTransitionEvent[] = [
        { event_id: 'evt_3', task_id: 'task_001', from_state: 'planned', to_state: 'developing', actor_type: 'control_plane', actor_id: 'cp', reason: 'dispatch', occurred_at: '2026-03-20T03:00:00Z' },
        { event_id: 'evt_1', task_id: 'task_001', from_state: 'queued', to_state: 'planning', actor_type: 'control_plane', actor_id: 'cp', reason: 'dispatch', occurred_at: '2026-03-20T01:00:00Z' },
        { event_id: 'evt_2', task_id: 'task_001', from_state: 'planning', to_state: 'planned', actor_type: 'worker', actor_id: 'worker_1', reason: 'done', occurred_at: '2026-03-20T02:00:00Z' },
      ];
      const { context } = createMockContext(events);

      const timeline = service.getRunTimeline('task_001', context);

      expect(timeline).toHaveLength(3);
      expect(timeline[0].event_id).toBe('evt_1');
      expect(timeline[1].event_id).toBe('evt_2');
      expect(timeline[2].event_id).toBe('evt_3');
    });
  });

  describe('getRunAuditSummary', () => {
    it('should count events by type', () => {
      const auditEvents: AuditEvent[] = [
        { event_id: 'a1', event_type: 'run.started', task_id: 'task_001', actor_type: 'control_plane', actor_id: 'cp', payload: {}, occurred_at: '2026-03-20T01:00:00Z' },
        { event_id: 'a2', event_type: 'run.started', task_id: 'task_001', actor_type: 'control_plane', actor_id: 'cp', payload: {}, occurred_at: '2026-03-20T02:00:00Z' },
        { event_id: 'a3', event_type: 'run.completed', task_id: 'task_001', actor_type: 'control_plane', actor_id: 'cp', payload: {}, occurred_at: '2026-03-20T03:00:00Z' },
      ];
      const { context } = createMockContext([], auditEvents);

      const summary = service.getRunAuditSummary('task_001', context);

      expect(summary.event_counts['run.started']).toBe(2);
      expect(summary.event_counts['run.completed']).toBe(1);
      expect(summary.total_events).toBe(3);
    });

    it('should return latest 10 events sorted by time', () => {
      const auditEvents: AuditEvent[] = Array.from({ length: 15 }, (_, i) => ({
        event_id: `a${i}`,
        event_type: 'run.progress',
        task_id: 'task_001',
        actor_type: 'control_plane' as const,
        actor_id: 'cp',
        payload: { step: i },
        occurred_at: `2026-03-20T${i.toString().padStart(2, '0')}:00:00Z`,
      }));
      const { context } = createMockContext([], auditEvents);

      const summary = service.getRunAuditSummary('task_001', context);

      expect(summary.latest_events).toHaveLength(10);
      // Most recent first
      expect(summary.latest_events[0].event_id).toBe('a14');
    });
  });

  describe('getJobIdsForTask', () => {
    it('should collect active and latest job IDs', () => {
      const task = createMockTask({
        active_job_id: 'job_active',
        latest_job_ids: { plan: 'job_plan', dev: 'job_dev', acceptance: 'job_acceptance' }
      });

      const jobIds = service.getJobIdsForTask(task);

      expect(jobIds).toContain('job_active');
      expect(jobIds).toContain('job_plan');
      expect(jobIds).toContain('job_dev');
      expect(jobIds).toContain('job_acceptance');
      expect(jobIds).toHaveLength(4);
    });

    it('should deduplicate job IDs', () => {
      const task = createMockTask({
        active_job_id: 'job_001',
        latest_job_ids: { plan: 'job_001', dev: 'job_002' }
      });

      const jobIds = service.getJobIdsForTask(task);

      expect(jobIds).toHaveLength(2);
      expect(jobIds.filter(id => id === 'job_001')).toHaveLength(1);
    });
  });
});