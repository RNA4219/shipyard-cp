import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ExternalRef } from '../src/types.js';

describe('Tracker API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  async function createTask() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Tracker Test',
        objective: 'Test tracker link',
        typed_ref: `agent-taskstate:task:github:tracker-${Date.now()}`,
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

  describe('POST /v1/tasks/:task_id/tracker/link', () => {
    it('should link github_issue', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: task.typed_ref,
          connection_ref: 'conn_github',
          entity_ref: 'github_issue:123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.typed_ref).toBe(task.typed_ref);
      expect(body.external_refs).toHaveLength(2);
      expect(body.external_refs[0].kind).toBe('github_issue');
      expect(body.external_refs[0].value).toBe('123');
      expect(body.external_refs[0].connection_ref).toBe('conn_github');
      expect(body.external_refs[1].kind).toBe('sync_event');
      expect(body.sync_event_ref).toBeDefined();
    });

    it('should link github_project_item', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: task.typed_ref,
          entity_ref: 'github_project_item:PVT_item_456',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().external_refs[0].kind).toBe('github_project_item');
    });

    it('should link tracker_issue', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: task.typed_ref,
          entity_ref: 'tracker_issue:JIRA-789',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().external_refs[0].kind).toBe('tracker_issue');
    });

    it('should reject mismatched typed_ref', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: 'wrong:typed:ref:value',
          entity_ref: 'github_issue:123',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('typed_ref mismatch');
    });

    it('should allow multiple links on same task', async () => {
      const task = await createTask();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: task.typed_ref,
          entity_ref: 'github_issue:100',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/tracker/link`,
        payload: {
          typed_ref: task.typed_ref,
          entity_ref: 'github_project_item:PVT_200',
        },
      });

      expect(response.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: `/v1/tasks/${task.task_id}`,
      });
      const updatedTask = getResponse.json();
      const kinds = updatedTask.external_refs.map((r: ExternalRef) => r.kind);
      expect(kinds).toContain('github_issue');
      expect(kinds).toContain('github_project_item');
    });
  });
});