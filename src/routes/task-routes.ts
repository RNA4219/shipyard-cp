import type { FastifyInstance, FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';

import { loadStaticDocs } from '../domain/static-docs.js';
import { ControlPlaneStore } from '../store/control-plane-store.js';
import { RepoPolicyStore } from '../domain/repo-policy/index.js';
import { createConditionalRoleHook } from '../auth/index.js';
import { getHealthChecker } from '../health/index.js';
import {
  createTaskSchema,
  dispatchSchema,
  workerResultSchema,
  publishSchema,
  integrateSchema,
  resolveDocsSchema,
  ackDocsSchema,
  staleCheckSchema,
  trackerLinkSchema,
  stateTransitionSchema,
  approvePublishSchema,
  completeAcceptanceSchema,
  completeIntegrateSchema,
  completePublishSchema,
  jobHeartbeatSchema,
  repoPolicySchema,
  chunksGetSchema,
  contractsResolveSchema,
} from './route-schemas.js';
import type {
  AckDocsRequest,
  CompleteAcceptanceRequest,
  CompleteIntegrateRequest,
  CompletePublishRequest,
  CreateTaskRequest,
  DispatchRequest,
  JobHeartbeatRequest,
  PublishRequest,
  RepoPolicy,
  ResolveDocsRequest,
  RunStatus,
  StaleCheckRequest,
  StateTransitionEvent,
  TrackerLinkRequest,
  WorkerResult,
} from '../types.js';

// =============================================================================
// Type Alias for Route Handler Casting
// =============================================================================

/**
 * Type alias for route handlers that need type assertion.
 * Using this instead of `as any` makes the intent explicit:
 * we're widening handler types to satisfy Fastify's RouteHandlerMethod.
 */
type Handler = RouteHandlerMethod;

// Repository policy store (shared instance for routes)
const repoPolicyStore = new RepoPolicyStore();

// =============================================================================
// Route Type Definitions
// =============================================================================

interface TaskParams {
  task_id: string;
}

interface JobParams {
  job_id: string;
}

interface SchemaParams {
  name: string;
}

type TaskRequest<B = unknown> = FastifyRequest<{ Params: TaskParams; Body: B }>;
type JobRequest<B = unknown> = FastifyRequest<{ Params: JobParams; Body: B }>;
type SchemaRequest = FastifyRequest<{ Params: SchemaParams }>;

// =============================================================================
// Error Handling
// =============================================================================

type HttpError = { statusCode: number; body: { code: string; message: string } };

const ERROR_PATTERNS: Array<{ patterns: string[]; statusCode: number; code: string }> = [
  {
    patterns: ['not found'],
    statusCode: 404,
    code: 'NOT_FOUND',
  },
  {
    patterns: [
      'cannot',
      'mismatch',
      'terminal',
      'not in',
      'transition not allowed',
      'manual checklist not complete',
      'verdict outcome must be',
      'no verdict available',
    ],
    statusCode: 409,
    code: 'STATE_CONFLICT',
  },
];

/**
 * Map error to HTTP error with appropriate status code.
 * In production mode, error details are sanitized to prevent information leakage.
 * Full error details are logged for debugging.
 */
function toHttpError(error: unknown, isProduction: boolean, request: FastifyRequest): HttpError {
  const internalMessage = error instanceof Error ? error.message : 'unknown error';
  const lower = internalMessage.toLowerCase();

  // Log the full error for debugging (always)
  request.log.error({
    error: internalMessage,
    stack: error instanceof Error ? error.stack : undefined,
    path: request.url,
    method: request.method,
  }, 'Request error');

  // Check for known error patterns
  for (const { patterns, statusCode, code } of ERROR_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) {
      // For client-facing errors, return actual message even in production
      // These are expected business logic errors, not internal details
      return { statusCode, body: { code, message: internalMessage } };
    }
  }

  // For unexpected errors, sanitize message in production
  if (isProduction) {
    return { statusCode: 400, body: { code: 'BAD_REQUEST', message: 'An error occurred processing your request' } };
  }

  return { statusCode: 400, body: { code: 'BAD_REQUEST', message: internalMessage } };
}

function handleError(reply: FastifyReply, error: unknown): FastifyReply {
  const isProduction = process.env.NODE_ENV === 'production';
  const http = toHttpError(error, isProduction, reply.request);
  return reply.status(http.statusCode).send(http.body);
}

function extractTaskId(request: FastifyRequest<{ Params: TaskParams }>): string {
  return request.params.task_id;
}

function extractJobId(request: FastifyRequest<{ Params: JobParams }>): string {
  return request.params.job_id;
}

// =============================================================================
// Route Handlers
// =============================================================================

function createTaskHandler(store: ControlPlaneStore) {
  return async (request: FastifyRequest<{ Body: CreateTaskRequest }>, reply: FastifyReply) => {
    try {
      const task = store.createTask(request.body);

      // Auto-dispatch to plan stage after task creation (fire and forget)
      // Don't await - let it run in background
      // Skip auto-dispatch in test environment to avoid race conditions
      if (process.env.VITEST !== 'true') {
        setImmediate(() => {
          store.dispatch(task.task_id, { target_stage: 'plan' }).catch(error => {
            // Log but don't fail the creation if dispatch fails
            request.log.warn({ error: error?.message || error, taskId: task.task_id }, 'Auto-dispatch failed');
          });
        });
      }

      return reply.status(201).send(task);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function getTaskHandler(store: ControlPlaneStore) {
  return async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const taskId = extractTaskId(request);
    const task = store.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `task not found: ${taskId}` });
    }
    return reply.send(task);
  };
}

function dispatchHandler(store: ControlPlaneStore) {
  return async (request: TaskRequest<DispatchRequest>, reply: FastifyReply) => {
    try {
      const job = await store.dispatch(extractTaskId(request), request.body);
      return reply.status(202).send(job);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function resultsHandler(store: ControlPlaneStore) {
  return async (request: TaskRequest<WorkerResult>, reply: FastifyReply) => {
    try {
      const response = store.applyResult(extractTaskId(request), request.body);
      return reply.send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

interface IntegrateBody {
  base_sha: string;
}

function integrateHandler(store: ControlPlaneStore) {
  return async (request: TaskRequest<IntegrateBody>, reply: FastifyReply) => {
    try {
      const task = store.integrate(extractTaskId(request), request.body.base_sha);
      return reply.status(202).send({
        task_id: task.task_id,
        state: task.state,
        integration_branch: task.integration?.integration_branch,
      });
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function publishHandler(store: ControlPlaneStore) {
  return async (request: TaskRequest<PublishRequest>, reply: FastifyReply) => {
    try {
      const task = store.publish(extractTaskId(request), request.body);
      const response: Record<string, unknown> = {
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      };
      // SECURITY: Do not expose approval token in API response
      // Instead, log it for secure notification via email/slack/etc.
      // The token should be delivered through a secure channel (not HTTP response)
      if (task.state === 'publish_pending_approval' && task.pending_approval_token) {
        // Log the approval token for secure notification delivery
        // In production, this should trigger email/slack notification
        request.log.info({
          task_id: task.task_id,
          approval_token: task.pending_approval_token,
          approval_expires_at: task.pending_approval_expires_at,
          event: 'publish_approval_pending',
        }, 'Publish pending approval - token generated for secure notification');
        // Include only the expiry time in response (not the token itself)
        response.approval_expires_at = task.pending_approval_expires_at;
        response.approval_required = true;
      }
      return reply.status(202).send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function wrapHandler<T>(
  store: ControlPlaneStore,
  fn: (store: ControlPlaneStore, taskId: string, body: T) => unknown | Promise<unknown>,
) {
  return async (request: TaskRequest<T>, reply: FastifyReply) => {
    try {
      const result = await fn(store, extractTaskId(request), request.body as T);
      return reply.send(result);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

// =============================================================================
// Route Registration
// =============================================================================

export async function registerRoutes(app: FastifyInstance, authEnabled = false): Promise<ControlPlaneStore> {
  const rootDir = process.cwd();
  const docs = loadStaticDocs(rootDir);
  const store = new ControlPlaneStore();
  const requireAdmin = createConditionalRoleHook(authEnabled, 'admin');
  const requireOperator = createConditionalRoleHook(authEnabled, 'admin', 'operator');

  app.decorate('store', store);

  // Health check endpoints
  const healthChecker = getHealthChecker();

  // Liveness probe - always returns OK
  app.get('/healthz', async () => healthChecker.liveness());

  // Readiness probe - checks all dependencies
  app.get('/health/ready', async (_request, reply: FastifyReply) => {
    const result = await healthChecker.readiness();

    if (result.status === 'healthy') {
      return reply.send(result);
    } else if (result.status === 'degraded') {
      return reply.status(200).send(result);
    } else {
      return reply.status(503).send(result);
    }
  });

  // Full health check with detailed service status
  app.get('/health', async (_request, reply: FastifyReply) => {
    const result = await healthChecker.checkAll();

    if (result.status === 'unhealthy') {
      return reply.status(503).send(result);
    }

    return reply.send(result);
  });

  // Static docs (public)
  app.get('/openapi.yaml', async (_request, reply: FastifyReply) =>
    reply.type('application/yaml').send(docs.openapi),
  );
  app.get('/schemas/:name', async (request: SchemaRequest, reply: FastifyReply) => {
    const { name } = request.params;
    const key = name as keyof typeof docs.schemas;
    const schema = docs.schemas[key];
    if (!schema) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `schema not found: ${name}` });
    }
    return reply.type('application/schema+json').send(schema);
  });

  // Task CRUD
  app.post('/v1/tasks', { preHandler: requireOperator, schema: createTaskSchema }, createTaskHandler(store) as Handler);
  app.get('/v1/tasks', async (request: FastifyRequest<{ Querystring: { limit?: number; offset?: number; state?: string } }>, reply: FastifyReply) => {
    const { limit, offset, state } = request.query;
    const stateFilter = state ? state.split(',') as import('../types.js').TaskState[] : undefined;
    const tasks = store.listTasks({ limit, offset, state: stateFilter });
    return reply.send({ items: tasks, total: tasks.length });
  });
  app.get('/v1/tasks/:task_id', getTaskHandler(store));

  // Docs operations (operator+)
  app.post('/v1/tasks/:task_id/docs/resolve', { preHandler: requireOperator, schema: resolveDocsSchema }, wrapHandler(store, (s, id, b) => s.resolveDocs(id, b as ResolveDocsRequest)) as Handler);
  app.post('/v1/tasks/:task_id/docs/ack', { preHandler: requireOperator, schema: ackDocsSchema }, wrapHandler(store, (s, id, b) => s.ackDocs(id, b as AckDocsRequest)) as Handler);
  app.post('/v1/tasks/:task_id/docs/stale-check', { preHandler: requireOperator, schema: staleCheckSchema }, wrapHandler(store, (s, id, b) => s.staleCheck(id, b as StaleCheckRequest)) as Handler);

  // Chunks and Contracts (operator+)
  app.post('/v1/chunks:get', { preHandler: requireOperator, schema: chunksGetSchema }, async (request, reply) => {
    const body = request.body as { chunk_ids?: string[]; doc_id?: string };
    const result = await store.getChunks({ chunk_ids: body.chunk_ids, doc_id: body.doc_id });
    return reply.send(result);
  });
  app.post('/v1/contracts:resolve', { preHandler: requireOperator, schema: contractsResolveSchema }, async (request, reply) => {
    const body = request.body as { feature?: string; task_id?: string };
    const result = await store.resolveContracts({ feature: body.feature, task_id: body.task_id });
    return reply.send(result);
  });

  // Tracker (operator+)
  app.post('/v1/tasks/:task_id/tracker/link', { preHandler: requireOperator, schema: trackerLinkSchema }, wrapHandler(store, (s, id, b) => s.linkTracker(id, b as TrackerLinkRequest)) as Handler);

  // Dispatch & Results (operator+)
  app.post('/v1/tasks/:task_id/dispatch', { preHandler: requireOperator, schema: dispatchSchema }, dispatchHandler(store) as Handler);
  app.post('/v1/tasks/:task_id/results', { preHandler: requireOperator, schema: workerResultSchema }, resultsHandler(store) as Handler);
  app.post('/v1/tasks/:task_id/transitions', { preHandler: requireOperator, schema: stateTransitionSchema }, wrapHandler(store, (s, id, b) => s.recordTransition(id, b as StateTransitionEvent)) as Handler);

  // Acceptance completion (operator+)
  app.post('/v1/tasks/:task_id/acceptance/complete', { preHandler: requireOperator, schema: completeAcceptanceSchema }, (async (request: TaskRequest<CompleteAcceptanceRequest>, reply: FastifyReply) => {
    try {
      const result = store.completeAcceptance(extractTaskId(request), request.body);
      return reply.send(result);
    } catch (error) {
      return handleError(reply, error);
    }
  }) as Handler);

  // Integrate (operator+)
  app.post('/v1/tasks/:task_id/integrate', { preHandler: requireOperator, schema: integrateSchema }, integrateHandler(store) as Handler);
  app.post('/v1/tasks/:task_id/integrate/complete', { preHandler: requireOperator, schema: completeIntegrateSchema }, wrapHandler(store, (s, id, b) => s.completeIntegrate(id, b as CompleteIntegrateRequest)) as Handler);

  // Publish (operator+)
  app.post('/v1/tasks/:task_id/publish', { preHandler: requireOperator, schema: publishSchema }, publishHandler(store) as Handler);
  // Approve publish - admin only (critical operation)
  app.post('/v1/tasks/:task_id/publish/approve', { preHandler: requireAdmin, schema: approvePublishSchema }, (async (request: TaskRequest<{ approval_token: string }>, reply: FastifyReply) => {
    try {
      const task = store.approvePublish(extractTaskId(request), request.body.approval_token);
      return reply.send({
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      });
    } catch (error) {
      return handleError(reply, error);
    }
  }) as Handler);
  app.post('/v1/tasks/:task_id/publish/complete', { preHandler: requireOperator, schema: completePublishSchema }, (async (request: TaskRequest<CompletePublishRequest>, reply: FastifyReply) => {
    try {
      const task = store.completePublish(extractTaskId(request), request.body);
      return reply.send({
        task_id: task.task_id,
        state: task.state,
        external_refs: task.external_refs,
        rollback_notes: task.rollback_notes,
        completed_at: task.completed_at,
      });
    } catch (error) {
      return handleError(reply, error);
    }
  }) as Handler);

  // Cancel - admin only (destructive operation)
  app.post('/v1/tasks/:task_id/cancel', { preHandler: requireAdmin }, wrapHandler(store, (s, id) => s.cancel(id)) as Handler);
  app.get('/v1/tasks/:task_id/events', async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    return reply.send({ items: store.listEvents(extractTaskId(request)) });
  });

  // Audit events
  app.get('/v1/tasks/:task_id/audit-events', async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    return reply.send({ items: store.listAuditEvents(extractTaskId(request)) });
  });

  // =============================================================================
  // Run API (Phase A)
  // =============================================================================

  // List runs
  app.get('/v1/runs', async (request: FastifyRequest<{ Querystring: { limit?: number; offset?: number; status?: string } }>, reply: FastifyReply) => {
    const { limit, offset, status } = request.query;
    const statusFilter = status ? status.split(',') as RunStatus[] : undefined;
    const runs = store.listRuns({ limit, offset, status: statusFilter });
    return reply.send({ items: runs, total: runs.length });
  });

  // Get run by ID
  app.get('/v1/runs/:run_id', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const run = store.getRun(request.params.run_id);
    if (!run) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `run not found: ${request.params.run_id}` });
    }
    return reply.send(run);
  });

  // Get run timeline
  app.get('/v1/runs/:run_id/timeline', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const run = store.getRun(request.params.run_id);
    if (!run) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `run not found: ${request.params.run_id}` });
    }
    const timeline = store.getRunTimeline(request.params.run_id);
    return reply.send({ run_id: request.params.run_id, items: timeline });
  });

  // Get run audit summary
  app.get('/v1/runs/:run_id/audit-summary', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const run = store.getRun(request.params.run_id);
    if (!run) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `run not found: ${request.params.run_id}` });
    }
    const summary = store.getRunAuditSummary(request.params.run_id);
    return reply.send({ run_id: request.params.run_id, ...summary });
  });

  // Get run checkpoints
  app.get('/v1/runs/:run_id/checkpoints', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const run = store.getRun(request.params.run_id);
    if (!run) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `run not found: ${request.params.run_id}` });
    }
    const checkpoints = store.getRunCheckpoints(request.params.run_id);
    return reply.send({ run_id: request.params.run_id, items: checkpoints });
  });

  // Get task checkpoints
  app.get('/v1/tasks/:task_id/checkpoints', async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const checkpoints = store.getTaskCheckpoints(extractTaskId(request));
    return reply.send({ task_id: extractTaskId(request), items: checkpoints });
  });

  // Job operations
  app.get('/v1/jobs/:job_id', async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
    const jobId = extractJobId(request);
    const jobStatus = store.getJob(jobId);
    if (!jobStatus.job) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `job not found: ${jobId}` });
    }
    return reply.send({
      job_id: jobId,
      task_id: jobStatus.job.task_id,
      job: jobStatus.job,
      latest_result: jobStatus.latest_result,
    });
  });

  // Job heartbeat (operator+ - typically called by workers)
  app.post('/v1/jobs/:job_id/heartbeat', { preHandler: requireOperator, schema: jobHeartbeatSchema }, (async (request: JobRequest<JobHeartbeatRequest>, reply: FastifyReply) => {
    try {
      const response = store.heartbeat(extractJobId(request), request.body);
      return reply.send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  }) as Handler);

  // =============================================================================
  // Retrospective API (Phase C)
  // =============================================================================

  // Get retrospective for a run (read-only)
  app.get('/v1/runs/:run_id/retrospective', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const retrospective = store.getRetrospective(request.params.run_id);
    if (!retrospective) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `retrospective not found for run: ${request.params.run_id}` });
    }
    return reply.send(retrospective);
  });

  // Generate retrospective for a run (operator+)
  app.post('/v1/runs/:run_id/retrospective:generate', { preHandler: requireOperator }, (async (request: FastifyRequest<{ Params: { run_id: string }; Body: { force?: boolean; skip_narrative?: boolean; model?: string } }>, reply: FastifyReply) => {
    try {
      const retrospective = store.generateRetrospective(request.params.run_id, request.body || {});
      return reply.send(retrospective);
    } catch (error) {
      return handleError(reply, error);
    }
  }) as Handler);

  // Get retrospective history for a run (read-only)
  app.get('/v1/runs/:run_id/retrospective/history', async (request: FastifyRequest<{ Params: { run_id: string } }>, reply: FastifyReply) => {
    const history = store.getRetrospectiveHistory(request.params.run_id);
    return reply.send({ run_id: request.params.run_id, items: history });
  });

  // Get retrospectives for a task (read-only)
  app.get('/v1/tasks/:task_id/retrospectives', async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const retrospectives = store.getRetrospectivesForTask(extractTaskId(request));
    return reply.send({ task_id: extractTaskId(request), items: retrospectives });
  });

  // =============================================================================
  // RepoPolicy API
  // =============================================================================

  // Get policy for a repository
  app.get('/v1/repos/:owner/:name/policy', async (request: FastifyRequest<{ Params: { owner: string; name: string } }>, reply: FastifyReply) => {
    const { owner, name } = request.params;
    const policy = repoPolicyStore.getPolicyByName(owner, name);
    return reply.send({ owner, name, policy });
  });

  // Set policy for a repository (admin only)
  app.put('/v1/repos/:owner/:name/policy', { preHandler: requireAdmin, schema: repoPolicySchema }, (async (request: FastifyRequest<{ Params: { owner: string; name: string }; Body: Partial<RepoPolicy> }>, reply: FastifyReply) => {
    const { owner, name } = request.params;
    const policy = request.body;
    repoPolicyStore.setPolicy(owner, name, policy as RepoPolicy);
    return reply.send({ owner, name, policy });
  }) as Handler);

  // Update policy for a repository (admin only, partial update)
  app.patch('/v1/repos/:owner/:name/policy', { preHandler: requireAdmin, schema: repoPolicySchema }, (async (request: FastifyRequest<{ Params: { owner: string; name: string }; Body: Partial<RepoPolicy> }>, reply: FastifyReply) => {
    const { owner, name } = request.params;
    const updates = request.body;
    const updated = repoPolicyStore.updatePolicy(owner, name, updates);
    return reply.send({ owner, name, policy: updated });
  }) as Handler);

  // List all repository policies (admin only)
  app.get('/v1/repos/policies', { preHandler: requireAdmin }, (async (request: FastifyRequest, reply: FastifyReply) => {
    const policies = repoPolicyStore.listPolicies();
    return reply.send({ items: policies });
  }) as Handler);

  // Delete policy for a repository (admin only)
  app.delete('/v1/repos/:owner/:name/policy', { preHandler: requireAdmin }, (async (request: FastifyRequest<{ Params: { owner: string; name: string } }>, reply: FastifyReply) => {
    const { owner, name } = request.params;
    const deleted = repoPolicyStore.deletePolicy(owner, name);
    return reply.send({ owner, name, deleted });
  }) as Handler);

  return store;
}
