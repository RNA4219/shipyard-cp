import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Task Routes', () => {
  let app: FastifyInstance & { store: import('../src/store/control-plane-store.js').ControlPlaneStore };

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  describe('Authentication enabled mode', () => {
    it('requires an API key for protected write endpoints', async () => {
      const authApp = await buildApp({
        logger: false,
        auth: {
          enabled: true,
          apiKey: 'operator-key',
        },
      });

      try {
        const response = await authApp.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: 'Auth Test Task',
            objective: 'Verify auth',
            typed_ref: 'agent-taskstate:task:github:auth-create-001',
            repo_ref: {
              provider: 'github',
              owner: 'test',
              name: 'repo',
              default_branch: 'main',
            },
          },
        });

        expect(response.statusCode).toBe(401);
      } finally {
        await authApp.close();
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Endpoints', () => {
    it('GET /healthz returns liveness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status');
    });

    it('GET /health/ready returns readiness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      // Health check may return 503 if dependencies are unhealthy
      expect([200, 503]).toContain(response.statusCode);
      const body = response.json();
      expect(body).toHaveProperty('status');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    });

    it('GET /health returns detailed health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      // Health check may return 503 if unhealthy
      expect([200, 503]).toContain(response.statusCode);
      const body = response.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('services');
    });
  });

  describe('Static Docs Endpoints', () => {
    it('GET /openapi.yaml returns openapi spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.yaml',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/yaml');
    });

    it('GET /schemas/:name returns existing schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/schemas/task',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/schema+json');
    });

    it('GET /schemas/:name returns 404 for non-existent schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/schemas/nonexistent.schema.json',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
      expect(response.json().message).toContain('schema not found');
    });
  });

  describe('GET /v1/tasks - List Tasks', () => {
    it('returns list of tasks with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('supports limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?limit=5',
      });

      expect(response.statusCode).toBe(200);
    });

    it('supports offset parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?offset=10',
      });

      expect(response.statusCode).toBe(200);
    });

    it('supports state filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks?state=queued,planned',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /v1/tasks - Create Task', () => {
    it('returns 201 on successful creation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          objective: 'Test objective',
          typed_ref: 'agent-taskstate:task:github:test-create-001',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('returns 400 on missing objective', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          typed_ref: 'agent-taskstate:task:github:test-create-002',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('objective is required');
    });

    it('returns 400 on invalid typed_ref format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Test Task',
          objective: 'Test objective',
          typed_ref: 'invalid-format',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('typed_ref invalid format');
    });
  });

  describe('GET /v1/tasks/:task_id - Get Task', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks/nonexistent-task-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('POST /v1/tasks/:task_id/dispatch', () => {
    let taskId: string;

    beforeEach(async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Dispatch Test',
          objective: 'Test dispatch',
          typed_ref: 'agent-taskstate:task:github:dispatch-test',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });
      taskId = response.json().task_id;
    });

    it('returns 202 on successful dispatch', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskId}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      expect(response.statusCode).toBe(202);
    });

    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/dispatch',
        payload: { target_stage: 'plan' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/integrate', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/integrate',
        payload: { base_sha: 'abc123' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/publish', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/publish',
        payload: { mode: 'apply' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/publish/approve', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/publish/approve',
        payload: { approval_token: 'invalid-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/publish/complete', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/publish/complete',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tasks/:task_id/cancel', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks/nonexistent/cancel',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/tasks/:task_id/events', () => {
    it('returns events list for task', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Events Test',
          objective: 'Test events',
          typed_ref: 'agent-taskstate:task:github:events-test',
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
        url: `/v1/tasks/${taskId}/events`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('items');
    });
  });

  describe('GET /v1/tasks/:task_id/audit-events', () => {
    it('returns audit events list for task', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Audit Test',
          objective: 'Test audit events',
          typed_ref: 'agent-taskstate:task:github:audit-test',
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
        url: `/v1/tasks/${taskId}/audit-events`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('items');
    });
  });

  describe('GET /v1/tasks/:task_id/checkpoints', () => {
    it('returns checkpoints for task', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Checkpoints Test',
          objective: 'Test checkpoints',
          typed_ref: 'agent-taskstate:task:github:checkpoints-test',
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
        url: `/v1/tasks/${taskId}/checkpoints`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('items');
    });
  });

  describe('Run API', () => {
    describe('GET /v1/runs', () => {
      it('returns list of runs', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty('items');
        expect(response.json()).toHaveProperty('total');
      });

      it('supports status filter', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs?status=running,completed',
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('GET /v1/runs/:run_id', () => {
      it('returns 404 for non-existent run', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run',
        });

        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('NOT_FOUND');
      });
    });

    describe('GET /v1/runs/:run_id/timeline', () => {
      it('returns 404 for non-existent run', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run/timeline',
        });

        expect(response.statusCode).toBe(404);
      });
    });

    describe('GET /v1/runs/:run_id/audit-summary', () => {
      it('returns 404 for non-existent run', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run/audit-summary',
        });

        expect(response.statusCode).toBe(404);
      });
    });

    describe('GET /v1/runs/:run_id/checkpoints', () => {
      it('returns 404 for non-existent run', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run/checkpoints',
        });

        expect(response.statusCode).toBe(404);
      });
    });
  });

  describe('Job API', () => {
    describe('GET /v1/jobs/:job_id', () => {
      it('returns 404 for non-existent job', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/jobs/nonexistent-job',
        });

        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('NOT_FOUND');
      });
    });
  });

  describe('Retrospective API', () => {
    describe('GET /v1/runs/:run_id/retrospective', () => {
      it('returns 404 for non-existent retrospective', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run/retrospective',
        });

        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe('NOT_FOUND');
      });
    });

    describe('GET /v1/runs/:run_id/retrospective/history', () => {
      it('returns history list', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/runs/nonexistent-run/retrospective/history',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty('items');
      });
    });

    describe('GET /v1/tasks/:task_id/retrospectives', () => {
      it('returns retrospectives for task', async () => {
        const createResponse = await app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: 'Retro Test',
            objective: 'Test retrospectives',
            typed_ref: 'agent-taskstate:task:github:retro-test',
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
          url: `/v1/tasks/${taskId}/retrospectives`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty('items');
      });
    });
  });

  describe('RepoPolicy API', () => {
    describe('GET /v1/repos/:owner/:name/policy', () => {
      it('returns policy for repository', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/repos/testowner/testrepo/policy',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty('owner');
        expect(response.json()).toHaveProperty('name');
        // policy may be omitted if not set (undefined is not serialized in JSON)
      });
    });

    describe('PUT /v1/repos/:owner/:name/policy', () => {
      it('creates/updates policy for repository', async () => {
        const response = await app.inject({
          method: 'PUT',
          url: '/v1/repos/testowner/testrepo/policy',
          payload: {
            allowed_branches: ['main', 'develop'],
            require_approval: true,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().policy).toBeDefined();
      });
    });

    describe('PATCH /v1/repos/:owner/:name/policy', () => {
      it('updates policy partially', async () => {
        // First create a policy
        await app.inject({
          method: 'PUT',
          url: '/v1/repos/testowner/patchrepo/policy',
          payload: {
            allowed_branches: ['main'],
          },
        });

        const response = await app.inject({
          method: 'PATCH',
          url: '/v1/repos/testowner/patchrepo/policy',
          payload: {
            require_approval: true,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().policy.require_approval).toBe(true);
      });
    });

    describe('DELETE /v1/repos/:owner/:name/policy', () => {
      it('deletes policy for repository', async () => {
        // First create a policy
        await app.inject({
          method: 'PUT',
          url: '/v1/repos/testowner/deleterepo/policy',
          payload: {
            allowed_branches: ['main'],
          },
        });

        const response = await app.inject({
          method: 'DELETE',
          url: '/v1/repos/testowner/deleterepo/policy',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty('deleted');
      });
    });
  });

  describe('Chunks and Contracts API', () => {
    describe('POST /v1/chunks:get', () => {
      it('returns chunks for chunk_ids', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/chunks:get',
          payload: {
            chunk_ids: ['chunk1', 'chunk2'],
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('returns chunks for doc_id', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/chunks:get',
          payload: {
            doc_id: 'doc123',
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('POST /v1/contracts:resolve', () => {
      it('returns contracts for feature', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/contracts:resolve',
          payload: {
            feature: 'core',
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('returns contracts for task_id', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/contracts:resolve',
          payload: {
            task_id: 'task123',
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });
  });

  describe('Error Response Patterns', () => {
    it('returns STATE_CONFLICT for state mismatch errors', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Conflict Test',
          objective: 'Test conflict',
          typed_ref: 'agent-taskstate:task:github:conflict-test',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });
      const taskId = createResponse.json().task_id;

      // Try to complete acceptance without being in accepting state
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskId}/acceptance/complete`,
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('STATE_CONFLICT');
    });

    it('returns NOT_FOUND for missing resources', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks/nonexistent-task-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('Docs Operations', () => {
    let taskId: string;

    beforeEach(async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Docs Test',
          objective: 'Test docs operations',
          typed_ref: 'agent-taskstate:task:github:docs-test',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });
      taskId = response.json().task_id;
    });

    it('POST /v1/tasks/:task_id/docs/resolve resolves docs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskId}/docs/resolve`,
        payload: { feature: 'core', topic: 'testing' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('doc_refs');
    });

    it('POST /v1/tasks/:task_id/docs/ack acknowledges docs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskId}/docs/ack`,
        payload: { doc_refs: ['doc1', 'doc2'] },
      });

      expect(response.statusCode).toBe(200);
    });

    it('POST /v1/tasks/:task_id/docs/stale-check performs stale check', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskId}/docs/stale-check`,
        payload: { doc_refs: ['doc1'] },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Tracker Operations', () => {
    it('POST /v1/tasks/:task_id/tracker/link links tracker', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Tracker Test',
          objective: 'Test tracker',
          typed_ref: 'agent-taskstate:task:github:tracker-test',
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
        method: 'POST',
        url: `/v1/tasks/${taskId}/tracker/link`,
        payload: {
          typed_ref: 'agent-taskstate:task:github:tracker-test',
          entity_ref: 'github_project_item:PVT_item_100',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Transitions API', () => {
    it('POST /v1/tasks/:task_id/transitions records transition', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Transition Test',
          objective: 'Test transition',
          typed_ref: 'agent-taskstate:task:github:transition-test',
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
        method: 'POST',
        url: `/v1/tasks/${taskId}/transitions`,
        payload: {
          from_state: 'queued',
          to_state: 'planned',
          reason: 'Plan completed',
          timestamp: new Date().toISOString(),
        },
      });

      // May return 200 or 409 depending on state validation
      expect([200, 409]).toContain(response.statusCode);
    });
  });
});
