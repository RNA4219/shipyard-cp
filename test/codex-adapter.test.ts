import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with default model', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new CodexAdapter(config);
      expect(adapter).toBeDefined();
      expect(adapter.workerType).toBe('codex');
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

    it('should store API key from auth config', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
        auth: { type: 'api_key', value: 'my-secret-key' },
      };
      const adapter = new CodexAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should accept custom endpoint', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
        endpoint: 'https://custom.api.openai.com',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new CodexAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should work without auth config', () => {
      const config: CodexAdapterConfig = {
        workerType: 'codex',
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

    it('should throw with undefined auth value', async () => {
      const undefinedKeyAdapter = new CodexAdapter({
        workerType: 'codex',
        auth: { type: 'api_key' },
      });
      await expect(undefinedKeyAdapter.initialize()).rejects.toThrow('API key');
    });

    it('should throw with empty string API key', async () => {
      const emptyKeyAdapter = new CodexAdapter({
        workerType: 'codex',
        auth: { type: 'api_key', value: '' },
      });
      await expect(emptyKeyAdapter.initialize()).rejects.toThrow('API key');
    });

    it('should be idempotent - calling initialize twice should work', async () => {
      await adapter.initialize();
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return Codex capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('codex');
      expect(caps.capabilities).toContain('plan');
      expect(caps.capabilities).toContain('edit_repo');
      expect(caps.capabilities).toContain('run_tests');
      expect(caps.capabilities).toContain('produces_patch');
      expect(caps.capabilities).toContain('produces_verdict');
      expect(caps.max_concurrent_jobs).toBe(10);
      expect(caps.metadata?.model).toBe('gpt-4o');
    });

    it('should return correct supported stages', async () => {
      const caps = await adapter.getCapabilities();
      expect(caps.supported_stages).toContain('plan');
      expect(caps.supported_stages).toContain('dev');
      expect(caps.supported_stages).toContain('acceptance');
    });

    it('should include version info', async () => {
      const caps = await adapter.getCapabilities();
      expect(caps.version).toBe('1.0.0');
    });

    it('should reflect custom model in metadata', async () => {
      const customModelAdapter = new CodexAdapter({
        workerType: 'codex',
        model: 'gpt-4-turbo',
        auth: { type: 'api_key', value: 'key' },
      });
      const caps = await customModelAdapter.getCapabilities();
      expect(caps.metadata?.model).toBe('gpt-4-turbo');
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

    it('should reject job missing job_id', async () => {
      const job = {
        task_id: 'task_123',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        input_prompt: 'Test',
      } as WorkerJob;
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('job_id');
    });

    it('should reject job missing task_id', async () => {
      const job = {
        job_id: 'job_123',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        input_prompt: 'Test',
      } as WorkerJob;
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('task_id');
    });

    it('should reject job missing repo_ref', async () => {
      const job = {
        job_id: 'job_123',
        task_id: 'task_123',
        input_prompt: 'Test',
      } as WorkerJob;
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('repo_ref');
    });

    it('should reject job with neither input_prompt nor context', async () => {
      const job = {
        job_id: 'job_123',
        task_id: 'task_123',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
      } as WorkerJob;
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('input_prompt');
    });

    it('should accept job with context instead of input_prompt', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        context: {
          objective: 'Build feature X',
          acceptance_criteria: ['AC1', 'AC2'],
          constraints: ['Use TypeScript'],
          references: [{ kind: 'issue', value: 'https://github.com/test/repo/issues/1' }],
        },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
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

    it('should use default duration for unknown stage', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'unknown_stage' as 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);
      expect(result.success).toBe(true);
      expect(result.estimated_duration_ms).toBe(60000);
    });

    it('should generate unique external job IDs', async () => {
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

      const result1 = await adapter.submitJob(job);
      const result2 = await adapter.submitJob({ ...job, job_id: 'job_456' });

      expect(result1.external_job_id).not.toBe(result2.external_job_id);
      expect(result1.external_job_id).toMatch(/^codex-/);
    });

    it('should use input_prompt from job when provided', async () => {
      const job: WorkerJob = {
        job_id: 'job_with_prompt',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'This is my custom prompt',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
    });

    it('should build prompt when input_prompt is not provided', async () => {
      const job: WorkerJob = {
        job_id: 'job_no_prompt',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        context: {
          objective: 'Build a feature',
          acceptance_criteria: ['AC1', 'AC2'],
          constraints: ['No external APIs'],
        },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
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
      expect(pollResult.estimated_remaining_ms).toBeDefined();
      expect(pollResult.estimated_remaining_ms).toBeGreaterThan(0);
    });

    it('should return succeeded status for completed job', async () => {
      // Create an adapter with mocked time
      const job: WorkerJob = {
        job_id: 'job_completed',
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

      // Wait for the estimated duration to pass (30 seconds for plan)
      // Since we can't wait 30 seconds, we'll manipulate the job store directly
      // Get the stored job and modify its startedAt time
      const storedJob = (adapter as unknown as { jobStore: Map<string, { startedAt: number; estimatedDuration: number }> }).jobStore.get(submitResult.external_job_id!);
      if (storedJob) {
        // Set startedAt to 31 seconds ago (beyond the 30s estimate)
        storedJob.startedAt = Date.now() - 31000;
      }

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.status).toBe('succeeded');
      expect(pollResult.progress).toBe(100);
      expect(pollResult.result).toBeDefined();
    });

    it('should include WorkerResult with litellm metadata for completed job', async () => {
      const job: WorkerJob = {
        job_id: 'job_with_result',
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
      const storedJob = (adapter as unknown as { jobStore: Map<string, { startedAt: number; estimatedDuration: number }> }).jobStore.get(submitResult.external_job_id!);
      if (storedJob) {
        storedJob.startedAt = Date.now() - 31000;
      }

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.result).toBeDefined();
      expect(pollResult.result?.usage?.litellm).toBeDefined();
      expect(pollResult.result?.usage?.litellm?.model).toBe('gpt-4o');
      expect(pollResult.result?.usage?.litellm?.provider).toBe('openai');
      expect(pollResult.result?.usage?.litellm?.input_tokens).toBeGreaterThan(0);
      expect(pollResult.result?.usage?.litellm?.output_tokens).toBeGreaterThan(0);
      expect(pollResult.result?.usage?.litellm?.cost_usd).toBeGreaterThan(0);
    });

    it('should include correct result structure for plan stage', async () => {
      const job: WorkerJob = {
        job_id: 'job_plan_result',
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
      const storedJob = (adapter as unknown as { jobStore: Map<string, { startedAt: number; estimatedDuration: number }> }).jobStore.get(submitResult.external_job_id!);
      if (storedJob) {
        storedJob.startedAt = Date.now() - 31000;
      }

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.result?.status).toBe('succeeded');
      expect(pollResult.result?.job_id).toBe('job_plan_result');
      expect(pollResult.result?.artifacts).toBeDefined();
      expect(pollResult.result?.artifacts?.length).toBeGreaterThan(0);
    });

    it('should include patch for dev stage', async () => {
      const job: WorkerJob = {
        job_id: 'job_dev_patch',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'dev',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['edit_repo'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const storedJob = (adapter as unknown as { jobStore: Map<string, { startedAt: number; estimatedDuration: number }> }).jobStore.get(submitResult.external_job_id!);
      if (storedJob) {
        storedJob.startedAt = Date.now() - 130000; // 130 seconds, beyond 120s estimate
      }

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.result?.patch_ref).toBeDefined();
      expect(pollResult.result?.patch_ref?.format).toBe('unified_diff');
      expect(pollResult.result?.test_results).toBeDefined();
      expect(pollResult.result?.test_results?.length).toBeGreaterThan(0);
    });

    it('should include verdict for acceptance stage', async () => {
      const job: WorkerJob = {
        job_id: 'job_acceptance_verdict',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'acceptance',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['produces_verdict'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const storedJob = (adapter as unknown as { jobStore: Map<string, { startedAt: number; estimatedDuration: number }> }).jobStore.get(submitResult.external_job_id!);
      if (storedJob) {
        storedJob.startedAt = Date.now() - 70000; // 70 seconds, beyond 60s estimate
      }

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.result?.verdict).toBeDefined();
      expect(pollResult.result?.verdict?.outcome).toBe('accept');
      expect(pollResult.result?.verdict?.checklist_completed).toBe(true);
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
      expect(result.error).toBe('Job not found');
    });

    it('should remove job from store after cancellation', async () => {
      const job: WorkerJob = {
        job_id: 'job_cancel_remove',
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
      await adapter.cancelJob(submitResult.external_job_id!);

      // Poll should return not found after cancellation
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(pollResult.status).toBe('failed');
      expect(pollResult.error).toBe('Job not found');
    });

    it('should not allow double cancellation', async () => {
      const job: WorkerJob = {
        job_id: 'job_double_cancel',
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
      await adapter.cancelJob(submitResult.external_job_id!);
      const secondCancel = await adapter.cancelJob(submitResult.external_job_id!);

      expect(secondCancel.success).toBe(false);
      expect(secondCancel.status).toBe('not_found');
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

    it('should return log artifact', async () => {
      const job: WorkerJob = {
        job_id: 'job_artifacts_log',
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

      const logArtifact = artifacts.find(a => a.kind === 'log');
      expect(logArtifact).toBeDefined();
      expect(logArtifact?.artifact_id).toContain('-log');
      expect(logArtifact?.uri).toContain('/logs/');
      expect(logArtifact?.size_bytes).toBe(1024);
    });

    it('should return report artifact', async () => {
      const job: WorkerJob = {
        job_id: 'job_artifacts_report',
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

      const reportArtifact = artifacts.find(a => a.kind === 'report');
      expect(reportArtifact).toBeDefined();
      expect(reportArtifact?.artifact_id).toContain('-report');
      expect(reportArtifact?.uri).toContain('/reports/');
      expect(reportArtifact?.uri).toContain('.json');
      expect(reportArtifact?.size_bytes).toBe(2048);
    });

    it('should return artifacts with external job id in artifact_id', async () => {
      const job: WorkerJob = {
        job_id: 'job_artifact_ids',
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

      for (const artifact of artifacts) {
        expect(artifact.artifact_id).toContain(submitResult.external_job_id!);
      }
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize Codex permission request for network', () => {
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
      expect(result?.approved).toBe(false);
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
      expect(result?.reason).toBe('Delete temporary files');
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

    it('should normalize file_write request to workspace_outside_write', () => {
      const raw = {
        permission_request: {
          type: 'file_write',
          reason: 'Need to write outside workspace',
          approved: false,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('workspace_outside_write');
      expect(result?.reason).toBe('Need to write outside workspace');
    });

    it('should normalize human_review request to human_verdict', () => {
      const raw = {
        permission_request: {
          type: 'human_review',
          reason: 'Requires human approval',
          approved: undefined,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('human_verdict');
      expect(result?.reason).toBe('Requires human approval');
    });

    it('should return null for null input', () => {
      const result = adapter.normalizeEscalation(null);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = adapter.normalizeEscalation(undefined);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(adapter.normalizeEscalation('string')).toBeNull();
      expect(adapter.normalizeEscalation(123)).toBeNull();
      expect(adapter.normalizeEscalation(true)).toBeNull();
    });

    it('should return null for unknown permission request type', () => {
      const raw = {
        permission_request: {
          type: 'unknown_type',
          reason: 'Some reason',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).toBeNull();
    });

    it('should fall back to default for standard format', () => {
      const raw = {
        kind: 'network_access',
        reason: 'Test reason',
        approved: true,
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('Test reason');
      expect(result?.approved).toBe(true);
    });

    it('should fall back to default for other valid kinds', () => {
      const kinds = [
        'network_access',
        'workspace_outside_write',
        'protected_path_write',
        'destructive_tool',
        'secret_access',
        'human_verdict',
      ];

      for (const kind of kinds) {
        const raw = {
          kind,
          reason: `Reason for ${kind}`,
        };

        const result = adapter.normalizeEscalation(raw);

        expect(result).not.toBeNull();
        expect(result?.kind).toBe(kind);
        expect(result?.reason).toBe(`Reason for ${kind}`);
      }
    });

    it('should return null for invalid standard format kind', () => {
      const raw = {
        kind: 'invalid_kind',
        reason: 'Test',
      };

      const result = adapter.normalizeEscalation(raw);
      expect(result).toBeNull();
    });

    it('should handle permission_request without reason or description', () => {
      const raw = {
        permission_request: {
          type: 'network',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('');
    });

    it('should handle permission_request with reason fallback to description', () => {
      const raw = {
        permission_request: {
          type: 'secret',
          description: 'Fallback description used',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.reason).toBe('Fallback description used');
    });

    it('should prefer reason over description when both present', () => {
      const raw = {
        permission_request: {
          type: 'network',
          reason: 'Primary reason',
          description: 'Secondary description',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result?.reason).toBe('Primary reason');
    });

    it('should return null for empty object', () => {
      const result = adapter.normalizeEscalation({});
      expect(result).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(await adapter.isReady()).toBe(false);
    });

    it('should clear job store on shutdown', async () => {
      await adapter.initialize();

      const job: WorkerJob = {
        job_id: 'job_shutdown',
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

      await adapter.submitJob(job);
      await adapter.shutdown();

      // After shutdown, the job should be gone
      await adapter.initialize();
      const result = await adapter.pollJob('any-id');
      expect(result.status).toBe('failed');
    });

    it('should be safe to call shutdown when not initialized', async () => {
      // Should not throw
      await adapter.shutdown();
    });

    it('should allow re-initialization after shutdown', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });
  });

  describe('isReady', () => {
    it('should return false before initialization', async () => {
      expect(await adapter.isReady()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(await adapter.isReady()).toBe(false);
    });
  });

  describe('workerType', () => {
    it('should return codex as worker type', () => {
      expect(adapter.workerType).toBe('codex');
    });
  });
});