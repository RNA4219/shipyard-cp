import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AntigravityAdapter, type AntigravityAdapterConfig } from '../src/domain/worker/antigravity-adapter.js';
import type { WorkerJob } from '../src/types.js';

describe('AntigravityAdapter', () => {
  let adapter: AntigravityAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    const config: AntigravityAdapterConfig = {
      workerType: 'google_antigravity',
      model: 'gemini-2.0-flash',
      projectId: 'test-project',
      auth: {
        type: 'api_key',
        value: 'test-api-key',
      },
    };

    adapter = new AntigravityAdapter(config);
  });

  describe('constructor', () => {
    it('should create adapter with default model', () => {
      const config: AntigravityAdapterConfig = {
        workerType: 'google_antigravity',
      };
      const adapter = new AntigravityAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should accept custom model and region', () => {
      const config: AntigravityAdapterConfig = {
        workerType: 'google_antigravity',
        model: 'gemini-1.5-pro',
        region: 'asia-northeast1',
      };
      const adapter = new AntigravityAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should read environment variables for configuration', () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
      process.env.GOOGLE_API_KEY = 'env-api-key';

      const config: AntigravityAdapterConfig = {
        workerType: 'google_antigravity',
      };
      const adapter = new AntigravityAdapter(config);
      expect(adapter).toBeDefined();

      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_API_KEY;
    });
  });

  describe('initialize', () => {
    it('should initialize with API key', async () => {
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });

    it('should warn without credentials but not throw', async () => {
      const noKeyAdapter = new AntigravityAdapter({
        workerType: 'google_antigravity',
      });
      // Should not throw, just warn
      await noKeyAdapter.initialize();
      expect(await noKeyAdapter.isReady()).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return Antigravity capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('google_antigravity');
      expect(caps.capabilities).toContain('plan');
      expect(caps.capabilities).toContain('edit_repo');
      expect(caps.capabilities).toContain('run_tests');
      expect(caps.capabilities).toContain('produces_patch');
      expect(caps.capabilities).toContain('produces_verdict');
      expect(caps.max_concurrent_jobs).toBe(8);
      expect(caps.metadata?.model).toBe('gemini-2.0-flash');
      expect(caps.metadata?.provider).toBe('google');
    });
  });

  describe('submitJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should submit valid job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'google_antigravity',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Create a plan for feature X',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
      expect(result.estimated_duration_ms).toBe(35000);
    });

    it('should reject invalid job', async () => {
      const job = {} as WorkerJob;
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
    });

    it('should estimate duration based on stage', async () => {
      const baseJob: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'google_antigravity',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const planResult = await adapter.submitJob({ ...baseJob, stage: 'plan' });
      expect(planResult.estimated_duration_ms).toBe(35000);

      const devResult = await adapter.submitJob({ ...baseJob, stage: 'dev' });
      expect(devResult.estimated_duration_ms).toBe(150000);

      const accResult = await adapter.submitJob({ ...baseJob, stage: 'acceptance' });
      expect(accResult.estimated_duration_ms).toBe(75000);
    });
  });

  describe('pollJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return failed for non-existent job', async () => {
      const result = await adapter.pollJob('non-existent');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Job not found');
    });

    it('should return running status for new job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'google_antigravity',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.status).toBe('running');
      expect(pollResult.progress).toBeGreaterThanOrEqual(0);
      expect(pollResult.progress).toBeLessThan(100);
    });
  });

  describe('cancelJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should cancel existing job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'google_antigravity',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('cancelled');
    });

    it('should return not_found for non-existent job', async () => {
      const result = await adapter.cancelJob('non-existent');
      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });
  });

  describe('collectArtifacts', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return empty array for non-existent job', async () => {
      const artifacts = await adapter.collectArtifacts('non-existent');
      expect(artifacts).toHaveLength(0);
    });

    it('should collect artifacts from completed job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'google_antigravity',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const artifacts = await adapter.collectArtifacts(submitResult.external_job_id!);

      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.some(a => a.kind === 'log')).toBe(true);
      expect(artifacts.some(a => a.kind === 'trace')).toBe(true);
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize Antigravity action_request', () => {
      const raw = {
        action_request: {
          type: 'network',
          description: 'Need to fetch external dependencies',
          approved: false,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('Need to fetch external dependencies');
    });

    it('should normalize destructive action_request', () => {
      const raw = {
        action_request: {
          type: 'destructive',
          description: 'Delete temporary files',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('destructive_tool');
    });

    it('should normalize secret action_request', () => {
      const raw = {
        action_request: {
          type: 'secret',
          description: 'Access API credentials',
          approved: true,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('secret_access');
      expect(result?.approved).toBe(true);
    });

    it('should normalize GCP permission_request for secrets', () => {
      const raw = {
        permission_request: {
          permission: 'secretmanager.versions.access',
          reason: 'Need database password',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('secret_access');
    });

    it('should normalize GCP permission_request for destructive actions', () => {
      const raw = {
        permission_request: {
          permission: 'compute.instances.delete',
          reason: 'Cleanup test instance',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('destructive_tool');
    });

    it('should normalize approval action_request', () => {
      const raw = {
        action_request: {
          type: 'approval',
          description: 'Human review required',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('human_verdict');
    });

    it('should fall back to default for unknown format', () => {
      const raw = {
        kind: 'network_access',
        reason: 'Test',
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should return null for invalid input', () => {
      expect(adapter.normalizeEscalation(null)).toBeNull();
      expect(adapter.normalizeEscalation(undefined)).toBeNull();
      expect(adapter.normalizeEscalation('string')).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(await adapter.isReady()).toBe(false);
    });
  });
});