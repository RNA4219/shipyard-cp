import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Integrate/Publish API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  async function createTaskToAccepted() {
    const task = await createTask();
    await dispatchAndComplete('plan', task);
    await dispatchAndComplete('dev', task);
    await dispatchAndComplete('acceptance', task, {
      verdict: { outcome: 'accept', reason: 'All checks passed' },
      test_results: [{ suite: 'acceptance', status: 'passed', passed: 3 }],
    });
    // Complete manual acceptance to transition to 'accepted'
    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.task_id}/acceptance/complete`,
      payload: {},
    });
    return task;
  }

  async function createTask() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Integrate Test',
        objective: 'Test integrate and publish',
        typed_ref: `agent-taskstate:task:github:integ-${Date.now()}`,
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        publish_plan: { mode: 'apply', approval_required: true },
      },
    });
    return response.json();
  }

  async function dispatchAndComplete(stage: string, task: any, overrides: any = {}) {
    const dispatchResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.task_id}/dispatch`,
      payload: { target_stage: stage },
    });
    const job = dispatchResponse.json();

    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.task_id}/results`,
      payload: {
        job_id: job.job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        summary: `${stage} completed`,
        artifacts: [{ artifact_id: `art_${stage}`, kind: 'log', uri: 'file:///log' }],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 1000 },
        ...overrides,
      },
    });
  }

  describe('POST /v1/tasks/:task_id/integrate', () => {
    it('should start integration from accepted state', async () => {
      const task = await createTaskToAccepted();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123def456' },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.state).toBe('integrating');
      expect(body.integration_branch).toContain('cp/integrate/');
    });

    it('should reject integrate from wrong state', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('not accepted');
    });
  });

  describe('POST /v1/tasks/:task_id/integrate/complete', () => {
    it('should transition to integrated when checks pass', async () => {
      const task = await createTaskToAccepted();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: {
          checks_passed: true,
          integration_head_sha: 'xyz789',
          main_updated_sha: 'abc123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe('integrated');
    });

    it('should transition to blocked when checks fail', async () => {
      const task = await createTaskToAccepted();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe('blocked');
    });
  });

  describe('POST /v1/tasks/:task_id/publish', () => {
    it('should start publish from integrated state', async () => {
      const task = await createTaskToAccepted();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: true },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'apply', idempotency_key: 'key-001' },
      });

      expect(response.statusCode).toBe(202);
      // approval_required is true, so should be pending approval
      expect(response.json().state).toBe('publish_pending_approval');
    });

    it('should start publishing directly when no approval required', async () => {
      const taskResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'No Approval Test',
          objective: 'Test',
          typed_ref: `agent-taskstate:task:github:no-approv-${Date.now()}`,
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });
      const task = taskResponse.json();

      // Get to integrated state
      await dispatchAndComplete('plan', task);
      await dispatchAndComplete('dev', task);
      await dispatchAndComplete('acceptance', task, {
        verdict: { outcome: 'accept' },
        test_results: [{ suite: 'acceptance', status: 'passed' }],
      });
      // Complete manual acceptance
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/acceptance/complete`,
        payload: {},
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: true },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'dry_run', idempotency_key: 'key-002' },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().state).toBe('publishing');
    });

    it('should reject publish from wrong state', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'apply', idempotency_key: 'key-003' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('not integrated');
    });
  });

  describe('POST /v1/tasks/:task_id/publish/approve', () => {
    it('should approve publish and transition to publishing', async () => {
      const task = await createTaskToAccepted();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: true },
      });
      const publishResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'apply', idempotency_key: 'key-004' },
      });

      // Use the generated approval token
      const approvalToken = publishResponse.json().approval_token;

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish/approve`,
        payload: { approval_token: approvalToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe('publishing');
    });

    it('should reject approval from wrong state', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish/approve`,
        payload: { approval_token: 'token' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('not pending approval');
    });

    it('should reject invalid approval token', async () => {
      const task = await createTaskToAccepted();

      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: true },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'apply', idempotency_key: 'key-005' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish/approve`,
        payload: { approval_token: 'invalid-token' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('invalid approval token');
    });
  });

  describe('POST /v1/tasks/:task_id/publish/complete', () => {
    it('should complete publish and set terminal state', async () => {
      const task = await createTaskToAccepted();

      // Complete integration
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate`,
        payload: { base_sha: 'abc123' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/integrate/complete`,
        payload: { checks_passed: true },
      });

      // Start and approve publish with valid token
      const publishResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish`,
        payload: { mode: 'apply', idempotency_key: 'key-006' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish/approve`,
        payload: { approval_token: publishResponse.json().approval_token },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/publish/complete`,
        payload: {
          external_refs: [{ kind: 'deployment', value: 'deploy-001' }],
          rollback_notes: 'Rollback to abc123 if needed',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe('published');
      expect(response.json().external_refs).toContainEqual({ kind: 'deployment', value: 'deploy-001' });
      expect(response.json().rollback_notes).toBe('Rollback to abc123 if needed');
      expect(response.json().completed_at).toBeDefined();
    });
  });
});