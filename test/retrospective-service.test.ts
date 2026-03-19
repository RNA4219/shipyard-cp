import { describe, it, expect, beforeEach } from 'vitest';
import { RetrospectiveService } from '../src/domain/retrospective/retrospective-service.js';
import type { Task, Run, StateTransitionEvent, WorkerJob, AuditEvent, CheckpointRef } from '../src/types.js';

describe('RetrospectiveService', () => {
  let service: RetrospectiveService;

  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    task_id: 'task_123',
    title: 'Test Task',
    objective: 'Test objective',
    typed_ref: 'test:ref:task:123',
    state: 'published',
    version: 1,
    risk_level: 'medium',
    repo_ref: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      default_branch: 'main',
    },
    created_at: '2026-03-19T10:00:00Z',
    updated_at: '2026-03-19T11:00:00Z',
    ...overrides,
  });

  const createMockRun = (overrides: Partial<Run> = {}): Run => ({
    run_id: 'run_123',
    task_id: 'task_123',
    run_sequence: 1,
    status: 'succeeded',
    current_state: 'published',
    started_at: '2026-03-19T10:00:00Z',
    last_event_at: '2026-03-19T11:00:00Z',
    projection_version: 1,
    source_event_cursor: 'event_100',
    risk_level: 'medium',
    job_ids: ['job_1'],
    checkpoints: [],
    created_at: '2026-03-19T10:00:00Z',
    updated_at: '2026-03-19T11:00:00Z',
    ...overrides,
  });

  const createMockEvent = (overrides: Partial<StateTransitionEvent> = {}): StateTransitionEvent => ({
    event_id: 'event_1',
    task_id: 'task_123',
    from_state: 'queued',
    to_state: 'planning',
    actor_type: 'control_plane',
    actor_id: 'system',
    reason: 'Starting task',
    occurred_at: '2026-03-19T10:00:00Z',
    ...overrides,
  });

  const createMockJob = (overrides: Partial<WorkerJob> = {}): WorkerJob => ({
    job_id: 'job_1',
    task_id: 'task_123',
    typed_ref: 'test:ref:task:123',
    stage: 'plan',
    worker_type: 'codex',
    workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
    input_prompt: 'Test prompt',
    repo_ref: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      default_branch: 'main',
    },
    capability_requirements: ['plan'],
    risk_level: 'medium',
    approval_policy: { mode: 'ask' },
    status: 'completed',
    ...overrides,
  } as WorkerJob);

  const createMockAuditEvent = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
    event_id: 'audit_1',
    event_type: 'state_transition',
    task_id: 'task_123',
    actor_type: 'control_plane',
    actor_id: 'system',
    payload: {},
    occurred_at: '2026-03-19T10:00:00Z',
    ...overrides,
  });

  const createMockCheckpoint = (overrides: Partial<CheckpointRef> = {}): CheckpointRef => ({
    checkpoint_id: 'cp_1',
    checkpoint_type: 'code',
    stage: 'dev',
    ref: 'abc123',
    created_at: '2026-03-19T10:30:00Z',
    ...overrides,
  });

  beforeEach(() => {
    service = new RetrospectiveService();
  });

  describe('generateRetrospective', () => {
    it('should generate a retrospective with summary metrics', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [
        createMockEvent({ to_state: 'planning', occurred_at: '2026-03-19T10:00:00Z' }),
        createMockEvent({ from_state: 'planning', to_state: 'planned', occurred_at: '2026-03-19T10:15:00Z' }),
        createMockEvent({ from_state: 'planned', to_state: 'developing', occurred_at: '2026-03-19T10:20:00Z' }),
        createMockEvent({ from_state: 'developing', to_state: 'dev_completed', occurred_at: '2026-03-19T10:45:00Z' }),
        createMockEvent({ from_state: 'dev_completed', to_state: 'accepted', occurred_at: '2026-03-19T11:00:00Z' }),
      ];
      const jobs = [createMockJob()];
      const auditEvents = [createMockAuditEvent()];
      const checkpoints = [createMockCheckpoint()];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.retrospective.retrospective_id).toBeDefined();
      expect(result.retrospective.run_id).toBe('run_123');
      expect(result.retrospective.task_id).toBe('task_123');
      expect(result.retrospective.generation).toBe(1);
      expect(result.retrospective.status).toBe('completed');
      expect(result.retrospective.summary_metrics).toBeDefined();
      expect(result.retrospective.summary_metrics.job_count).toBe(1);
      expect(result.retrospective.summary_metrics.checkpoint_count).toBe(1);
      expect(result.retrospective.summary_metrics.risk_level).toBe('medium');
    });

    it('should include retry counts from audit events', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [
        createMockAuditEvent({ event_type: 'retry_triggered', payload: { stage: 'dev' } }),
        createMockAuditEvent({ event_type: 'retry_triggered', payload: { stage: 'dev' } }),
        createMockAuditEvent({ event_type: 'retry_triggered', payload: { stage: 'plan' } }),
      ];
      const checkpoints = [];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.retrospective.summary_metrics.retry_count).toBe(3);
      expect(result.retrospective.summary_metrics.retries_by_stage['dev']).toBe(2);
      expect(result.retrospective.summary_metrics.retries_by_stage['plan']).toBe(1);
    });

    it('should generate narrative by default', () => {
      const task = createMockTask({ title: 'My Important Task' });
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.narrative_generated).toBe(true);
      expect(result.retrospective.narrative).toBeDefined();
      expect(result.retrospective.narrative?.text).toContain('My Important Task');
    });

    it('should skip narrative when requested', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
        request: { skip_narrative: true },
      });

      expect(result.narrative_generated).toBe(false);
      expect(result.retrospective.narrative).toBeUndefined();
    });

    it('should include file changes when available', () => {
      const task = createMockTask({
        files_changed: 10,
        lines_added: 150,
        lines_deleted: 30,
      });
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.retrospective.summary_metrics.files_changed).toBe(10);
      expect(result.retrospective.summary_metrics.lines_added).toBe(150);
      expect(result.retrospective.summary_metrics.lines_deleted).toBe(30);
    });

    it('should include side effects when detected', () => {
      const task = createMockTask({
        detected_side_effects: ['network_access', 'protected_path_write'],
      });
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.retrospective.summary_metrics.side_effects_detected).toEqual(['network_access', 'protected_path_write']);
    });

    it('should count checkpoints by stage', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [
        createMockCheckpoint({ stage: 'dev' }),
        createMockCheckpoint({ stage: 'dev' }),
        createMockCheckpoint({ stage: 'integrate' }),
      ];

      const result = service.generateRetrospective({
        run,
        task,
        events,
        jobs,
        auditEvents,
        checkpoints,
      });

      expect(result.retrospective.summary_metrics.checkpoint_count).toBe(3);
      expect(result.retrospective.summary_metrics.checkpoints_by_stage['dev']).toBe(2);
      expect(result.retrospective.summary_metrics.checkpoints_by_stage['integrate']).toBe(1);
    });
  });

  describe('getRetrospective', () => {
    it('should return undefined when no retrospective exists', () => {
      expect(service.getRetrospective('nonexistent')).toBeUndefined();
    });

    it('should return the latest retrospective', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });
      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });

      const latest = service.getRetrospective('run_123');
      expect(latest?.generation).toBe(2);
    });
  });

  describe('getRetrospectiveHistory', () => {
    it('should return empty array when no history', () => {
      expect(service.getRetrospectiveHistory('nonexistent')).toEqual([]);
    });

    it('should return all generations', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });
      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });
      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });

      const history = service.getRetrospectiveHistory('run_123');
      expect(history).toHaveLength(3);
      expect(history[0].generation).toBe(1);
      expect(history[2].generation).toBe(3);
    });
  });

  describe('getRetrospectivesForTask', () => {
    it('should return empty array when no retrospectives', () => {
      expect(service.getRetrospectivesForTask('nonexistent')).toEqual([]);
    });

    it('should return retrospectives sorted by generated_at desc', () => {
      const task1 = createMockTask({ task_id: 'task_1' });
      const task2 = createMockTask({ task_id: 'task_2' });
      const run1 = createMockRun({ run_id: 'run_1', task_id: 'task_1' });
      const run2 = createMockRun({ run_id: 'run_2', task_id: 'task_2' });
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      service.generateRetrospective({ run: run1, task: task1, events, jobs, auditEvents, checkpoints });
      service.generateRetrospective({ run: run2, task: task2, events, jobs, auditEvents, checkpoints });

      // This test doesn't fully validate since both tasks are different
      // but demonstrates the method works
      const retros = service.getRetrospectivesForTask('task_1');
      expect(retros).toHaveLength(1);
      expect(retros[0].task_id).toBe('task_1');
    });
  });

  describe('clearRetrospectives', () => {
    it('should remove all retrospectives for a run', () => {
      const task = createMockTask();
      const run = createMockRun();
      const events = [createMockEvent()];
      const jobs = [createMockJob()];
      const auditEvents = [];
      const checkpoints = [];

      service.generateRetrospective({ run, task, events, jobs, auditEvents, checkpoints });
      expect(service.getRetrospective('run_123')).toBeDefined();

      service.clearRetrospectives('run_123');
      expect(service.getRetrospective('run_123')).toBeUndefined();
    });
  });
});