import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';

describe('Improvement routes', () => {
  let app: FastifyInstance & {
    store: import('../src/store/control-plane-store.js').ControlPlaneStore;
  };
  let taskId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Improvement observation test',
        objective: 'Verify explicit Evidence acknowledgement',
        typed_ref: 'agent-taskstate:task:github:improvement-observation-test',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
      },
    });
    taskId = created.json().task_id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not treat GET as acknowledgement and exports explicit ack only', async () => {
    const before = await app.inject({ method: 'GET', url: '/v1/improvement/observations' });
    expect(before.statusCode).toBe(200);
    expect(before.json().evidence_consumption_observations).toEqual([]);

    const acknowledged = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/evidence/EV-1/ack`,
      payload: { reviewed_by: 'qa-user', purpose: 'release review' },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json()).toMatchObject({
      task_id: taskId,
      evidence_id: 'EV-1',
      reviewed_by: 'qa-user',
    });

    const after = await app.inject({ method: 'GET', url: '/v1/improvement/observations' });
    expect(after.statusCode).toBe(200);
    expect(after.json().evidence_consumption_observations).toMatchObject([{
      task_id: taskId,
      evidence_id: 'EV-1',
      reviewed_by: 'qa-user',
    }]);
  });
});
