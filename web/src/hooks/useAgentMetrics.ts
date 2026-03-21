import { useQuery } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface AgentMetricsScope {
  active_agents: number;
  spawn_attempts: number;
  spawn_allowed: number;
  spawn_queued: number;
  spawn_rejected: {
    CONCURRENT_LIMIT_EXCEEDED: number;
    RATE_LIMIT_EXCEEDED: number;
    AGENT_QUEUE_TIMEOUT: number;
  };
  rate_tokens_remaining: number;
  config: {
    max_concurrent_agents: number;
    max_spawns_per_window: number;
    window_seconds: number;
  };
}

export interface AgentMetrics {
  timestamp: string;
  scopes: {
    job: AgentMetricsScope;
    worker: AgentMetricsScope;
    global: AgentMetricsScope;
  };
}

async function fetchAgentMetrics(): Promise<AgentMetrics> {
  const response = await fetch(`${API_BASE}/v1/agent/metrics`);
  if (!response.ok) {
    throw new Error('Failed to fetch agent metrics');
  }
  return response.json();
}

export function useAgentMetrics() {
  return useQuery<AgentMetrics>({
    queryKey: ['agent-metrics'],
    queryFn: fetchAgentMetrics,
    refetchInterval: 5000, // Refresh every 5 seconds
    staleTime: 4000,
  });
}