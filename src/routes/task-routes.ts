import type { FastifyInstance } from 'fastify';

import { loadStaticDocs } from '../domain/static-docs.js';
import { ControlPlaneStore } from '../store/control-plane-store.js';
import type {
  AckDocsRequest,
  CompleteIntegrateRequest,
  CompletePublishRequest,
  CreateTaskRequest,
  DispatchRequest,
  JobHeartbeatRequest,
  PublishRequest,
  ResolveDocsRequest,
  StaleCheckRequest,
  StateTransitionEvent,
  TrackerLinkRequest,
  WorkerResult,
} from '../types.js';

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
      'not accepted',
      'not integrated',
      'not integrating',
      'not publishing',
      'not pending approval',
      'transition not allowed',
    ],
    statusCode: 409,
    code: 'STATE_CONFLICT',
  },
];

function toHttpError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : 'unknown error';
  const lower = message.toLowerCase();

  for (const { patterns, statusCode, code } of ERROR_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) {
      return { statusCode, body: { code, message } };
    }
  }
  return { statusCode: 400, body: { code: 'BAD_REQUEST', message } };
}

function handleError(reply: any, error: unknown): any {
  const http = toHttpError(error);
  return reply.status(http.statusCode).send(http.body);
}

function extractTaskId(request: any): string {
  return (request.params as { task_id: string }).task_id;
}

function extractJobId(request: any): string {
  return (request.params as { job_id: string }).job_id;
}

// =============================================================================
// Route Handlers
// =============================================================================

function createTaskHandler(store: ControlPlaneStore) {
  return async (request: any, reply: any) => {
    try {
      const task = store.createTask(request.body as CreateTaskRequest);
      return reply.status(201).send(task);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function getTaskHandler(store: ControlPlaneStore) {
  return async (request: any, reply: any) => {
    const taskId = extractTaskId(request);
    const task = store.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `task not found: ${taskId}` });
    }
    return reply.send(task);
  };
}

function dispatchHandler(store: ControlPlaneStore) {
  return async (request: any, reply: any) => {
    try {
      const job = store.dispatch(extractTaskId(request), request.body as DispatchRequest);
      return reply.status(202).send(job);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function resultsHandler(store: ControlPlaneStore) {
  return async (request: any, reply: any) => {
    try {
      const response = store.applyResult(extractTaskId(request), request.body as WorkerResult);
      return reply.send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function integrateHandler(store: ControlPlaneStore) {
  return async (request: any, reply: any) => {
    try {
      const body = request.body as { base_sha: string };
      const task = store.integrate(extractTaskId(request), body.base_sha);
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
  return async (request: any, reply: any) => {
    try {
      const task = store.publish(extractTaskId(request), request.body as PublishRequest);
      const response: Record<string, unknown> = {
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      };
      // Include approval token for pending approval state
      // In production, this would be sent via secure notification channel
      if (task.state === 'publish_pending_approval' && task.pending_approval_token) {
        response.approval_token = task.pending_approval_token;
        response.approval_expires_at = task.pending_approval_expires_at;
      }
      return reply.status(202).send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  };
}

function wrapHandler<T>(store: ControlPlaneStore, fn: (store: ControlPlaneStore, taskId: string, body: T) => any | Promise<any>) {
  return async (request: any, reply: any) => {
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

export async function registerRoutes(app: FastifyInstance): Promise<ControlPlaneStore> {
  const rootDir = process.cwd();
  const docs = loadStaticDocs(rootDir);
  const store = new ControlPlaneStore();

  app.decorate('store', store);

  // Static docs
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/openapi.yaml', async (_request, reply) => reply.type('application/yaml').send(docs.openapi));
  app.get('/schemas/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const key = name as keyof typeof docs.schemas;
    const schema = docs.schemas[key];
    if (!schema) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `schema not found: ${name}` });
    }
    return reply.type('application/schema+json').send(schema);
  });

  // Task CRUD
  app.post('/v1/tasks', createTaskHandler(store));
  app.get('/v1/tasks/:task_id', getTaskHandler(store));

  // Docs operations
  app.post('/v1/tasks/:task_id/docs/resolve', wrapHandler(store, (s, id, b) => s.resolveDocs(id, b as ResolveDocsRequest)));
  app.post('/v1/tasks/:task_id/docs/ack', wrapHandler(store, (s, id, b) => s.ackDocs(id, b as AckDocsRequest)));
  app.post('/v1/tasks/:task_id/docs/stale-check', wrapHandler(store, (s, id, b) => s.staleCheck(id, b as StaleCheckRequest)));

  // Tracker
  app.post('/v1/tasks/:task_id/tracker/link', wrapHandler(store, (s, id, b) => s.linkTracker(id, b as TrackerLinkRequest)));

  // Dispatch & Results
  app.post('/v1/tasks/:task_id/dispatch', dispatchHandler(store));
  app.post('/v1/tasks/:task_id/results', resultsHandler(store));
  app.post('/v1/tasks/:task_id/transitions', wrapHandler(store, (s, id, b) => s.recordTransition(id, b as StateTransitionEvent)));

  // Integrate
  app.post('/v1/tasks/:task_id/integrate', integrateHandler(store));
  app.post('/v1/tasks/:task_id/integrate/complete', wrapHandler(store, (s, id, b) => s.completeIntegrate(id, b as CompleteIntegrateRequest)));

  // Publish
  app.post('/v1/tasks/:task_id/publish', publishHandler(store));
  app.post('/v1/tasks/:task_id/publish/approve', async (request, reply) => {
    try {
      const body = request.body as { approval_token: string };
      const task = store.approvePublish(extractTaskId(request), body.approval_token);
      return reply.send({
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });
  app.post('/v1/tasks/:task_id/publish/complete', async (request, reply) => {
    try {
      const task = store.completePublish(extractTaskId(request), request.body as CompletePublishRequest);
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
  });

  // Cancel & Events
  app.post('/v1/tasks/:task_id/cancel', wrapHandler(store, (s, id) => s.cancel(id)));
  app.get('/v1/tasks/:task_id/events', async (request, reply) => {
    return reply.send({ items: store.listEvents(extractTaskId(request)) });
  });

  // Job operations
  app.get('/v1/jobs/:job_id', async (request, reply) => {
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

  app.post('/v1/jobs/:job_id/heartbeat', async (request, reply) => {
    try {
      const response = store.heartbeat(extractJobId(request), request.body as JobHeartbeatRequest);
      return reply.send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  return store;
}
