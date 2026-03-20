import { describe, it, expect, beforeEach } from 'vitest';
import { AgentTaskState, InMemoryBackend, isValidTransition, getValidTargetStates } from '../src/index.js';

describe('AgentTaskState', () => {
  let state: AgentTaskState;

  beforeEach(() => {
    state = new AgentTaskState();
  });

  describe('TaskService', () => {
    it('should create a task', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test Task',
        goal: 'Test goal',
      });

      expect(task.id).toBeDefined();
      expect(task.kind).toBe('feature');
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('proposed');
      expect(task.priority).toBe('medium');
    });

    it('should create a task with custom priority', async () => {
      const task = await state.tasks.createTask({
        kind: 'bugfix',
        title: 'Bug Fix',
        goal: 'Fix the bug',
        priority: 'high',
      });

      expect(task.priority).toBe('high');
    });

    it('should get a task by ID', async () => {
      const created = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const task = await state.tasks.getTask(created.id);
      expect(task).toBeDefined();
      expect(task?.id).toBe(created.id);
    });

    it('should return null for non-existent task', async () => {
      const task = await state.tasks.getTask('non-existent');
      expect(task).toBeNull();
    });

    it('should update a task', async () => {
      const created = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const updated = await state.tasks.updateTask(created.id, {
        title: 'Updated Title',
        priority: 'high',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.priority).toBe('high');
      expect(updated.revision).toBe(2);
    });

    it('should delete a task', async () => {
      const created = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      await state.tasks.deleteTask(created.id);
      const task = await state.tasks.getTask(created.id);
      expect(task).toBeNull();
    });

    it('should list tasks', async () => {
      await state.tasks.createTask({ kind: 'feature', title: 'Task 1', goal: 'Goal 1' });
      await state.tasks.createTask({ kind: 'bugfix', title: 'Task 2', goal: 'Goal 2' });

      const tasks = await state.tasks.listTasks();
      expect(tasks).toHaveLength(2);
    });
  });

  describe('StateTransitionService', () => {
    it('should transition task from proposed to ready', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const transition = await state.transitions.transition(task.id, {
        to_status: 'ready',
        reason: 'Approved',
        actor_type: 'human',
      });

      expect(transition.to_status).toBe('ready');
      const updated = await state.tasks.getTask(task.id);
      expect(updated?.status).toBe('ready');
    });

    it('should throw on invalid transition', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      await expect(state.transitions.transition(task.id, {
        to_status: 'done', // Invalid: proposed -> done is not allowed
        reason: 'Invalid',
        actor_type: 'system',
      })).rejects.toThrow();
    });

    it('should get transition history', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      await state.transitions.transition(task.id, {
        to_status: 'ready',
        reason: 'Approved',
        actor_type: 'human',
      });

      const history = await state.transitions.getHistory(task.id);
      expect(history).toHaveLength(2); // propose + ready
    });
  });

  describe('Decision Management', () => {
    it('should create a decision', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const decision = await state.tasks.createDecision(task.id, 'Choose framework', ['React', 'Vue', 'Svelte']);

      expect(decision.id).toBeDefined();
      expect(decision.question).toBe('Choose framework');
      expect(decision.options).toHaveLength(3);
      expect(decision.status).toBe('pending');
    });

    it('should resolve a decision', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const decision = await state.tasks.createDecision(task.id, 'Choose?', ['A', 'B']);

      const resolved = await state.tasks.resolveDecision(decision.id, 'A', 'A is better');

      expect(resolved.chosen).toBe('A');
      expect(resolved.rationale).toBe('A is better');
      expect(resolved.status).toBe('accepted');
    });

    it('should reject invalid option', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const decision = await state.tasks.createDecision(task.id, 'Choose?', ['A', 'B']);

      await expect(state.tasks.resolveDecision(decision.id, 'C')).rejects.toThrow();
    });
  });

  describe('Open Question Management', () => {
    it('should create a question', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const question = await state.tasks.createQuestion(task.id, 'What about X?');

      expect(question.id).toBeDefined();
      expect(question.question).toBe('What about X?');
      expect(question.status).toBe('open');
    });

    it('should answer a question', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const question = await state.tasks.createQuestion(task.id, 'Question?');

      const answered = await state.tasks.answerQuestion(question.id, 'Answer');

      expect(answered.answer).toBe('Answer');
      expect(answered.status).toBe('answered');
    });

    it('should defer a question', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const question = await state.tasks.createQuestion(task.id, 'Question?');

      const deferred = await state.tasks.deferQuestion(question.id);

      expect(deferred.status).toBe('deferred');
    });
  });

  describe('Run Management', () => {
    it('should start a run', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const run = await state.tasks.startRun(task.id);

      expect(run.id).toBeDefined();
      expect(run.status).toBe('running');
      expect(run.started_at).toBeDefined();
    });

    it('should finish a run', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const run = await state.tasks.startRun(task.id);
      const finished = await state.tasks.finishRun(run.id);

      expect(finished.status).toBe('finished');
      expect(finished.finished_at).toBeDefined();
    });

    it('should fail a run', async () => {
      const task = await state.tasks.createTask({
        kind: 'feature',
        title: 'Test',
        goal: 'Test',
      });

      const run = await state.tasks.startRun(task.id);
      const failed = await state.tasks.failRun(run.id, 'Something went wrong');

      expect(failed.status).toBe('failed');
      expect(failed.error_message).toBe('Something went wrong');
    });
  });
});

describe('State Transition Validation', () => {
  it('should validate correct transitions', () => {
    expect(isValidTransition('proposed', 'ready')).toBe(true);
    expect(isValidTransition('ready', 'in_progress')).toBe(true);
    expect(isValidTransition('in_progress', 'review')).toBe(true);
    expect(isValidTransition('review', 'done')).toBe(true);
    expect(isValidTransition('in_progress', 'blocked')).toBe(true);
    expect(isValidTransition('blocked', 'in_progress')).toBe(true);
  });

  it('should reject invalid transitions', () => {
    expect(isValidTransition('proposed', 'done')).toBe(false);
    expect(isValidTransition('done', 'in_progress')).toBe(false);
    expect(isValidTransition('cancelled', 'ready')).toBe(false);
  });

  it('should allow transition to cancelled from any state', () => {
    expect(isValidTransition('proposed', 'cancelled')).toBe(true);
    expect(isValidTransition('in_progress', 'cancelled')).toBe(true);
    expect(isValidTransition('review', 'cancelled')).toBe(true);
  });

  it('should return valid target states', () => {
    expect(getValidTargetStates('proposed')).toEqual(['ready', 'cancelled']);
    expect(getValidTargetStates('in_progress')).toEqual(['blocked', 'review', 'cancelled']);
    expect(getValidTargetStates('done')).toEqual([]);
  });
});

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend;

  beforeEach(() => {
    backend = new InMemoryBackend();
  });

  it('should create and get a task', async () => {
    const task = {
      id: 'test-1',
      kind: 'feature' as const,
      title: 'Test',
      goal: 'Test',
      status: 'proposed' as const,
      priority: 'medium' as const,
      owner_type: 'system' as const,
      owner_id: 'default',
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await backend.createTask(task);
    const result = await backend.getTask('test-1');
    expect(result).toEqual(task);
  });

  it('should update a task', async () => {
    const task = {
      id: 'test-1',
      kind: 'feature' as const,
      title: 'Test',
      goal: 'Test',
      status: 'proposed' as const,
      priority: 'medium' as const,
      owner_type: 'system' as const,
      owner_id: 'default',
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await backend.createTask(task);
    const updated = { ...task, title: 'Updated', revision: 2 };
    await backend.updateTask(updated);
    const result = await backend.getTask('test-1');
    expect(result?.title).toBe('Updated');
    expect(result?.revision).toBe(2);
  });

  it('should delete a task', async () => {
    const task = {
      id: 'test-1',
      kind: 'feature' as const,
      title: 'Test',
      goal: 'Test',
      status: 'proposed' as const,
      priority: 'medium' as const,
      owner_type: 'system' as const,
      owner_id: 'default',
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await backend.createTask(task);
    await backend.deleteTask('test-1');
    const result = await backend.getTask('test-1');
    expect(result).toBeNull();
  });
});