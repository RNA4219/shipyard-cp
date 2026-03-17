import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodexAdapter, type CodexAdapterConfig } from '../src/domain/worker/codex-adapter.js';
import type { WorkerJob } from '../src/types.js';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    const config: CodexAdapterConfig = {
      workerType: 'codex',
      model: 'gpt-4o',
      auth: {
        type: 'api_key',
        value: 'test-api-key',
      },
    };

    adapter = new CodexAdapter(config);
  });

  describe('constructor', () => {
    it('should create adapter with default model', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new CodexAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should accept custom model', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
        model: 'gpt-4-turbo',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new CodexAdapter(config);
      expect(adapter).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with API key', async () => {
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });

    it('should throw without API key', async () => {
      const noKeyAdapter = new CodexAdapter({
        workerType: 'codex',
      });
      await expect(noKeyAdapter.initialize()).rejects.toThrow('API key');
    });
  });

  describe('getCapabilities', () => {
    it('should return Codex capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('codex');
      expect(caps.capabilities).toContain('plan');
      expect(caps.capabilities).toContain('edit_repo');
      expect(caps.capabilities).toContain('run_tests');
      expect(caps.max_concurrent_jobs).toBe(10);
      expect(caps.metadata?.model).toBe('gpt-4o');
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
        worker_type: 'codex',
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
      expect(result.estimated_duration_ms).toBe(30000);
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
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const planResult = await adapter.submitJob({ ...baseJob, stage: 'plan' });
      expect(planResult.estimated_duration_ms).toBe(30000);

      const devResult = await adapter.submitJob({ ...baseJob, stage: 'dev' });
      expect(devResult.estimated_duration_ms).toBe(120000);

      const accResult = await adapter.submitJob({ ...baseJob, stage: 'acceptance' });
      expect(accResult.estimated_duration_ms).toBe(60000);
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
        worker_type: 'codex',
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
        worker_type: 'codex',
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
        worker_type: 'codex',
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
      expect(artifacts[0].kind).toBe('log');
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize Codex permission request', () => {
      const raw = {
        permission_request: {
          type: 'network',
          reason: 'Need to fetch dependencies',
          approved: false,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('Need to fetch dependencies');
    });

    it('should normalize destructive tool request', () => {
      const raw = {
        permission_request: {
          type: 'destructive',
          description: 'Delete temporary files',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('destructive_tool');
    });

    it('should normalize secret access request', () => {
      const raw = {
        permission_request: {
          type: 'secret',
          reason: 'Need API credentials',
          approved: true,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('secret_access');
      expect(result?.approved).toBe(true);
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
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(await adapter.isReady()).toBe(false);
    });
  });
});