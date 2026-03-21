import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunTimeoutService, type RunTimeoutContext } from '../src/domain/run/run-timeout-service.js';
import type { Task, IntegrationRun, PublishRun, StateTransitionEvent } from '../src/types.js';

describe('RunTimeoutService', () => {
  let service: RunTimeoutService;
  let mockContext: RunTimeoutContext;

  beforeEach(() => {
    service = new RunTimeoutService();
    mockContext = {
      transitionTask: vi.fn().mockImplementation((task, toState, _input) => ({
        event: { event_id: 'evt_1', task_id: task.task_id } as StateTransitionEvent,
        task: { ...task, state: toState },
      })),
    };
  });

  describe('checkTimeouts', () => {
    it('should return empty array when no tasks are provided', () => {
      const result = service.checkTimeouts([], mockContext);
      expect(result).toEqual([]);
    });

    it('should return empty array when no tasks have timed out', () => {
      const task: Task = {
        task_id: 'task_123',
        state: 'integrating',
        integration_run: {
          run_id: 'run_1',
          status: 'running',
          timeout_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
          started_at: new Date().toISOString(),
          progress: 50,
        },
      } as any;

      const result = service.checkTimeouts([task], mockContext);
      expect(result).toEqual([]);
    });

    it('should detect integration timeout', () => {
      const task: Task = {
        task_id: 'task_123',
        state: 'integrating',
        integration_run: {
          run_id: 'run_1',
          status: 'running',
          timeout_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
          started_at: new Date().toISOString(),
          progress: 50,
        },
      } as any;

      const result = service.checkTimeouts([task], mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].task_id).toBe('task_123');
      expect(mockContext.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task_123',
          blocked_context: expect.objectContaining({
            reason: 'integration timed out',
          }),
        }),
        'blocked',
        expect.objectContaining({ reason: 'integration timeout' })
      );
    });

    it('should detect publish timeout', () => {
      const task: Task = {
        task_id: 'task_456',
        state: 'publishing',
        publish_run: {
          run_id: 'run_2',
          status: 'running',
          timeout_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
          started_at: new Date().toISOString(),
          progress: 75,
        },
      } as any;

      const result = service.checkTimeouts([task], mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].task_id).toBe('task_456');
      expect(mockContext.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task_456',
          blocked_context: expect.objectContaining({
            reason: 'publish timed out',
          }),
        }),
        'blocked',
        expect.objectContaining({ reason: 'publish timeout' })
      );
    });

    it('should not timeout completed integration runs', () => {
      const task: Task = {
        task_id: 'task_123',
        state: 'integrating',
        integration_run: {
          run_id: 'run_1',
          status: 'completed',
          timeout_at: new Date(Date.now() - 1000).toISOString(),
          started_at: new Date().toISOString(),
          progress: 100,
        },
      } as any;

      const result = service.checkTimeouts([task], mockContext);
      expect(result).toEqual([]);
    });

    it('should not timeout completed publish runs', () => {
      const task: Task = {
        task_id: 'task_456',
        state: 'publishing',
        publish_run: {
          run_id: 'run_2',
          status: 'completed',
          timeout_at: new Date(Date.now() - 1000).toISOString(),
          started_at: new Date().toISOString(),
          progress: 100,
        },
      } as any;

      const result = service.checkTimeouts([task], mockContext);
      expect(result).toEqual([]);
    });

    it('should skip tasks without run metadata', () => {
      const task: Task = {
        task_id: 'task_123',
        state: 'integrating',
      } as any;

      const result = service.checkTimeouts([task], mockContext);
      expect(result).toEqual([]);
    });

    it('should handle multiple tasks with mixed states', () => {
      const tasks: Task[] = [
        {
          task_id: 'task_1',
          state: 'integrating',
          integration_run: {
            run_id: 'run_1',
            status: 'running',
            timeout_at: new Date(Date.now() - 1000).toISOString(),
            started_at: new Date().toISOString(),
            progress: 30,
          },
        } as any,
        {
          task_id: 'task_2',
          state: 'publishing',
          publish_run: {
            run_id: 'run_2',
            status: 'running',
            timeout_at: new Date(Date.now() + 3600000).toISOString(),
            started_at: new Date().toISOString(),
            progress: 50,
          },
        } as any,
        {
          task_id: 'task_3',
          state: 'queued',
        } as any,
      ];

      const result = service.checkTimeouts(tasks, mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].task_id).toBe('task_1');
    });
  });

  describe('getActiveRuns', () => {
    it('should return empty array when no active runs', () => {
      const tasks: Task[] = [
        { task_id: 'task_1', state: 'queued' } as any,
        { task_id: 'task_2', state: 'planning' } as any,
      ];

      const result = service.getActiveRuns(tasks);
      expect(result).toEqual([]);
    });

    it('should return active integration runs', () => {
      const task: Task = {
        task_id: 'task_1',
        state: 'integrating',
        integration_run: {
          run_id: 'run_1',
          status: 'running',
          timeout_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          progress: 50,
        },
      } as any;

      const result = service.getActiveRuns([task]);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('integration');
      expect(result[0].run.run_id).toBe('run_1');
    });

    it('should return active publish runs', () => {
      const task: Task = {
        task_id: 'task_1',
        state: 'publishing',
        publish_run: {
          run_id: 'run_2',
          status: 'running',
          timeout_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          progress: 75,
        },
      } as any;

      const result = service.getActiveRuns([task]);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('publish');
      expect(result[0].run.run_id).toBe('run_2');
    });

    it('should return both integration and publish runs', () => {
      const tasks: Task[] = [
        {
          task_id: 'task_1',
          state: 'integrating',
          integration_run: {
            run_id: 'run_1',
            status: 'running',
            timeout_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            progress: 50,
          },
        } as any,
        {
          task_id: 'task_2',
          state: 'publishing',
          publish_run: {
            run_id: 'run_2',
            status: 'running',
            timeout_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            progress: 75,
          },
        } as any,
      ];

      const result = service.getActiveRuns(tasks);

      expect(result).toHaveLength(2);
    });
  });

  describe('updateIntegrationProgress', () => {
    it('should update integration progress', () => {
      const task: Task = {
        task_id: 'task_1',
        integration_run: {
          run_id: 'run_1',
          progress: 0,
        } as IntegrationRun,
      } as any;

      service.updateIntegrationProgress(task, 50);

      expect(task.integration_run?.progress).toBe(50);
      expect(task.updated_at).toBeDefined();
    });

    it('should clamp progress to 0-100 range', () => {
      const task: Task = {
        task_id: 'task_1',
        integration_run: {
          run_id: 'run_1',
          progress: 50,
        } as IntegrationRun,
      } as any;

      service.updateIntegrationProgress(task, 150);
      expect(task.integration_run?.progress).toBe(100);

      service.updateIntegrationProgress(task, -10);
      expect(task.integration_run?.progress).toBe(0);
    });

    it('should do nothing if no integration_run', () => {
      const task: Task = {
        task_id: 'task_1',
      } as any;

      // Should not throw
      service.updateIntegrationProgress(task, 50);
    });
  });

  describe('updatePublishProgress', () => {
    it('should update publish progress', () => {
      const task: Task = {
        task_id: 'task_1',
        publish_run: {
          run_id: 'run_1',
          progress: 0,
        } as PublishRun,
      } as any;

      service.updatePublishProgress(task, 75);

      expect(task.publish_run?.progress).toBe(75);
      expect(task.updated_at).toBeDefined();
    });

    it('should clamp progress to 0-100 range', () => {
      const task: Task = {
        task_id: 'task_1',
        publish_run: {
          run_id: 'run_1',
          progress: 50,
        } as PublishRun,
      } as any;

      service.updatePublishProgress(task, 200);
      expect(task.publish_run?.progress).toBe(100);

      service.updatePublishProgress(task, -50);
      expect(task.publish_run?.progress).toBe(0);
    });

    it('should do nothing if no publish_run', () => {
      const task: Task = {
        task_id: 'task_1',
      } as any;

      // Should not throw
      service.updatePublishProgress(task, 50);
    });
  });
});