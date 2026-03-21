import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { TaskState, CreateTaskInput } from '../types';

// Query configuration constants
const QUERY_CONFIG = {
  // Short stale time for frequently updating data
  shortStaleTime: 1000 * 30, // 30 seconds
  // Medium stale time for semi-static data
  mediumStaleTime: 1000 * 60 * 2, // 2 minutes
  // Long stale time for static data
  longStaleTime: 1000 * 60 * 5, // 5 minutes
  // Garbage collection time
  gcTime: 1000 * 60 * 30, // 30 minutes
  // Refetch interval for active polling
  activePollingInterval: 5000, // 5 seconds
};

// Task hooks
export function useTasks(params?: { state?: string }) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.getTasks(params),
    placeholderData: (previousData) => previousData,
    staleTime: QUERY_CONFIG.shortStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
    retry: 1,
    refetchInterval: (query) => (query.state.data !== undefined ? QUERY_CONFIG.activePollingInterval : false),
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
    enabled: !!taskId,
    staleTime: QUERY_CONFIG.mediumStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
    refetchInterval: QUERY_CONFIG.activePollingInterval,
  });
}

export function useTaskEvents(taskId: string) {
  return useQuery({
    queryKey: ['task-events', taskId],
    queryFn: () => api.getTaskEvents(taskId),
    enabled: !!taskId,
    staleTime: QUERY_CONFIG.shortStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
  });
}

export function useDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stage, worker }: { taskId: string; stage: string; worker?: string }) =>
      api.dispatch(taskId, stage, worker),
    onSuccess: () => {
      // Invalidate and refetch tasks
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCancelTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.cancel(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCompleteAcceptance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.completeAcceptance(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['run', taskId] });
    },
  });
}

export function useCleanupTestTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.getTasks({ limit: 200 });
      const targets = response.items.filter((task) =>
        task.title === 'Playwright Test Task' || task.typed_ref?.startsWith('test:')
      );
      const cancellableTargets = targets.filter(
        (task): task is typeof task & { task_id: string } => Boolean(task.task_id) && task.state !== 'cancelled'
      );

      await Promise.all(
        cancellableTargets.map((task) => api.cancel(task.task_id))
      );

      return {
        matched: targets.length,
        cancelled: cancellableTargets.length,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTaskInput) => api.createTask(data),
    onSuccess: () => {
      // Invalidate tasks list to refetch
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: { title?: string; objective?: string; description?: string } }) =>
      api.updateTask(taskId, data),
    onSuccess: (_, { taskId }) => {
      // Invalidate both the list and individual task
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });
}

// Run hooks
export function useRuns(params?: { status?: string }) {
  return useQuery({
    queryKey: ['runs', params],
    queryFn: () => api.getRuns(params),
    staleTime: QUERY_CONFIG.shortStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
    refetchInterval: QUERY_CONFIG.activePollingInterval,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    enabled: !!runId,
    staleTime: QUERY_CONFIG.mediumStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
  });
}

export function useRunTimeline(runId: string) {
  return useQuery({
    queryKey: ['run-timeline', runId],
    queryFn: () => api.getRunTimeline(runId),
    enabled: !!runId,
    staleTime: QUERY_CONFIG.shortStaleTime,
    gcTime: QUERY_CONFIG.gcTime,
  });
}

export function useRunAuditSummary(runId: string) {
  return useQuery({
    queryKey: ['run-audit-summary', runId],
    queryFn: () => api.getRunAuditSummary(runId),
    enabled: !!runId,
    staleTime: QUERY_CONFIG.longStaleTime, // Audit summary changes less frequently
    gcTime: QUERY_CONFIG.gcTime,
  });
}

// Prefetch utilities for better UX
export function usePrefetchTask() {
  const queryClient = useQueryClient();

  return (taskId: string) => {
    queryClient.prefetchQuery({
      queryKey: ['task', taskId],
      queryFn: () => api.getTask(taskId),
      staleTime: QUERY_CONFIG.mediumStaleTime,
    });
  };
}

export function usePrefetchRun() {
  const queryClient = useQueryClient();

  return (runId: string) => {
    queryClient.prefetchQuery({
      queryKey: ['run', runId],
      queryFn: () => api.getRun(runId),
      staleTime: QUERY_CONFIG.mediumStaleTime,
    });
  };
}

// State utilities
export function getStateColor(state: TaskState): string {
  const colors: Record<TaskState, string> = {
    queued: 'bg-gray-600',
    planning: 'bg-blue-600',
    planned: 'bg-blue-600',
    developing: 'bg-yellow-600',
    dev_completed: 'bg-yellow-600',
    accepting: 'bg-purple-600',
    accepted: 'bg-purple-600',
    rework_required: 'bg-orange-600',
    integrating: 'bg-cyan-600',
    integrated: 'bg-cyan-600',
    publish_pending_approval: 'bg-pink-600',
    publishing: 'bg-pink-600',
    published: 'bg-green-600',
    cancelled: 'bg-red-600',
    failed: 'bg-red-600',
    blocked: 'bg-amber-700',
  };
  return colors[state] || 'bg-gray-600';
}

export function getStateLabel(state: TaskState): string {
  return state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function isTerminalState(state: TaskState): boolean {
  return ['published', 'cancelled', 'failed'].includes(state);
}

export function isActiveState(state: TaskState): boolean {
  return !isTerminalState(state) && state !== 'queued';
}
