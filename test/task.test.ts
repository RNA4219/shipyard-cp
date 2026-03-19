import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Task API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  describe('POST /v1/tasks', () => {
    const validTask = {
      title: 'Test Task',
      objective: 'Test objective',
      typed_ref: 'agent-taskstate:task:github:test-001',
      repo_ref: {
        provider: 'github',
        owner: 'test',
        name: 'repo',
        default_branch: 'main',
      },
    };

    it('should create a task with required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: validTask,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.task_id).toMatch(/^task_/);
      expect(body.title).toBe('Test Task');
      expect(body.objective).toBe('Test objective');
      expect(body.typed_ref).toBe('agent-taskstate:task:github:test-001');
      expect(body.state).toBe('queued');
      expect(body.risk_level).toBe('medium');
    });

    it('should reject task without objective', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          typed_ref: 'agent-taskstate:task:github:test-002',
          repo_ref: validTask.repo_ref,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('objective is required');
    });

    it('should reject task without typed_ref', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          objective: 'Test objective',
          repo_ref: validTask.repo_ref,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('typed_ref is required');
    });

    it('should reject invalid typed_ref format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          ...validTask,
          typed_ref: 'invalid-format',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('typed_ref invalid format');
    });

    it('should preserve publish_plan and external_refs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          ...validTask,
          typed_ref: 'agent-taskstate:task:github:test-003',
          publish_plan: { mode: 'apply', approval_required: true },
          external_refs: [{ kind: 'github_issue', value: '123' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.publish_plan).toEqual({ mode: 'apply', approval_required: true });
      expect(body.external_refs).toEqual([{ kind: 'github_issue', value: '123' }]);
    });
  });

  describe('GET /v1/tasks/:task_id', () => {
    it('should return 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks/nonexistent-task',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('should return created task', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Get Test',
          objective: 'Test get',
          typed_ref: 'agent-taskstate:task:github:get-test-001',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      const taskId = createResponse.json().task_id;

      const response = await app.inject({
        method: 'GET',
        url: `/v1/tasks/${taskId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().task_id).toBe(taskId);
    });
  });
});