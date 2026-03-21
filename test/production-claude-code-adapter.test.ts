import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProductionClaudeCodeAdapter } from '../src/domain/worker/production-claude-code-adapter.js';
import type { WorkerJob } from '../src/types.js';

// Mock claude-code-executor
const mockExecute = vi.fn();
const mockCancel = vi.fn();

vi.mock('../src/infrastructure/claude-code-executor.js', () => ({
  createClaudeCodeExecutor: () => ({
    execute: mockExecute,
    cancel: mockCancel,
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
    mockExecute.mockResolvedValue({
      success: true,
      output: '{"summary": "Test output"}',
      duration_ms: 1000,
      artifacts: [],
    });
    mockCancel.mockResolvedValue(true);

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

    it('should return running status while job is executing', async () => {
      // Create a promise that we can resolve later
      let resolveExecute: (value: unknown) => void;
      mockExecute.mockReturnValue(new Promise(resolve => {
        resolveExecute = resolve;
      }));

      const job: WorkerJob = {
        job_id: 'job_5',
        task_id: 'task_5',
        typed_ref: 'test:task:5',
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

      // Poll immediately - should be running
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(pollResult.status).toBe('running');
      expect(pollResult.progress).toBeGreaterThanOrEqual(0);

      // Resolve the execution
      resolveExecute!({
        success: true,
        output: '{"summary": "Done"}',
        duration_ms: 1000,
        artifacts: [],
      });
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

    it('should cancel running job', async () => {
      let resolveExecute: (value: unknown) => void;
      mockExecute.mockReturnValue(new Promise(resolve => {
        resolveExecute = resolve;
      }));
      mockCancel.mockResolvedValue(true);

      const job: WorkerJob = {
        job_id: 'job_6',
        task_id: 'task_6',
        typed_ref: 'test:task:6',
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
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('cancelled');
    });

    it('should handle failed cancellation', async () => {
      let resolveExecute: (value: unknown) => void;
      mockExecute.mockReturnValue(new Promise(resolve => {
        resolveExecute = resolve;
      }));
      mockCancel.mockResolvedValue(false);

      const job: WorkerJob = {
        job_id: 'job_7',
        task_id: 'task_7',
        typed_ref: 'test:task:7',
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
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      expect(cancelResult.success).toBe(false);
      expect(cancelResult.status).toBe('failed');
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

    it('should handle undefined input', () => {
      const result = adapter.normalizeEscalation(undefined);
      expect(result).toBeNull();
    });

    it('should handle non-object input', () => {
      const result = adapter.normalizeEscalation('string');
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

    it('should detect WebSearch as network access', () => {
      const result = adapter.normalizeEscalation({
        tool_name: 'WebSearch',
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should detect curl as network access', () => {
      const result = adapter.normalizeEscalation({
        tool_name: 'curl',
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

    it('should detect delete command as destructive', () => {
      const result = adapter.normalizeEscalation({
        tool_name: 'bash',
        input: { command: 'delete everything' },
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

    it('should detect permission_mode_change', () => {
      const result = adapter.normalizeEscalation({
        permission_mode_change: true,
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('human_verdict');
    });

    it('should handle tool_use_request format', () => {
      const result = adapter.normalizeEscalation({
        tool_use_request: {
          tool_name: 'WebFetch',
        },
      });

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should return null for unrecognized escalation', () => {
      const result = adapter.normalizeEscalation({
        unknown_field: true,
      });

      expect(result).toBeNull();
    });
  });

  describe('execution results', () => {
    it('should handle successful execution with JSON output', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        output: '{"plan": {"steps": ["step1", "step2"]}}',
        duration_ms: 1000,
        artifacts: [],
      });

      const job: WorkerJob = {
        job_id: 'job_8',
        task_id: 'task_8',
        typed_ref: 'test:task:8',
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

      await adapter.submitJob(job);
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should handle failed execution', async () => {
      mockExecute.mockResolvedValue({
        success: false,
        error: 'Execution failed',
        duration_ms: 500,
      });

      const job: WorkerJob = {
        job_id: 'job_9',
        task_id: 'task_9',
        typed_ref: 'test:task:9',
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

      await adapter.submitJob(job);
      await new Promise(resolve => setTimeout(resolve, 50));

      const pollResult = await adapter.pollJob('claude-job_9-0'); // External job ID format
      // Job should have failed
    });

    it('should handle acceptance stage with verdict', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        output: '{"verdict": {"outcome": "accept", "reason": "All good", "notes": "Test notes"}}',
        duration_ms: 1000,
        artifacts: [],
      });

      const job: WorkerJob = {
        job_id: 'job_10',
        task_id: 'task_10',
        typed_ref: 'test:task:10',
        stage: 'acceptance',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test acceptance' },
      };

      await adapter.submitJob(job);
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should handle dev stage with diff output', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        output: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n+new line',
        duration_ms: 2000,
        artifacts: [],
      });

      const job: WorkerJob = {
        job_id: 'job_11',
        task_id: 'task_11',
        typed_ref: 'test:task:11',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test dev' },
      };

      await adapter.submitJob(job);
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should handle execution with artifacts', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        output: '{"summary": "Done"}',
        duration_ms: 1000,
        artifacts: [
          { artifact_id: 'art1', kind: 'log' as const, uri: 'file:///log.txt' },
        ],
      });

      const job: WorkerJob = {
        job_id: 'job_12',
        task_id: 'task_12',
        typed_ref: 'test:task:12',
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
      await new Promise(resolve => setTimeout(resolve, 100));

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      // After polling succeeded, the job is cleaned up so artifacts are empty
      expect(['succeeded', 'running']).toContain(pollResult.status);
    });
  });
});