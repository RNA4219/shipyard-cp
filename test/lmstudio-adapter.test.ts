import { describe, expect, it } from 'vitest';
import { LMStudioAdapter } from '../src/domain/worker/lmstudio-adapter.js';
import { BackendRouter } from '../src/domain/worker/backend-router.js';
import type { WorkerJob } from '../src/types.js';

class InspectableLMStudioAdapter extends LMStudioAdapter {
  responseFormatFor(job: WorkerJob) {
    return this.getResponseFormat(job);
  }
}

function createJob(stage: WorkerJob['stage'], risk: WorkerJob['risk_level']): WorkerJob {
  return {
    job_id: `job-${stage}-${risk}`,
    task_id: 'task-lmstudio',
    typed_ref: 'shipyard:task:local:lmstudio',
    stage,
    repo_ref: {
      provider: 'github',
      owner: 'example',
      name: 'repo',
      default_branch: 'main',
    },
    worker_type: 'codex',
    risk_level: risk,
    input_prompt: 'Return valid JSON.',
  };
}

describe('LMStudioAdapter', () => {
  it('keeps the logical worker type while exposing LM Studio metadata', async () => {
    const adapter = new LMStudioAdapter({ workerType: 'codex', model: 'qwen3-8b' });
    const capabilities = await adapter.getCapabilities();

    expect(capabilities.worker_type).toBe('codex');
    expect(capabilities.metadata?.provider).toBe('lmstudio');
    expect(capabilities.max_concurrent_jobs).toBe(1);
    expect(capabilities.metadata?.lm_link_transparent).toBe(true);
  });

  it('blocks high-risk work under the default local routing policy', async () => {
    const adapter = new LMStudioAdapter({ workerType: 'codex', model: 'qwen3-8b' });
    const result = await adapter.submitJob(createJob('plan', 'high'));

    expect(result).toMatchObject({
      success: false,
      status: 'rejected',
      error: expect.stringContaining('WORKER_BACKEND_POLICY_DENIED'),
    });
  });

  it('blocks final acceptance under the default local routing policy', async () => {
    const adapter = new LMStudioAdapter({ workerType: 'claude_code', model: 'qwen3-8b' });
    const result = await adapter.submitJob(createJob('acceptance', 'low'));

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
  });

  it('requests LM Studio JSON-schema output for plan and dev without changing worker type', () => {
    const adapter = new InspectableLMStudioAdapter({ workerType: 'codex', model: 'qwen3-8b' });

    expect(adapter.responseFormatFor(createJob('plan', 'low'))).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'plan_result', strict: true },
    });
    expect(adapter.responseFormatFor(createJob('dev', 'low'))).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'dev_result', strict: true },
    });
  });
});
describe('LM Studio backend routing', () => {
  const router = new BackendRouter({
    enabled: true,
    routeWorkers: ['codex', 'claude_code'],
    allowedStages: ['plan', 'dev'],
    maxRisk: 'low',
    fallbackStages: ['plan'],
  });

  it('routes only low-risk plan/dev work to LM Studio and keeps acceptance external', () => {
    expect(router.route(createJob('plan', 'low'), 'codex', backend => backend === 'lmstudio')).toEqual({
      execution_backend: 'lmstudio',
    });
    expect(router.route(createJob('acceptance', 'low'), 'codex', () => true)).toEqual({
      execution_backend: 'external',
    });
    expect(router.route(createJob('dev', 'high'), 'codex', () => true)).toEqual({
      execution_backend: 'external',
    });
  });

  it('falls back to external only for plan when LM Studio is unavailable', () => {
    const route = router.route(createJob('plan', 'low'), 'codex', backend => backend === 'external');

    expect(route).toEqual({
      execution_backend: 'external',
      fallback_reason: 'lmstudio_adapter_unavailable',
    });
  });

  it('blocks dev rather than auto-retrying it through an external backend', () => {
    const route = router.route(createJob('dev', 'low'), 'codex', backend => backend === 'external');

    expect(route.execution_backend).toBe('lmstudio');
    expect(route.blocked_reason).toContain('WORKER_BACKEND_UNAVAILABLE');
  });
});
