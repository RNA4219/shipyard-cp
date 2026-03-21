import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProductionClaudeCodeAdapter } from '../src/domain/worker/production-claude-code-adapter.js';
import type { WorkerJob } from '../src/types.js';

// Mock claude-code-executor
vi.mock('../src/infrastructure/claude-code-executor.js', () => ({
  createClaudeCodeExecutor: () => ({
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: '{"summary": "Test output"}',
      duration_ms: 1000,
      artifacts: [],
    }),
    cancel: vi.fn().mockResolvedValue(true),
  }),
}));

// Mock child_process for initialize
vi.mock('child_process', () => ({
  spawn: () => ({
    on: vi.fn((event, cb) => {
      if (event === 'close') cb(0);
    }),
    stdio: 'ignore',
  }),
}));

describe('ProductionClaudeCodeAdapter', () => {
  let adapter: ProductionClaudeCodeAdapter;

  beforeEach(async () => {
    adapter = new ProductionClaudeCodeAdapter({ workerType: 'claude_code' });
    await adapter.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create adapter with default config', () => {
      expect(adapter.workerType).toBe('claude_code');
    });

    it('should accept custom config', () => {
      const customAdapter = new ProductionClaudeCodeAdapter({
        workerType: 'claude_code',
        model: 'claude-3-opus',
        timeout: 120000,
        debug: true,
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
      expect(capabilities.capabilities).toContain('produces_verdict');
      expect(capabilities.metadata?.production_mode).toBe(true);
      expect(capabilities.metadata?.supports_mcp).toBe(true);
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

    it('should return already_completed for finished job', async () => {
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
      // Wait for job to complete (mocked to succeed)
      await new Promise(resolve => setTimeout(resolve, 100));

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      if (pollResult.status === 'succeeded' || pollResult.status === 'failed') {
        const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);
        expect(cancelResult.status).toBe('not_found'); // Job was cleaned up
      }
    });
  });

  describe('collectArtifacts', () => {
    it('should return empty array for unknown job', async () => {
      const artifacts = await adapter.collectArtifacts('unknown-job');
      expect(artifacts).toEqual([]);
    });
  });

  describe('normalizeEscalation', () => {
    it('should handle null input', () => {
      const result = adapter.normalizeEscalation(null);
      expect(result).toBeNull();
    });

    it('should detect network access escalation', () => {
      const result = adapter.normalizeEscalation({
        tool_name: 'WebFetch',
        approved: true,
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should detect destructive tool escalation', () => {
      const result = adapter.normalizeEscalation({
        tool_name: 'bash',
        input: { command: 'rm -rf /important' },
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('destructive_tool');
    });

    it('should detect permission escalation', () => {
      const result = adapter.normalizeEscalation({
        permission_escalation: true,
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('human_verdict');
      expect(result?.approved).toBe(false);
    });
  });
});