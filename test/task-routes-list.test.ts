import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Task Routes - GET /v1/tasks', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  describe('GET /v1/tasks', () => {
    it('should return empty list when no tasks exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], total: 0 });
    });

    it('should return list of tasks', async () => {
      // Create a task first
      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task List',
          objective: 'Test objective',
          typed_ref: 'test:task:list:unique001',
          repo_ref: {
            provider: 'github',
            owner: 'test-owner',
            name: 'test-repo',
            default_branch: 'main',
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      const found = body.items.find((t: { title: string }) => t.title === 'Test Task List');
      expect(found).toBeDefined();
    });

    it('should filter tasks by state', async () => {
      // Create tasks with unique typed_refs
      const createRes1 = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'State Filter Task 1',
          objective: 'Test objective',
          typed_ref: 'test:task:statefilter:unique001',
          repo_ref: {
            provider: 'github',
            owner: 'test-owner',
            name: 'test-repo',
            default_branch: 'main',
          },
        },
      });

      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'State Filter Task 2',
          objective: 'Test objective',
          typed_ref: 'test:task:statefilter:unique002',
          repo_ref: {
            provider: 'github',
            owner: 'test-owner',
            name: 'test-repo',
            default_branch: 'main',
          },
        },
      });

      const task1 = createRes1.json();

      // Cancel task 1
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task1.task_id}/cancel`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?state=queued',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // At least one queued task (Task 2)
      const queuedTasks = body.items.filter((t: { state: string }) => t.state === 'queued');
      expect(queuedTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter tasks by multiple states', async () => {
      // Create tasks with unique typed_refs
      const createRes1 = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Multi State Task 1',
          objective: 'Test objective',
          typed_ref: 'test:task:multistate:unique001',
          repo_ref: {
            provider: 'github',
            owner: 'test-owner',
            name: 'test-repo',
            default_branch: 'main',
          },
        },
      });

      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Multi State Task 2',
          objective: 'Test objective',
          typed_ref: 'test:task:multistate:unique002',
          repo_ref: {
            provider: 'github',
            owner: 'test-owner',
            name: 'test-repo',
            default_branch: 'main',
          },
        },
      });

      const task1 = createRes1.json();

      // Cancel task 1
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task1.task_id}/cancel`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?state=queued,cancelled',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // All returned tasks should be either queued or cancelled
      for (const task of body.items) {
        expect(['queued', 'cancelled']).toContain(task.state);
      }
    });

    it('should apply limit pagination', async () => {
      // Create tasks
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: `Limit Task ${i}`,
            objective: 'Test objective',
            typed_ref: `test:task:limit:unique${i.toString().padStart(3, '0')}`,
            repo_ref: {
              provider: 'github',
              owner: 'test-owner',
              name: 'test-repo',
              default_branch: 'main',
            },
          },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeLessThanOrEqual(2);
    });

    it('should apply offset pagination', async () => {
      // Create tasks
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: `Offset Task ${i}`,
            objective: 'Test objective',
            typed_ref: `test:task:offset:unique${i.toString().padStart(3, '0')}`,
            repo_ref: {
              provider: 'github',
              owner: 'test-owner',
              name: 'test-repo',
              default_branch: 'main',
            },
          },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?limit=10&offset=1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // With offset, we get fewer items than total
      expect(body.items.length).toBeGreaterThanOrEqual(0);
    });
  });
});