import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Worker Orchestration API', () => {
  let app: FastifyInstance & { store: any };

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  beforeEach(() => {
    // Reset concurrency state between tests
    app.store.resetConcurrency();
  });

  async function createTask() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Worker Test',
        objective: 'Test worker orchestration',
        typed_ref: `shipyard:task:github:worker-${Date.now()}`,
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

  describe('POST /v1/tasks/:task_id/dispatch', () => {
    it('should dispatch plan job from queued state', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.job_id).toMatch(/^job_/);
      expect(body.task_id).toBe(task.task_id);
      expect(body.typed_ref).toBe(task.typed_ref);
      expect(body.stage).toBe('plan');
      expect(body.worker_type).toBe('codex');
      expect(body.context?.objective).toBe('Test worker orchestration');
    });

    it('should reject invalid dispatch stage', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'dev' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('cannot dispatch');
    });

    it('should dispatch dev job from planned state', async () => {
      const task = await createTask();

      // Dispatch plan
      const planResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });
      const planJob = planResponse.json();

      // Submit plan result
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: planJob.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          artifacts: [{ artifact_id: 'art1', kind: 'log', uri: 'file:///log' }],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        },
      });

      // Dispatch dev
      const devResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'dev' },
      });

      expect(devResponse.statusCode).toBe(202);
      expect(devResponse.json().stage).toBe('dev');
    });
  });

  describe('POST /v1/tasks/:task_id/results', () => {
    it('should apply succeeded result and transition state', async () => {
      const task = await createTask();

      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });
      const job = dispatchResponse.json();

      const resultResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: task.typed_ref,
          status: 'succeeded',
          summary: 'Plan completed',
          artifacts: [{ artifact_id: 'art1', kind: 'log', uri: 'file:///log' }],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
          resolver_refs: { doc_refs: ['doc:test'], stale_status: 'fresh' },
          context_bundle_ref: 'bundle:test:v1',
        },
      });

      expect(resultResponse.statusCode).toBe(200);
      const body = resultResponse.json();
      expect(body.task.state).toBe('planned');
      expect(body.task.resolver_refs?.doc_refs).toContain('doc:test');
      expect(body.task.context_bundle_ref).toBe('bundle:test:v1');
      expect(body.next_action).toBe('dispatch_dev');
      expect(body.emitted_events).toHaveLength(1);
    });

    it('should reject result with mismatched typed_ref', async () => {
      const task = await createTask();

      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });
      const job = dispatchResponse.json();

      const resultResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: 'wrong:typed:ref:value',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        },
      });

      expect(resultResponse.statusCode).toBe(409);
      expect(resultResponse.json().message).toContain('typed_ref mismatch');
    });

    it('should transition to blocked on blocked result', async () => {
      const task = await createTask();

      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });
      const job = dispatchResponse.json();

      const resultResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: task.typed_ref,
          status: 'blocked',
          summary: 'Waiting for input',
          artifacts: [],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        },
      });

      expect(resultResponse.statusCode).toBe(200);
      expect(resultResponse.json().task.state).toBe('blocked');
      expect(resultResponse.json().next_action).toBe('wait_manual');
    });
  });

  describe('State Transition Validation', () => {
    it('should reject invalid state transition', async () => {
      const task = await createTask();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.task_id}/transitions`,
        payload: {
          event_id: 'evt_test',
          task_id: task.task_id,
          from_state: 'queued',
          to_state: 'published',
          actor_type: 'control_plane',
          actor_id: 'test',
          reason: 'invalid transition test',
          occurred_at: new Date().toISOString(),
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('transition not allowed');
    });
  });
});