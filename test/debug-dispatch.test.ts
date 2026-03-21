import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Debug Dispatch Test', () => {
  let app: FastifyInstance & { store: any };

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  beforeEach(() => {
    app.store.resetConcurrency();
  });

  it('should debug dispatch and results', async () => {
    // Create task
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Debug Test',
        objective: 'Debug',
        typed_ref: `agent-taskstate:task:github:debug-${Date.now()}`,
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
      },
    });
    console.log('Create status:', createRes.statusCode);
    const task = createRes.json();
    console.log('Task:', { task_id: task.task_id, typed_ref: task.typed_ref, state: task.state });

    // Dispatch
    const dispatchRes = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.task_id}/dispatch`,
      payload: { target_stage: 'plan' },
    });
    console.log('Dispatch status:', dispatchRes.statusCode);
    const job = dispatchRes.json();
    console.log('Job:', { job_id: job?.job_id, task_id: job?.task_id });
    
    // Check task state after dispatch
    const taskAfterDispatch = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${task.task_id}`,
    });
    const taskData = taskAfterDispatch.json();
    console.log('Task after dispatch:', { 
      state: taskData.state, 
      active_job_id: taskData.active_job_id 
    });

    // Results
    const resultRes = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.task_id}/results`,
      payload: {
        job_id: job?.job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        summary: 'Test',
        artifacts: [],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 100 },
      },
    });
    console.log('Result status:', resultRes.statusCode);
    console.log('Result body:', JSON.stringify(resultRes.json(), null, 2));
    
    expect(resultRes.statusCode).toBe(200);
  });
});
