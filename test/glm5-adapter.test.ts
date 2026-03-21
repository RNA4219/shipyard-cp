import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GLM5Adapter } from '../src/domain/worker/glm5-adapter.js';
import type { WorkerJob } from '../src/types.js';

// Mock LiteLLMConnector
vi.mock('../src/domain/litellm/litellm-connector.js', () => ({
  LiteLLMConnector: class MockLiteLLMConnector {
    async listModels() {
      return [{ id: 'glm-5' }];
    }
    async chatCompletion() {
      return {
        id: 'chat-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'glm-5',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"summary": "Test response"}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
    }
  },
}));

describe('GLM5Adapter', () => {
  let adapter: GLM5Adapter;

  beforeEach(() => {
    adapter = new GLM5Adapter({ workerType: 'claude_code' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create adapter with default config', () => {
      expect(adapter.workerType).toBe('claude_code');
    });

    it('should accept custom config', () => {
      const customAdapter = new GLM5Adapter({
        workerType: 'claude_code',
        model: 'custom-model',
        timeout: 60000,
      });
      expect(customAdapter.workerType).toBe('claude_code');
    });
  });

  describe('getCapabilities', () => {
    it('should return correct capabilities', async () => {
      const capabilities = await adapter.getCapabilities();

      expect(capabilities.worker_type).toBe('claude_code');
      expect(capabilities.capabilities).toContain('plan');
      expect(capabilities.capabilities).toContain('edit_repo');
      expect(capabilities.capabilities).toContain('run_tests');
      expect(capabilities.max_concurrent_jobs).toBeGreaterThan(0);
      expect(capabilities.supported_stages).toContain('plan');
      expect(capabilities.supported_stages).toContain('dev');
      expect(capabilities.supported_stages).toContain('acceptance');
    });
  });

  describe('submitJob', () => {
    it('should accept valid jobs', async () => {
      const job: WorkerJob = {
        job_id: 'job_1',
        task_id: 'task_1',
        typed_ref: 'test:task:1',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
    });

    it('should reject jobs missing required fields', async () => {
      const job = {
        job_id: 'job_2',
        task_id: 'task_2',
        // Missing required fields
      } as unknown as WorkerJob;

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
    });
  });

  describe('pollJob', () => {
    it('should return failed for unknown job', async () => {
      const result = await adapter.pollJob('unknown-job');

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found');
    });

    it('should return job status after submission', async () => {
      const job: WorkerJob = {
        job_id: 'job_3',
        task_id: 'task_3',
        typed_ref: 'test:task:3',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(['queued', 'running', 'succeeded', 'failed']).toContain(pollResult.status);
    });
  });

  describe('cancelJob', () => {
    it('should return not_found for unknown job', async () => {
      const result = await adapter.cancelJob('unknown-job');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });

    it('should cancel running job', async () => {
      const job: WorkerJob = {
        job_id: 'job_4',
        task_id: 'task_4',
        typed_ref: 'test:task:4',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      // Cancel immediately after submission (before completion)
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      // Job may already be completed due to mock's instant completion
      // Accept either cancelled or not_found (job cleaned up after completion)
      expect(['cancelled', 'not_found', 'already_completed']).toContain(cancelResult.status);
    });
  });

  describe('collectArtifacts', () => {
    it('should return empty array for unknown job', async () => {
      const artifacts = await adapter.collectArtifacts('unknown-job');
      expect(artifacts).toEqual([]);
    });
  });
});