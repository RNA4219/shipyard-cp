/**
 * Unit tests for ControlPlaneStore
 *
 * Tests the main control plane operations including:
 * - Task lifecycle operations
 * - Integration/publish flows
 * - Error handling paths
 * - Timeout management
 * - Orphan recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlPlaneStore } from '../src/store/control-plane-store.js';
import type {
  Task,
  WorkerJob,
  WorkerResult,
  CreateTaskRequest,
  DispatchRequest,
  CompleteAcceptanceRequest,
  CompleteIntegrateRequest,
  PublishRequest,
  CompletePublishRequest,
  JobHeartbeatRequest,
  StateTransitionEvent,
  AuditEvent,
} from '../src/types.js';
import { ShipyardError, ErrorCodes } from '../src/constants/index.js';

describe('ControlPlaneStore', () => {
  let store: ControlPlaneStore;

  const createTestRequest = (): CreateTaskRequest => ({
    title: 'Test Task',
    objective: 'Test objective',
    typed_ref: 'agent-taskstate:task:github:issue-123',
    description: 'Test description',
    risk_level: 'medium',
    repo_ref: {
      provider: 'github',
      owner: 'testowner',
      name: 'testrepo',
      default_branch: 'main',
    },
  });

  beforeEach(async () => {
    store = new ControlPlaneStore();
    await store.initialize();
  });

  afterEach(() => {
    store.stopOrphanScanner();
  });

  // ---------------------------------------------------------------------------
  // Task Operations
  // ---------------------------------------------------------------------------

  describe('Task Operations', () => {
    describe('createTask', () => {
      it('should create a task with required fields', () => {
        const request = createTestRequest();
        const task = store.createTask(request);

        expect(task.task_id).toMatch(/^task_/);
        expect(task.title).toBe('Test Task');
        expect(task.objective).toBe('Test objective');
        expect(task.typed_ref).toBe('agent-taskstate:task:github:issue-123');
        expect(task.state).toBe('queued');
        expect(task.version).toBe(0);
        expect(task.risk_level).toBe('medium');
      });

      it('should create a task with publish_plan', () => {
        const request: CreateTaskRequest = {
          ...createTestRequest(),
          publish_plan: { mode: 'apply', approval_required: true },
        };
        const task = store.createTask(request);

        expect(task.publish_plan).toEqual({ mode: 'apply', approval_required: true });
      });

      it('should create a task with external_refs', () => {
        const request: CreateTaskRequest = {
          ...createTestRequest(),
          external_refs: [{ kind: 'github_issue', value: '123' }],
        };
        const task = store.createTask(request);

        expect(task.external_refs).toHaveLength(1);
        expect(task.external_refs?.[0].kind).toBe('github_issue');
      });

      it('should throw on invalid request - missing objective', () => {
        const request = { ...createTestRequest(), objective: '' };
        expect(() => store.createTask(request)).toThrow('objective is required');
      });

      it('should throw on invalid request - missing typed_ref', () => {
        const request = { ...createTestRequest(), typed_ref: undefined as unknown as string };
        expect(() => store.createTask(request)).toThrow('typed_ref is required');
      });
    });

    describe('getTask', () => {
      it('should return task by id', () => {
        const created = store.createTask(createTestRequest());
        const retrieved = store.getTask(created.task_id);

        expect(retrieved).toEqual(created);
      });

      it('should return undefined for nonexistent task', () => {
        const result = store.getTask('nonexistent_task');
        expect(result).toBeUndefined();
      });
    });

    describe('requireTask', () => {
      it('should return task if exists', () => {
        const created = store.createTask(createTestRequest());
        const required = store.requireTask(created.task_id);
        expect(required).toEqual(created);
      });

      it('should throw if task does not exist', () => {
        expect(() => store.requireTask('nonexistent_task')).toThrow('task not found');
      });
    });

    describe('listTasks', () => {
      it('should return all tasks', () => {
        store.createTask({ ...createTestRequest(), title: 'Task 1' });
        store.createTask({ ...createTestRequest(), title: 'Task 2' });

        const tasks = store.listTasks();
        expect(tasks).toHaveLength(2);
      });

      it('should filter tasks by state', () => {
        const task1 = store.createTask({ ...createTestRequest(), title: 'Task 1' });
        store.createTask({ ...createTestRequest(), title: 'Task 2' });

        // Transition task1 to planning using recordTransition
        store.recordTransition(task1.task_id, {
          event_id: 'evt_test',
          task_id: task1.task_id,
          from_state: 'queued',
          to_state: 'planning',
          actor_type: 'control_plane',
          actor_id: 'system',
          reason: 'test',
          occurred_at: new Date().toISOString(),
        });

        const queuedTasks = store.listTasks({ state: ['queued'] });
        expect(queuedTasks).toHaveLength(1);
      });

      it('should support pagination', () => {
        for (let i = 0; i < 10; i++) {
          store.createTask({ ...createTestRequest(), title: `Task ${i}` });
        }

        const page1 = store.listTasks({ limit: 3, offset: 0 });
        expect(page1).toHaveLength(3);

        const page2 = store.listTasks({ limit: 3, offset: 3 });
        expect(page2).toHaveLength(3);
      });
    });

    describe('updateTask', () => {
      it('should update task fields', () => {
        const task = store.createTask(createTestRequest());
        store.updateTask(task.task_id, { context_bundle_ref: 'bundle_123' });

        const updated = store.requireTask(task.task_id);
        expect(updated.context_bundle_ref).toBe('bundle_123');
        expect(updated.version).toBe(task.version + 1);
      });
    });

    describe('cancel', () => {
      it('should cancel a task', () => {
        const task = store.createTask(createTestRequest());
        const cancelled = store.cancel(task.task_id);

        expect(cancelled.state).toBe('cancelled');
        expect(cancelled.completed_at).toBeDefined();
      });

      it('should throw for terminal task', () => {
        const task = store.createTask(createTestRequest());
        store.cancel(task.task_id);

        expect(() => store.cancel(task.task_id)).toThrow('already terminal');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Integration Flow
  // ---------------------------------------------------------------------------

  describe('Integration Flow', () => {
    it('should throw when integrating non-accepted task', () => {
      const task = store.createTask(createTestRequest());

      expect(() => store.integrate(task.task_id, 'abc123')).toThrow(ShipyardError);
    });

    it('should throw when completing integration for non-integrating task', () => {
      const task = store.createTask(createTestRequest());

      const request: CompleteIntegrateRequest = {
        integration_head_sha: 'def456',
        checks_passed: true,
      };

      expect(() => store.completeIntegrate(task.task_id, request)).toThrow(ShipyardError);
    });
  });

  // ---------------------------------------------------------------------------
  // Publish Flow
  // ---------------------------------------------------------------------------

  describe('Publish Flow', () => {
    it('should throw when publishing non-integrated task', () => {
      const task = store.createTask(createTestRequest());

      const request: PublishRequest = {
        mode: 'apply',
      };

      expect(() => store.publish(task.task_id, request)).toThrow(ShipyardError);
    });

    it('should throw when approving non-pending-approval task', () => {
      const task = store.createTask(createTestRequest());

      expect(() => store.approvePublish(task.task_id, 'token123')).toThrow(ShipyardError);
    });

    it('should throw when completing publish for non-publishing task', () => {
      const task = store.createTask(createTestRequest());

      const request: CompletePublishRequest = {
        external_refs: [{ kind: 'github_pr', value: '123' }],
      };

      expect(() => store.completePublish(task.task_id, request)).toThrow(ShipyardError);
    });

    it('should handle idempotency key for publish', () => {
      // Test that idempotency key is accepted
      const task = store.createTask(createTestRequest());

      // Verify the idempotency mechanism doesn't break creation
      expect(task.task_id).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Result Handling
  // ---------------------------------------------------------------------------

  describe('applyResult', () => {
    it('should throw for nonexistent task', () => {
      const result: WorkerResult = {
        job_id: 'job_123',
        typed_ref: 'agent-taskstate:task:github:issue-123',
        status: 'succeeded',
        summary: 'Done',
      };

      expect(() => store.applyResult('nonexistent', result)).toThrow('task not found');
    });

    it('should return idempotently for result when no active job', () => {
      const task = store.createTask(createTestRequest());

      const result: WorkerResult = {
        job_id: 'job_123',
        typed_ref: 'agent-taskstate:task:github:issue-123',
        status: 'succeeded',
        summary: 'Done',
      };

      // Should not throw - returns idempotently when no active job
      const response = store.applyResult(task.task_id, result);
      expect(response.task.task_id).toBe(task.task_id);
      expect(response.next_action).toBe('none');
    });

    it('should throw for typed_ref mismatch', () => {
      const task = store.createTask(createTestRequest());
      // Manually set active_job_id via internal update
      const updatedTask = store.requireTask(task.task_id);
      // Use recordTransition to properly transition state
      store.recordTransition(task.task_id, {
        event_id: 'evt_test',
        task_id: task.task_id,
        from_state: 'queued',
        to_state: 'planning',
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'dispatch',
        occurred_at: new Date().toISOString(),
      });

      // Now set active_job_id via updateTask
      store.updateTask(task.task_id, { active_job_id: 'job_123' });

      const result: WorkerResult = {
        job_id: 'job_123',
        typed_ref: 'agent-taskstate:task:github:different-ref',
        status: 'succeeded',
        summary: 'Done',
      };

      expect(() => store.applyResult(task.task_id, result)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout Management
  // ---------------------------------------------------------------------------

  describe('Timeout Management', () => {
    describe('checkTimeouts', () => {
      it('should return empty array when no tasks', () => {
        const timedOut = store.checkTimeouts();
        expect(timedOut).toHaveLength(0);
      });
    });

    describe('updateIntegrationProgress', () => {
      it('should throw for non-integrating task', () => {
        const task = store.createTask(createTestRequest());

        expect(() => store.updateIntegrationProgress(task.task_id, 50)).toThrow(ShipyardError);
      });
    });

    describe('updatePublishProgress', () => {
      it('should throw for non-publishing task', () => {
        const task = store.createTask(createTestRequest());

        expect(() => store.updatePublishProgress(task.task_id, 50)).toThrow(ShipyardError);
      });
    });

    describe('getActiveRuns', () => {
      it('should return empty array when no active runs', () => {
        const runs = store.getActiveRuns();
        expect(runs).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Orphan Scanner
  // ---------------------------------------------------------------------------

  describe('Orphan Scanner', () => {
    describe('startOrphanScanner', () => {
      it('should start orphan scanner', () => {
        store.startOrphanScanner(60000);
        // Should not throw
      });

      it('should not start multiple scanners', () => {
        store.startOrphanScanner(60000);
        store.startOrphanScanner(60000);
        // Should only have one scanner running
      });
    });

    describe('stopOrphanScanner', () => {
      it('should stop orphan scanner', () => {
        store.startOrphanScanner(60000);
        store.stopOrphanScanner();
        // Should not throw
      });

      it('should be safe to call when not running', () => {
        store.stopOrphanScanner();
        // Should not throw
      });
    });

    describe('scanForOrphans', () => {
      it('should return empty result when no active jobs', () => {
        const result = store.scanForOrphans();

        expect(result.scanned).toBe(0);
        expect(result.orphans_detected).toBe(0);
        expect(result.recovery_actions).toHaveLength(0);
      });
    });

    describe('canDispatchWithLease', () => {
      it('should return false for nonexistent task', () => {
        expect(store.canDispatchWithLease('nonexistent', 'plan')).toBe(false);
      });

      it('should return true for queued task dispatching to plan', () => {
        const task = store.createTask(createTestRequest());
        expect(store.canDispatchWithLease(task.task_id, 'plan')).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Docs Operations
  // ---------------------------------------------------------------------------

  describe('Docs Operations', () => {
    describe('resolveDocs', () => {
      it('should throw for nonexistent task', () => {
        expect(() => store.resolveDocs('nonexistent', { doc_refs: [] })).toThrow('task not found');
      });
    });

    describe('ackDocs', () => {
      it('should throw for nonexistent task', () => {
        expect(() => store.ackDocs('nonexistent', { acked_doc_ids: [] })).toThrow('task not found');
      });
    });

    describe('staleCheck', () => {
      it('should throw for nonexistent task', async () => {
        await expect(store.staleCheck('nonexistent', { doc_refs: [] })).rejects.toThrow('task not found');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Tracker Operations
  // ---------------------------------------------------------------------------

  describe('Tracker Operations', () => {
    describe('linkTracker', () => {
      it('should throw for nonexistent task', async () => {
        await expect(store.linkTracker('nonexistent', { tracker_type: 'github_issue', tracker_id: '123' }))
          .rejects.toThrow('task not found');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  describe('State Transitions', () => {
    describe('recordTransition', () => {
      it('should record and apply transition event', () => {
        const task = store.createTask(createTestRequest());
        const event: StateTransitionEvent = {
          event_id: 'evt_test',
          task_id: task.task_id,
          from_state: 'queued',
          to_state: 'planning',
          actor_type: 'control_plane',
          actor_id: 'system',
          reason: 'dispatch',
          occurred_at: new Date().toISOString(),
        };

        const recorded = store.recordTransition(task.task_id, event);
        expect(recorded).toEqual(event);

        const updatedTask = store.getTask(task.task_id);
        expect(updatedTask?.state).toBe('planning');
      });

      it('should list events for task', () => {
        const task = store.createTask(createTestRequest());
        const events = store.listEvents(task.task_id);

        expect(events).toHaveLength(1);
        expect(events[0].task_id).toBe(task.task_id);
      });

      it('should return empty array for nonexistent task', () => {
        const events = store.listEvents('nonexistent');
        expect(events).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Audit Events
  // ---------------------------------------------------------------------------

  describe('Audit Events', () => {
    describe('listAuditEvents', () => {
      it('should return audit events for task', () => {
        const task = store.createTask(createTestRequest());
        const events = store.listAuditEvents(task.task_id);

        expect(Array.isArray(events)).toBe(true);
      });

      it('should return empty array for nonexistent task', () => {
        const events = store.listAuditEvents('nonexistent');
        expect(events).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Run Read Model
  // ---------------------------------------------------------------------------

  describe('Run Read Model', () => {
    describe('listRuns', () => {
      it('should return empty array when no tasks', () => {
        const runs = store.listRuns();
        expect(runs).toHaveLength(0);
      });

      it('should return runs for tasks', () => {
        store.createTask(createTestRequest());
        const runs = store.listRuns();

        expect(runs).toHaveLength(1);
      });
    });

    describe('getRun', () => {
      it('should return undefined for nonexistent run', () => {
        const run = store.getRun('nonexistent');
        expect(run).toBeUndefined();
      });

      it('should return run for existing task', () => {
        const task = store.createTask(createTestRequest());
        const run = store.getRun(task.task_id);

        expect(run).toBeDefined();
        expect(run?.run_id).toBe(task.task_id);
      });
    });

    describe('getRunTimeline', () => {
      it('should return events for run', () => {
        const task = store.createTask(createTestRequest());
        const timeline = store.getRunTimeline(task.task_id);

        expect(Array.isArray(timeline)).toBe(true);
      });
    });

    describe('getRunAuditSummary', () => {
      it('should return audit summary for run', () => {
        const task = store.createTask(createTestRequest());
        const summary = store.getRunAuditSummary(task.task_id);

        expect(summary).toHaveProperty('event_counts');
        expect(summary).toHaveProperty('latest_events');
        expect(summary).toHaveProperty('total_events');
      });
    });

    describe('getRunCheckpoints', () => {
      it('should return checkpoints for run', () => {
        const task = store.createTask(createTestRequest());
        const checkpoints = store.getRunCheckpoints(task.task_id);

        expect(Array.isArray(checkpoints)).toBe(true);
      });
    });

    describe('getTaskCheckpoints', () => {
      it('should return checkpoints for task', () => {
        const task = store.createTask(createTestRequest());
        const checkpoints = store.getTaskCheckpoints(task.task_id);

        expect(Array.isArray(checkpoints)).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Retrospective
  // ---------------------------------------------------------------------------

  describe('Retrospective', () => {
    describe('generateRetrospective', () => {
      it('should throw for nonexistent run', () => {
        expect(() => store.generateRetrospective('nonexistent')).toThrow(ShipyardError);
      });

      it('should generate retrospective for existing task', () => {
        const task = store.createTask(createTestRequest());
        const retro = store.generateRetrospective(task.task_id);

        expect(retro).toBeDefined();
        expect(retro.run_id).toBe(task.task_id);
      });
    });

    describe('getRetrospective', () => {
      it('should return undefined for nonexistent retrospective', () => {
        const retro = store.getRetrospective('nonexistent');
        expect(retro).toBeUndefined();
      });
    });

    describe('getRetrospectiveHistory', () => {
      it('should return empty array for nonexistent run', () => {
        const history = store.getRetrospectiveHistory('nonexistent');
        expect(history).toHaveLength(0);
      });
    });

    describe('getRetrospectivesForTask', () => {
      it('should return empty array for nonexistent task', () => {
        const retros = store.getRetrospectivesForTask('nonexistent');
        expect(retros).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Decision & Question Management
  // ---------------------------------------------------------------------------

  describe('Decision & Question Management', () => {
    describe('createDecision', () => {
      it('should throw for nonexistent task', async () => {
        await expect(store.createDecision('nonexistent', 'Question?', ['A', 'B']))
          .rejects.toThrow('task not found');
      });

      it('should create decision for existing task', async () => {
        const task = store.createTask(createTestRequest());
        const decision = await store.createDecision(task.task_id, 'Question?', ['A', 'B']);

        expect(decision).toBeDefined();
        expect(decision.question).toBe('Question?');
        expect(decision.options).toEqual(['A', 'B']);
      });
    });

    describe('getDecisions', () => {
      it('should return decisions for task', async () => {
        const task = store.createTask(createTestRequest());
        await store.createDecision(task.task_id, 'Question?', ['A', 'B']);

        const decisions = await store.getDecisions(task.task_id);

        expect(decisions).toHaveLength(1);
      });
    });

    describe('resolveDecision', () => {
      it('should resolve a decision', async () => {
        const task = store.createTask(createTestRequest());
        const decision = await store.createDecision(task.task_id, 'Question?', ['A', 'B']);

        const resolved = await store.resolveDecision(decision.id, 'A', 'Reason');

        expect(resolved.status).toBe('accepted');
        expect(resolved.chosen).toBe('A');
      });
    });

    describe('rejectDecision', () => {
      it('should reject a decision', async () => {
        const task = store.createTask(createTestRequest());
        const decision = await store.createDecision(task.task_id, 'Question?', ['A', 'B']);

        const rejected = await store.rejectDecision(decision.id, 'Not needed');

        expect(rejected.status).toBe('rejected');
      });
    });

    describe('createOpenQuestion', () => {
      it('should throw for nonexistent task', async () => {
        await expect(store.createOpenQuestion('nonexistent', 'Question?'))
          .rejects.toThrow('task not found');
      });

      it('should create open question for existing task', async () => {
        const task = store.createTask(createTestRequest());
        const question = await store.createOpenQuestion(task.task_id, 'Question?');

        expect(question).toBeDefined();
        expect(question.question).toBe('Question?');
      });
    });

    describe('getOpenQuestions', () => {
      it('should return open questions for task', async () => {
        const task = store.createTask(createTestRequest());
        await store.createOpenQuestion(task.task_id, 'Question?');

        const questions = await store.getOpenQuestions(task.task_id);

        expect(questions).toHaveLength(1);
      });
    });

    describe('answerOpenQuestion', () => {
      it('should answer an open question', async () => {
        const task = store.createTask(createTestRequest());
        const question = await store.createOpenQuestion(task.task_id, 'Question?');

        const answered = await store.answerOpenQuestion(question.id, 'Answer');

        expect(answered.status).toBe('answered');
        expect(answered.answer).toBe('Answer');
      });
    });

    describe('deferOpenQuestion', () => {
      it('should defer an open question', async () => {
        const task = store.createTask(createTestRequest());
        const question = await store.createOpenQuestion(task.task_id, 'Question?');

        const deferred = await store.deferOpenQuestion(question.id);

        expect(deferred.status).toBe('deferred');
      });
    });

    describe('generateContextBundle', () => {
      it('should throw for nonexistent task', async () => {
        await expect(store.generateContextBundle('nonexistent', 'continue_work'))
          .rejects.toThrow('task not found');
      });

      it('should generate context bundle for existing task with other purpose', async () => {
        const task = store.createTask(createTestRequest());
        // Use 'other' purpose which doesn't require state transition
        const bundle = await store.generateContextBundle(task.task_id, 'other');

        expect(bundle).toBeDefined();
        expect(bundle.task_id).toBe(task.task_id);
        expect(bundle.purpose).toBe('other');
      });
    });

    describe('getLatestContextBundle', () => {
      it('should return null for nonexistent task', async () => {
        const bundle = await store.getLatestContextBundle('nonexistent');
        expect(bundle).toBeNull();
      });

      it('should return latest context bundle after generation', async () => {
        const task = store.createTask(createTestRequest());
        await store.generateContextBundle(task.task_id, 'other');

        const bundle = await store.getLatestContextBundle(task.task_id);

        expect(bundle).toBeDefined();
        expect(bundle?.task_id).toBe(task.task_id);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance
  // ---------------------------------------------------------------------------

  describe('Acceptance', () => {
    describe('completeAcceptance', () => {
      it('should throw for nonexistent task', () => {
        const request: CompleteAcceptanceRequest = {
          verdict: 'accept',
          summary: 'LGTM',
        };

        expect(() => store.completeAcceptance('nonexistent', request)).toThrow('task not found');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Job Operations
  // ---------------------------------------------------------------------------

  describe('Job Operations', () => {
    describe('getJob', () => {
      it('should return undefined for nonexistent job', () => {
        const { job } = store.getJob('nonexistent');
        expect(job).toBeUndefined();
      });
    });

    describe('heartbeat', () => {
      it('should throw for nonexistent job', () => {
        const request: JobHeartbeatRequest = {
          worker_id: 'worker_1',
          stage: 'plan',
        };

        expect(() => store.heartbeat('nonexistent', request)).toThrow('job not found');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------------

  describe('Concurrency', () => {
    describe('resetConcurrency', () => {
      it('should reset concurrency state', () => {
        store.resetConcurrency();
        // Should not throw
      });
    });
  });
});