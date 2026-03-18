import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

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

function handleError(reply: FastifyReply, error: unknown): FastifyReply {
  const http = toHttpError(error);
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
      const job = store.dispatch(extractTaskId(request), request.body);
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

export async function registerRoutes(app: FastifyInstance): Promise<ControlPlaneStore> {
  const rootDir = process.cwd();
  const docs = loadStaticDocs(rootDir);
  const store = new ControlPlaneStore();

  app.decorate('store', store);

  // Static docs
  app.get('/healthz', async () => ({ status: 'ok' }));
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
  app.post('/v1/tasks/:task_id/publish/approve', async (request: TaskRequest<{ approval_token: string }>, reply: FastifyReply) => {
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
  });
  app.post('/v1/tasks/:task_id/publish/complete', async (request: TaskRequest<CompletePublishRequest>, reply: FastifyReply) => {
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
  });

  // Cancel & Events
  app.post('/v1/tasks/:task_id/cancel', wrapHandler(store, (s, id) => s.cancel(id)));
  app.get('/v1/tasks/:task_id/events', async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    return reply.send({ items: store.listEvents(extractTaskId(request)) });
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

  app.post('/v1/jobs/:job_id/heartbeat', async (request: JobRequest<JobHeartbeatRequest>, reply: FastifyReply) => {
    try {
      const response = store.heartbeat(extractJobId(request), request.body);
      return reply.send(response);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  return store;
}