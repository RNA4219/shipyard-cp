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

function toHttpError(error: unknown): { statusCode: number; body: { code: string; message: string } } {
  const message = error instanceof Error ? error.message : 'unknown error';
  const lower = message.toLowerCase();
  if (lower.includes('not found')) {
    return { statusCode: 404, body: { code: 'NOT_FOUND', message } };
  }
  if (lower.includes('cannot') || lower.includes('mismatch') || lower.includes('terminal') || lower.includes('not accepted') || lower.includes('not integrated') || lower.includes('not integrating') || lower.includes('not publishing') || lower.includes('not pending approval') || lower.includes('transition not allowed')) {
    return { statusCode: 409, body: { code: 'STATE_CONFLICT', message } };
  }
  return { statusCode: 400, body: { code: 'BAD_REQUEST', message } };
}

export async function registerRoutes(app: FastifyInstance): Promise<ControlPlaneStore> {
  const rootDir = process.cwd();
  const docs = loadStaticDocs(rootDir);
  const store = new ControlPlaneStore();

  // Decorate app with store for testing access
  app.decorate('store', store);

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

  app.post('/v1/tasks', async (request, reply) => {
    try {
      const task = store.createTask(request.body as CreateTaskRequest);
      return reply.status(201).send(task);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.get('/v1/tasks/:task_id', async (request, reply) => {
    const { task_id: taskId } = request.params as { task_id: string };
    const task = store.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: `task not found: ${taskId}` });
    }
    return reply.send(task);
  });

  app.post('/v1/tasks/:task_id/docs/resolve', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.resolveDocs(taskId, request.body as ResolveDocsRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/docs/ack', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.ackDocs(taskId, request.body as AckDocsRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/docs/stale-check', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.staleCheck(taskId, request.body as StaleCheckRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/tracker/link', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.linkTracker(taskId, request.body as TrackerLinkRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/dispatch', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const job = store.dispatch(taskId, request.body as DispatchRequest);
      return reply.status(202).send(job);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/results', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.applyResult(taskId, request.body as WorkerResult);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/transitions', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const event = store.recordTransition(taskId, request.body as StateTransitionEvent);
      return reply.send(event);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/integrate', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const body = request.body as { base_sha: string };
      const task = store.integrate(taskId, body.base_sha);
      return reply.status(202).send({
        task_id: task.task_id,
        state: task.state,
        integration_branch: task.integration?.integration_branch,
      });
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/publish', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const task = store.publish(taskId, request.body as PublishRequest);
      return reply.status(202).send({
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      });
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/integrate/complete', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const response = store.completeIntegrate(taskId, request.body as CompleteIntegrateRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/publish/approve', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const body = request.body as { approval_token: string };
      const task = store.approvePublish(taskId, body.approval_token);
      return reply.send({
        task_id: task.task_id,
        state: task.state,
        publish_run_id: `pub_${task.task_id}`,
      });
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/publish/complete', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const task = store.completePublish(taskId, request.body as CompletePublishRequest);
      return reply.send({
        task_id: task.task_id,
        state: task.state,
        external_refs: task.external_refs,
        rollback_notes: task.rollback_notes,
        completed_at: task.completed_at,
      });
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.post('/v1/tasks/:task_id/cancel', async (request, reply) => {
    try {
      const { task_id: taskId } = request.params as { task_id: string };
      const task = store.cancel(taskId);
      return reply.send(task);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  app.get('/v1/tasks/:task_id/events', async (request, reply) => {
    const { task_id: taskId } = request.params as { task_id: string };
    return reply.send({ items: store.listEvents(taskId) });
  });

  app.get('/v1/jobs/:job_id', async (request, reply) => {
    const { job_id: jobId } = request.params as { job_id: string };
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
      const { job_id: jobId } = request.params as { job_id: string };
      const response = store.heartbeat(jobId, request.body as JobHeartbeatRequest);
      return reply.send(response);
    } catch (error) {
      const http = toHttpError(error);
      return reply.status(http.statusCode).send(http.body);
    }
  });

  return store;
}
