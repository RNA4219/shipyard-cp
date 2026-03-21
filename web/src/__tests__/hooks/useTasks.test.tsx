import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTasks, useTask, getStateColor, getStateLabel, isTerminalState, isActiveState } from '../../hooks/useTasks';
import { api } from '../../services/api';
import type { Task, TaskListResponse } from '../../types';

// Mock the API module
vi.mock('../../services/api', () => ({
  api: {
    getTasks: vi.fn(),
    getTask: vi.fn(),
  },
}));

const mockApi = vi.mocked(api);

// Create a wrapper for React Query
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return tasks data on successful fetch', async () => {
    const mockTasks: Task[] = [
      {
        task_id: 'task-1',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'test-ref',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: {
          provider: 'github',
          owner: 'test-owner',
          name: 'test-repo',
          default_branch: 'main',
        },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const mockResponse: TaskListResponse = {
      items: mockTasks,
      total: 1,
    };

    mockApi.getTasks.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useTasks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResponse);
    expect(mockApi.getTasks).toHaveBeenCalledWith(undefined);
  });

  it('should pass params to the API call', async () => {
    const mockResponse: TaskListResponse = {
      items: [],
      total: 0,
    };

    mockApi.getTasks.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useTasks({ state: 'queued' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.getTasks).toHaveBeenCalledWith({ state: 'queued' });
  });

  it('should handle fetch errors', async () => {
    const error = new Error('Network error');
    mockApi.getTasks.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useTasks(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 3000 }
    );

    expect(result.current.error).toBeDefined();
  });
});

describe('useTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return task data on successful fetch', async () => {
    const mockTask: Task = {
      task_id: 'task-1',
      title: 'Test Task',
      objective: 'Test objective',
      typed_ref: 'test-ref',
      state: 'queued',
      version: 1,
      risk_level: 'low',
      repo_ref: {
        provider: 'github',
        owner: 'test-owner',
        name: 'test-repo',
        default_branch: 'main',
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    mockApi.getTask.mockResolvedValueOnce(mockTask);

    const { result } = renderHook(() => useTask('task-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockTask);
    expect(mockApi.getTask).toHaveBeenCalledWith('task-1');
  });

  it('should not fetch when taskId is empty', async () => {
    const { result } = renderHook(() => useTask(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockApi.getTask).not.toHaveBeenCalled();
  });
});

describe('State utilities', () => {
  describe('getStateColor', () => {
    it('should return correct color for each state', () => {
      expect(getStateColor('queued')).toBe('bg-gray-600');
      expect(getStateColor('planning')).toBe('bg-blue-600');
      expect(getStateColor('developing')).toBe('bg-yellow-600');
      expect(getStateColor('published')).toBe('bg-green-600');
      expect(getStateColor('failed')).toBe('bg-red-600');
    });
  });

  describe('getStateLabel', () => {
    it('should format state labels correctly', () => {
      expect(getStateLabel('queued')).toBe('Queued');
      expect(getStateLabel('in_progress')).toBe('In Progress');
      expect(getStateLabel('dev_completed')).toBe('Dev Completed');
    });
  });

  describe('isTerminalState', () => {
    it('should return true for terminal states', () => {
      expect(isTerminalState('published')).toBe(true);
      expect(isTerminalState('cancelled')).toBe(true);
      expect(isTerminalState('failed')).toBe(true);
    });

    it('should return false for non-terminal states', () => {
      expect(isTerminalState('queued')).toBe(false);
      expect(isTerminalState('developing')).toBe(false);
      expect(isTerminalState('planning')).toBe(false);
    });
  });

  describe('isActiveState', () => {
    it('should return true for active states', () => {
      expect(isActiveState('developing')).toBe(true);
      expect(isActiveState('planning')).toBe(true);
      expect(isActiveState('accepting')).toBe(true);
    });

    it('should return false for terminal and queued states', () => {
      expect(isActiveState('queued')).toBe(false);
      expect(isActiveState('published')).toBe(false);
      expect(isActiveState('failed')).toBe(false);
    });
  });
});