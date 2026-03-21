/**
 * Agent API routes
 * Provides agent spawn control and metrics
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import {
  SpawnController,
  InMemoryMetrics,
  DEFAULT_AGENT_TREE_LIMITS,
  type SpawnControlScope,
  type AgentTreeLimits,
} from '../domain/agent/index.js';
import { requireRole } from '../auth/index.js';

type Handler = RouteHandlerMethod;

// Global spawn controller instance
let spawnController: SpawnController;
let metrics: InMemoryMetrics;

/**
 * Initialize the spawn controller
 */
export function initAgentController(): void {
  metrics = new InMemoryMetrics();
  spawnController = new SpawnController(DEFAULT_AGENT_TREE_LIMITS, metrics);
}

/**
 * Get agent metrics summary
 */
export interface AgentMetricsSummary {
  active_agents: number;
  spawn_attempts: number;
  spawn_allowed: number;
  spawn_queued: number;
  spawn_rejected: Record<string, number>;
  rate_tokens_remaining: number;
  config: {
    max_concurrent_agents: number;
    max_spawns_per_window: number;
    window_seconds: number;
  };
}

/**
 * Get metrics for a specific scope
 */
function getScopeMetrics(scope: SpawnControlScope): AgentMetricsSummary {
  return {
    active_agents: metrics.getActiveCount(scope),
    spawn_attempts: metrics.getSpawnAttempts(scope),
    spawn_allowed: metrics.getSpawnAllowed(scope),
    spawn_queued: metrics.getSpawnQueued(scope),
    spawn_rejected: {
      CONCURRENT_LIMIT_EXCEEDED: metrics.getSpawnRejected(scope, 'CONCURRENT_LIMIT_EXCEEDED'),
      RATE_LIMIT_EXCEEDED: metrics.getSpawnRejected(scope, 'RATE_LIMIT_EXCEEDED'),
      AGENT_QUEUE_TIMEOUT: metrics.getSpawnRejected(scope, 'AGENT_QUEUE_TIMEOUT'),
    },
    rate_tokens_remaining: metrics.getRateTokens(scope),
    config: {
      max_concurrent_agents: DEFAULT_AGENT_TREE_LIMITS.max_concurrent_agents,
      max_spawns_per_window: DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit.max_spawns_per_window,
      window_seconds: DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit.window_seconds,
    },
  };
}

/**
 * Register agent routes
 */
export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  // Initialize controller if not already done
  if (!spawnController) {
    initAgentController();
  }

  // Get agent metrics (public for dashboard)
  app.get('/v1/agent/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    const jobMetrics = getScopeMetrics('job');
    const workerMetrics = getScopeMetrics('worker');
    const globalMetrics = getScopeMetrics('global');

    return reply.send({
      timestamp: new Date().toISOString(),
      scopes: {
        job: jobMetrics,
        worker: workerMetrics,
        global: globalMetrics,
      },
      prometheus: metrics.exportPrometheusMetrics(),
    });
  });

  // Get spawn controller config (admin only)
  app.get('/v1/agent/config', { preHandler: requireRole('admin') }, (async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(spawnController.getConfig());
  }) as Handler);

  // Evaluate spawn request (operator+)
  app.post('/v1/agent/spawn/evaluate', { preHandler: requireRole('admin', 'operator') }, (async (request: FastifyRequest<{
    Body: {
      spawn_request_id: string;
      parent_job_id: string;
      parent_agent_id: string;
      scope?: SpawnControlScope;
    };
  }>, reply: FastifyReply) => {
    try {
      const result = await spawnController.evaluateSpawn(request.body);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(400).send({ code: 'BAD_REQUEST', message });
    }
  }) as Handler);

  // Register active agent (operator+)
  app.post('/v1/agent/register', { preHandler: requireRole('admin', 'operator') }, (async (request: FastifyRequest<{
    Body: {
      agent_id: string;
      job_id: string;
      scope?: SpawnControlScope;
      worker_id?: string;
    };
  }>, reply: FastifyReply) => {
    const { agent_id, job_id, scope = 'job', worker_id } = request.body;
    spawnController.registerActiveAgent(scope, agent_id, job_id, worker_id);
    return reply.send({ success: true, agent_id, scope });
  }) as Handler);

  // Unregister agent (operator+)
  app.post('/v1/agent/unregister', { preHandler: requireRole('admin', 'operator') }, (async (request: FastifyRequest<{
    Body: {
      agent_id: string;
      job_id: string;
      scope?: SpawnControlScope;
      worker_id?: string;
    };
  }>, reply: FastifyReply) => {
    const { agent_id, job_id, scope = 'job', worker_id } = request.body;
    spawnController.unregisterAgent(scope, agent_id, job_id, worker_id);
    return reply.send({ success: true, agent_id, scope });
  }) as Handler);

  // Get active agents for a job (public)
  app.get('/v1/agent/active/:job_id', async (request: FastifyRequest<{ Params: { job_id: string } }>, reply: FastifyReply) => {
    const { job_id } = request.params;
    const count = spawnController.getActiveAgentCount('job', job_id);
    const queueLength = spawnController.getQueueLength('job', job_id);
    return reply.send({
      job_id,
      active_count: count,
      queue_length: queueLength,
    });
  });
}