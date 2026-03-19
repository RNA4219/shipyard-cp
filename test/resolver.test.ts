import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Resolver API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  async function createTask() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Resolver Test',
        objective: 'Test resolver',
        typed_ref: `agent-taskstate:task:github:resolver-${Date.now()}`,
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
      },
    });
    return response.json();
  }

  describe('POST /v1/tasks/:task_id/docs/resolve', () => {
    it('should resolve docs with feature and topic', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/resolve`,
        payload: {
          feature: 'auth',
          topic: 'oauth',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.typed_ref).toBe(task.typed_ref);
      expect(body.doc_refs).toContain('doc:feature:auth');
      expect(body.doc_refs).toContain('doc:topic:oauth');
      expect(body.chunk_refs).toContain('chunk:feature:auth:1');
      expect(body.stale_status).toBe('fresh');
    });

    it('should return default docs if no specific request', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/resolve`,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.doc_refs).toContain('doc:workflow-cookbook:blueprint');
    });

    it('should return 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/docs/resolve',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/docs/ack', () => {
    it('should record ack for document', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/ack`,
        payload: {
          doc_id: 'doc:feature:auth',
          version: 'v1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ack_ref).toContain('ack:');
      expect(body.ack_ref).toContain(task.task_id);
      expect(body.ack_ref).toContain('doc:feature:auth');
      expect(body.ack_ref).toContain('v1');
    });

    it('should update task resolver_refs with ack', async () => {
      const task = await createTask();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/ack`,
        payload: {
          doc_id: 'doc:test:doc',
          version: 'v1',
        },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: `/v1/tasks/${task.task_id}`,
      });

      const updatedTask = getResponse.json();
      expect(updatedTask.resolver_refs?.ack_refs).toBeDefined();
      expect(updatedTask.resolver_refs?.ack_refs?.length).toBeGreaterThan(0);
    });
  });

  describe('POST /v1/tasks/:task_id/docs/stale-check', () => {
    it('should return empty stale list when no ack_refs', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/stale-check`,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.task_id).toBe(task.task_id);
      expect(body.stale).toEqual([]);
    });

    it('should check stale for acknowledged documents', async () => {
      const task = await createTask();

      // First ack a document
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/ack`,
        payload: {
          doc_id: 'doc:feature:auth',
          version: '2026-03-01',
        },
      });

      // Then check for stale
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/stale-check`,
        payload: {
          doc_ids: ['doc:feature:auth'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.task_id).toBe(task.task_id);
      expect(body.stale).toBeInstanceOf(Array);
    });

    it('should detect missing documents', async () => {
      const task = await createTask();

      // Ack a document
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/ack`,
        payload: {
          doc_id: 'doc:missing:doc',
          version: 'v1',
        },
      });

      // Check for stale (doc with 'missing' in id is simulated as missing)
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/stale-check`,
        payload: {
          doc_ids: ['doc:missing:doc'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.stale.length).toBeGreaterThan(0);
      expect(body.stale[0].reason).toBe('document_missing');
    });

    it('should return 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/docs/stale-check',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('should update stale_status when stale documents found', async () => {
      const task = await createTask();

      // Ack a missing document
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/ack`,
        payload: {
          doc_id: 'doc:missing:test',
          version: 'v1',
        },
      });

      // Check for stale
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/docs/stale-check`,
        payload: {
          doc_ids: ['doc:missing:test'],
        },
      });

      // Get task to verify stale_status was updated
      const getResponse = await app.inject({
        method: 'GET',
        url: `/v1/tasks/${task.task_id}`,
      });

      const updatedTask = getResponse.json();
      expect(updatedTask.resolver_refs?.stale_status).toBe('stale');
    });
  });
});