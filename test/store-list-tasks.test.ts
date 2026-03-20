import { describe, it, expect, beforeEach } from 'vitest';
import { ControlPlaneStore } from '../src/store/control-plane-store.js';
import type { CreateTaskRequest } from '../src/types.js';

describe('ControlPlaneStore - listTasks', () => {
  let store: ControlPlaneStore;

  beforeEach(() => {
    store = new ControlPlaneStore();
  });

  const createTaskInput = (overrides: Partial<CreateTaskRequest> = {}): CreateTaskRequest => ({
    title: 'Test Task',
    objective: 'Test objective',
    typed_ref: 'test:task:feature:abc123',
    repo_ref: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      default_branch: 'main',
    },
    ...overrides,
  });

  describe('listTasks', () => {
    it('should return empty array when no tasks exist', () => {
      const result = store.listTasks();
      expect(result).toEqual([]);
    });

    it('should return all tasks', () => {
      store.createTask(createTaskInput({ title: 'Task 1' }));
      store.createTask(createTaskInput({ title: 'Task 2' }));
      store.createTask(createTaskInput({ title: 'Task 3' }));

      const result = store.listTasks();
      expect(result).toHaveLength(3);
    });

    it('should sort tasks by updated_at descending', async () => {
      // Create tasks with slight delay to ensure different timestamps
      store.createTask(createTaskInput({ title: 'Task 1' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      store.createTask(createTaskInput({ title: 'Task 2' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      store.createTask(createTaskInput({ title: 'Task 3' }));

      const result = store.listTasks();
      expect(result[0].title).toBe('Task 3');
      expect(result[1].title).toBe('Task 2');
      expect(result[2].title).toBe('Task 1');
    });

    it('should filter tasks by state', () => {
      const task1 = store.createTask(createTaskInput({ title: 'Task 1' }));
      const task2 = store.createTask(createTaskInput({ title: 'Task 2' }));

      // Cancel task2 to change its state
      store.cancel(task2.task_id);

      const result = store.listTasks({ state: ['queued'] });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Task 1');
    });

    it('should filter tasks by multiple states', () => {
      const task1 = store.createTask(createTaskInput({ title: 'Task 1' }));
      const task2 = store.createTask(createTaskInput({ title: 'Task 2' }));
      const task3 = store.createTask(createTaskInput({ title: 'Task 3' }));

      store.cancel(task2.task_id);
      store.cancel(task3.task_id);

      const result = store.listTasks({ state: ['queued', 'cancelled'] });
      expect(result).toHaveLength(3);
    });

    it('should apply offset pagination', () => {
      store.createTask(createTaskInput({ title: 'Task 1' }));
      store.createTask(createTaskInput({ title: 'Task 2' }));
      store.createTask(createTaskInput({ title: 'Task 3' }));

      const result = store.listTasks({ offset: 1 });
      expect(result).toHaveLength(2);
    });

    it('should apply limit pagination', () => {
      store.createTask(createTaskInput({ title: 'Task 1' }));
      store.createTask(createTaskInput({ title: 'Task 2' }));
      store.createTask(createTaskInput({ title: 'Task 3' }));

      const result = store.listTasks({ limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply both offset and limit', () => {
      store.createTask(createTaskInput({ title: 'Task 1' }));
      store.createTask(createTaskInput({ title: 'Task 2' }));
      store.createTask(createTaskInput({ title: 'Task 3' }));
      store.createTask(createTaskInput({ title: 'Task 4' }));

      const result = store.listTasks({ offset: 1, limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when offset exceeds total', () => {
      store.createTask(createTaskInput({ title: 'Task 1' }));

      const result = store.listTasks({ offset: 10 });
      expect(result).toEqual([]);
    });

    it('should default limit to 100', () => {
      // Create 101 tasks
      for (let i = 0; i < 101; i++) {
        store.createTask(createTaskInput({ title: `Task ${i}` }));
      }

      const result = store.listTasks();
      expect(result).toHaveLength(100);
    });
  });
});