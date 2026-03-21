import { describe, it, expect, beforeEach } from 'vitest';
import { TaskService, type TaskOperationContext } from '../src/store/services/task-service.js';
import type { Task, CreateTaskRequest, StateTransitionEvent, AuditEvent } from '../src/types.js';

describe('TaskService', () => {
  let service: TaskService;
  let recordedEvents: StateTransitionEvent[];
  let auditEvents: AuditEvent[];

  const mockContext: TaskOperationContext = {
    emitAuditEvent: (taskId: string, eventType: AuditEvent['event_type'], payload: Record<string, unknown>, options?: { runId?: string; jobId?: string; actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system'; actorId?: string }) => {
      const event: AuditEvent = {
        event_id: `audit_${Date.now()}`,
        event_type: eventType,
        task_id: taskId,
        payload,
        run_id: options?.runId,
        job_id: options?.jobId,
        actor_type: options?.actorType ?? 'control_plane',
        actor_id: options?.actorId ?? 'control_plane',
        occurred_at: new Date().toISOString(),
      };
      auditEvents.push(event);
      return event;
    },
    recordEvent: (event: StateTransitionEvent) => {
      recordedEvents.push(event);
    },
  };

  beforeEach(() => {
    service = new TaskService();
    recordedEvents = [];
    auditEvents = [];
  });

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

  describe('createTask', () => {
    it('should create a task with required fields', () => {
      const request = createTestRequest();
      const task = service.createTask(request, mockContext);

      expect(task.task_id).toMatch(/^task_/);
      expect(task.title).toBe('Test Task');
      expect(task.objective).toBe('Test objective');
      expect(task.typed_ref).toBe('agent-taskstate:task:github:issue-123');
      expect(task.state).toBe('queued');
      expect(task.version).toBe(0);
      expect(task.risk_level).toBe('medium');
    });

    it('should set default risk_level to medium', () => {
      const request = createTestRequest();
      delete request.risk_level;
      const task = service.createTask(request, mockContext);

      expect(task.risk_level).toBe('medium');
    });

    it('should set default labels to empty array', () => {
      const request = createTestRequest();
      const task = service.createTask(request, mockContext);

      expect(task.labels).toEqual([]);
    });

    it('should set default artifacts to empty array', () => {
      const request = createTestRequest();
      const task = service.createTask(request, mockContext);

      expect(task.artifacts).toEqual([]);
    });

    it('should record state transition event', () => {
      const request = createTestRequest();
      service.createTask(request, mockContext);

      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents[0].task_id).toBeDefined();
      expect(recordedEvents[0].from_state).toBe('queued');
      expect(recordedEvents[0].to_state).toBe('queued');
    });

    it('should throw on invalid request - missing objective', () => {
      const request = { ...createTestRequest(), objective: '' };
      expect(() => service.createTask(request, mockContext)).toThrow('objective is required');
    });

    it('should throw on invalid request - missing typed_ref', () => {
      const request = { ...createTestRequest(), typed_ref: undefined as unknown as string };
      expect(() => service.createTask(request, mockContext)).toThrow('typed_ref is required');
    });
  });

  describe('getTask', () => {
    it('should return task by id', () => {
      const request = createTestRequest();
      const created = service.createTask(request, mockContext);
      const retrieved = service.getTask(created.task_id);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for nonexistent task', () => {
      const result = service.getTask('nonexistent_task');
      expect(result).toBeUndefined();
    });
  });

  describe('listTasks', () => {
    it('should return all tasks sorted by updated_at descending', async () => {
      const task1 = service.createTask({ ...createTestRequest(), title: 'Task 1' }, mockContext);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for timestamp difference
      const task2 = service.createTask({ ...createTestRequest(), title: 'Task 2' }, mockContext);

      // Update task1 to make it newer
      service.touchTask(task1);

      const tasks = service.listTasks();
      expect(tasks).toHaveLength(2);
      // Most recently updated first
      expect(tasks[0].task_id).toBe(task1.task_id);
      expect(tasks[1].task_id).toBe(task2.task_id);
    });

    it('should filter tasks by state', () => {
      const task1 = service.createTask({ ...createTestRequest() }, mockContext);
      service.transitionTask(service.requireTask(task1.task_id), 'planning', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'start planning',
      }, mockContext);

      const task2 = service.createTask({ ...createTestRequest() }, mockContext);

      const queuedTasks = service.listTasks({ state: ['queued'] });
      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].task_id).toBe(task2.task_id);

      const planningTasks = service.listTasks({ state: ['planning'] });
      expect(planningTasks).toHaveLength(1);
      expect(planningTasks[0].task_id).toBe(task1.task_id);
    });

    it('should support pagination with offset and limit', () => {
      for (let i = 0; i < 10; i++) {
        service.createTask({ ...createTestRequest(), title: `Task ${i}` }, mockContext);
      }

      const page1 = service.listTasks({ limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);

      const page2 = service.listTasks({ limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);

      // Ensure different tasks on each page
      const page1Ids = new Set(page1.map(t => t.task_id));
      const page2Ids = new Set(page2.map(t => t.task_id));
      const intersection = [...page1Ids].filter(id => page2Ids.has(id));
      expect(intersection).toHaveLength(0);
    });
  });

  describe('requireTask', () => {
    it('should return task if exists', () => {
      const created = service.createTask(createTestRequest(), mockContext);
      const required = service.requireTask(created.task_id);
      expect(required).toEqual(created);
    });

    it('should throw if task does not exist', () => {
      expect(() => service.requireTask('nonexistent_task')).toThrow('task not found');
    });
  });

  describe('touchTask', () => {
    it('should increment version', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const originalVersion = task.version;

      service.touchTask(task);

      expect(task.version).toBe(originalVersion + 1);
    });

    it('should update updated_at timestamp', async () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const originalTimestamp = task.updated_at;

      await new Promise(resolve => setTimeout(resolve, 10));
      service.touchTask(task);

      expect(task.updated_at).not.toBe(originalTimestamp);
    });
  });

  describe('updateTask', () => {
    it('should apply task update', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const updated = service.updateTask(task.task_id, { context_bundle_ref: 'bundle_123' });

      expect(updated.context_bundle_ref).toBe('bundle_123');
      expect(updated.version).toBe(task.version + 1);
    });

    it('should merge artifacts', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const artifact = { artifact_id: 'art_1', kind: 'log' as const, uri: 'file://test.log' };
      const updated = service.updateTask(task.task_id, { mergeArtifacts: [artifact] });

      expect(updated.artifacts).toHaveLength(1);
      expect(updated.artifacts?.[0].artifact_id).toBe('art_1');
    });

    it('should throw for nonexistent task', () => {
      expect(() => service.updateTask('nonexistent', { context_bundle_ref: 'test' })).toThrow('task not found');
    });
  });

  describe('setTask', () => {
    it('should store task directly', () => {
      const task: Task = {
        task_id: 'task_direct',
        title: 'Direct Task',
        objective: 'Test',
        typed_ref: 'agent-taskstate:task:github:issue-direct',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      service.setTask('task_direct', task);
      const retrieved = service.getTask('task_direct');

      expect(retrieved).toEqual(task);
    });
  });

  describe('transitionTask', () => {
    it('should transition task to new state', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const { task: updatedTask, event } = service.transitionTask(task, 'planning', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'start planning',
      }, mockContext);

      expect(updatedTask.state).toBe('planning');
      expect(updatedTask.version).toBe(task.version + 1);
      expect(event.from_state).toBe('queued');
      expect(event.to_state).toBe('planning');
    });

    it('should set completed_at for terminal state (cancelled)', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const { task: updatedTask } = service.transitionTask(task, 'cancelled', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'done',
      }, mockContext);

      expect(updatedTask.completed_at).toBeDefined();
      expect(updatedTask.state).toBe('cancelled');
    });

    it('should clear blocked_context when leaving blocked state', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      // First transition: queued -> planning
      service.transitionTask(service.requireTask(task.task_id), 'planning', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'start',
      }, mockContext);

      // Second transition: planning -> blocked
      service.transitionTask(service.requireTask(task.task_id), 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'waiting',
      }, mockContext);

      const blockedTask = service.requireTask(task.task_id);
      blockedTask.blocked_context = { reason: 'test', blocked_at: new Date().toISOString() };

      // Then transition out of blocked -> planning
      const { task: unblockedTask } = service.transitionTask(blockedTask, 'planning', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'unblocked',
      }, mockContext);

      expect(unblockedTask.blocked_context).toBeUndefined();
    });

    it('should throw for invalid transition', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      // Try invalid transition from queued to developing (must go through planning first)
      expect(() => service.transitionTask(task, 'developing', {
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'invalid',
      }, mockContext)).toThrow('transition not allowed');
    });
  });

  describe('recordTransition', () => {
    it('should record and apply transition event', () => {
      const task = service.createTask(createTestRequest(), mockContext);
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

      const recorded = service.recordTransition(task.task_id, event, mockContext);
      expect(recorded).toEqual(event);

      const updatedTask = service.getTask(task.task_id);
      expect(updatedTask?.state).toBe('planning');
    });

    it('should throw for nonexistent task', () => {
      const event: StateTransitionEvent = {
        event_id: 'evt_test',
        task_id: 'nonexistent',
        from_state: 'queued',
        to_state: 'planning',
        actor_type: 'control_plane',
        actor_id: 'system',
        reason: 'dispatch',
        occurred_at: new Date().toISOString(),
      };

      expect(() => service.recordTransition('nonexistent', event, mockContext)).toThrow('task not found');
    });
  });

  describe('cancel', () => {
    it('should cancel a task', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const cancelled = service.cancel(task.task_id, mockContext);

      expect(cancelled.state).toBe('cancelled');
      expect(cancelled.completed_at).toBeDefined();
    });

    it('should throw for terminal task', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      // Cancel the task first
      service.cancel(task.task_id, mockContext);

      // Try to cancel again
      expect(() => service.cancel(task.task_id, mockContext)).toThrow('already terminal');
    });
  });

  describe('getAllTasks', () => {
    it('should return iterable of all tasks', () => {
      service.createTask({ ...createTestRequest(), title: 'Task 1' }, mockContext);
      service.createTask({ ...createTestRequest(), title: 'Task 2' }, mockContext);

      const allTasks = Array.from(service.getAllTasks());
      expect(allTasks).toHaveLength(2);
    });
  });

  describe('getTasksMap', () => {
    it('should return the underlying map', () => {
      const task = service.createTask(createTestRequest(), mockContext);
      const map = service.getTasksMap();

      expect(map.get(task.task_id)).toEqual(task);
    });
  });

  describe('getStateMachine', () => {
    it('should return the state machine instance', () => {
      const stateMachine = service.getStateMachine();
      expect(stateMachine).toBeDefined();
      expect(typeof stateMachine.validateTransition).toBe('function');
    });
  });

  describe('clear', () => {
    it('should clear all tasks', () => {
      service.createTask(createTestRequest(), mockContext);
      service.createTask(createTestRequest(), mockContext);

      service.clear();

      expect(service.listTasks()).toHaveLength(0);
    });
  });
});