import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { TaskState } from '../types';

// Task hooks
export function useTasks(params?: { state?: string }) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.getTasks(params),
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
    enabled: !!taskId,
    refetchInterval: 5000,
  });
}

export function useTaskEvents(taskId: string) {
  return useQuery({
    queryKey: ['task-events', taskId],
    queryFn: () => api.getTaskEvents(taskId),
    enabled: !!taskId,
  });
}

export function useDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stage, worker }: { taskId: string; stage: string; worker?: string }) =>
      api.dispatch(taskId, stage, worker),
    onSuccess: () => {
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

// Run hooks
export function useRuns(params?: { status?: string }) {
  return useQuery({
    queryKey: ['runs', params],
    queryFn: () => api.getRuns(params),
    refetchInterval: 5000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    enabled: !!runId,
  });
}

export function useRunTimeline(runId: string) {
  return useQuery({
    queryKey: ['run-timeline', runId],
    queryFn: () => api.getRunTimeline(runId),
    enabled: !!runId,
  });
}

export function useRunAuditSummary(runId: string) {
  return useQuery({
    queryKey: ['run-audit-summary', runId],
    queryFn: () => api.getRunAuditSummary(runId),
    enabled: !!runId,
  });
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