// Use relative path for proxy in dev, or env var for production
const API_BASE = import.meta.env.VITE_API_URL || '';

import type {
  Task,
  TaskListResponse,
  Run,
  RunListResponse,
  TimelineResponse,
  AuditSummaryResponse,
  WorkerJob,
  StateTransitionEvent,
} from '../types';

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.message || 'Request failed', body.code);
    }

    return response.json();
  } catch (error) {
    // Re-throw ApiError
    if (error instanceof ApiError) {
      throw error;
    }
    // Network error or other issues
    throw new ApiError(0, 'Unable to connect to server. Is the backend running?', 'CONNECTION_ERROR');
  }
}

export const api = {
  // Tasks
  getTasks: (params?: { limit?: number; offset?: number; state?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.state) searchParams.set('state', params.state);
    const query = searchParams.toString();
    return fetchJson<TaskListResponse>(`${API_BASE}/v1/tasks${query ? `?${query}` : ''}`);
  },

  getTask: (id: string) => fetchJson<Task>(`${API_BASE}/v1/tasks/${id}`),

  updateTask: (id: string, data: { title?: string; objective?: string; description?: string }) =>
    fetchJson<Task>(`${API_BASE}/v1/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  createTask: (data: {
    title: string;
    objective: string;
    typed_ref: string;
    repo_ref: { provider: 'github'; owner: string; name: string; default_branch: string };
    risk_level?: 'low' | 'medium' | 'high';
    description?: string;
  }) => fetchJson<Task>(`${API_BASE}/v1/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  dispatch: (taskId: string, targetStage: string, workerSelection?: string) =>
    fetchJson<WorkerJob>(`${API_BASE}/v1/tasks/${taskId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({ target_stage: targetStage, worker_selection: workerSelection }),
    }),

  cancel: (taskId: string) =>
    fetchJson<Task>(`${API_BASE}/v1/tasks/${taskId}/cancel`, { method: 'POST' }),

  getTaskEvents: (taskId: string) =>
    fetchJson<{ items: StateTransitionEvent[] }>(`${API_BASE}/v1/tasks/${taskId}/events`),

  // Runs
  getRuns: (params?: { limit?: number; offset?: number; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return fetchJson<RunListResponse>(`${API_BASE}/v1/runs${query ? `?${query}` : ''}`);
  },

  getRun: (id: string) => fetchJson<Run>(`${API_BASE}/v1/runs/${id}`),

  getRunTimeline: (id: string) =>
    fetchJson<TimelineResponse>(`${API_BASE}/v1/runs/${id}/timeline`),

  getRunAuditSummary: (id: string) =>
    fetchJson<AuditSummaryResponse>(`${API_BASE}/v1/runs/${id}/audit-summary`),

  getRunCheckpoints: (id: string) =>
    fetchJson<{ run_id: string; items: import('../types').CheckpointRef[] }>(
      `${API_BASE}/v1/runs/${id}/checkpoints`
    ),

  // Health
  getHealth: () => fetchJson<{ status: string }>(`${API_BASE}/health`),
};

export { ApiError };