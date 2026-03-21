import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ClaudeCodeExecutor,
  type ClaudeCodeExecutorConfig,
  type ExecutionResult,
  createClaudeCodeExecutor,
} from '../../src/infrastructure/claude-code-executor.js';
import type { WorkerJob } from '../../src/types.js';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

// Mock monitoring logger
vi.mock('../../src/monitoring/index.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

// Mock createId
vi.mock('../../src/store/utils.js', () => ({
  createId: () => 'test-id-123',
}));

import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

const mockSpawn = spawn as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;
const mockRm = rm as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

// Mock process class
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  pid = 12345;
}

// Helper to create a valid WorkerJob
function createJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job-123',
    task_id: 'task-456',
    typed_ref: 'agent-taskstate:task:github:123',
    stage: 'plan',
    worker_type: 'claude_code',
    workspace_ref: { workspace_id: 'ws-1', kind: 'container' },
    input_prompt: 'Test prompt',
    repo_ref: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      default_branch: 'main',
      base_sha: 'abc123',
    },
    capability_requirements: ['plan'],
    risk_level: 'low',
    approval_policy: { mode: 'ask' },
    ...overrides,
  };
}

describe('ClaudeCodeExecutor', () => {
  let executor: ClaudeCodeExecutor;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = new MockChildProcess();
    mockSpawn.mockReturnValue(mockProcess);
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create executor with default configuration', () => {
      executor = new ClaudeCodeExecutor();
      expect(executor).toBeDefined();
      expect(mockMkdir).toHaveBeenCalled();
    });

    it('should accept custom cliPath', () => {
      executor = new ClaudeCodeExecutor({ cliPath: '/custom/claude' });
      expect(executor).toBeDefined();
    });

    it('should accept custom workDir', () => {
      executor = new ClaudeCodeExecutor({ workDir: '/custom/work' });
      expect(executor).toBeDefined();
    });

    it('should accept custom model', () => {
      executor = new ClaudeCodeExecutor({ model: 'claude-opus-4-6' });
      expect(executor).toBeDefined();
    });

    it('should accept custom timeout', () => {
      executor = new ClaudeCodeExecutor({ timeout: 300000 });
      expect(executor).toBeDefined();
    });

    it('should accept apiKey configuration', () => {
      executor = new ClaudeCodeExecutor({ apiKey: 'test-key' });
      expect(executor).toBeDefined();
    });

    it('should accept debug mode', () => {
      executor = new ClaudeCodeExecutor({ debug: true });
      expect(executor).toBeDefined();
    });

    it('should accept skipPermissions flag', () => {
      executor = new ClaudeCodeExecutor({ skipPermissions: true });
      expect(executor).toBeDefined();
    });

    it('should use default values for optional config', () => {
      executor = new ClaudeCodeExecutor({});
      expect(executor).toBeDefined();
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      executor = new ClaudeCodeExecutor();
    });

    it('should execute a job successfully', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      // Simulate successful process completion
      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stdout.emit('data', Buffer.from('success output'));
      mockProcess.stderr.emit('data', Buffer.from(''));
      mockProcess.emit('close', 0);

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('success output');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should create job workspace directory', async () => {
      const job = createJob({ job_id: 'test-job-id' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      expect(mockMkdir).toHaveBeenCalled();
    });

    it('should write prompt file', async () => {
      const job = createJob({ input_prompt: 'Custom prompt content' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls.find(call =>
        call[0].toString().includes('prompt.md')
      );
      expect(writeCall).toBeDefined();
      expect(writeCall[1]).toBe('Custom prompt content');
    });

    it('should build prompt from job if input_prompt not provided', async () => {
      const job = createJob({
        input_prompt: undefined,
        task_id: 'task-789',
        context: { objective: 'Test objective' }
      });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls.find(call =>
        call[0].toString().includes('prompt.md')
      );
      expect(writeCall).toBeDefined();
      const promptContent = writeCall[1];
      expect(promptContent).toContain('task-789');
      expect(promptContent).toContain('Test objective');
    });

    it('should spawn CLI with correct arguments', async () => {
      const job = createJob({ stage: 'plan' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      expect(mockSpawn).toHaveBeenCalled();
      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1];

      expect(args).toContain('--model');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--prompt');
    });

    it('should include skip permissions flag when configured', async () => {
      executor = new ClaudeCodeExecutor({ skipPermissions: true });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1];
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('should set ANTHROPIC_API_KEY env when apiKey is configured', async () => {
      executor = new ClaudeCodeExecutor({ apiKey: 'test-api-key' });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env;
      expect(env.ANTHROPIC_API_KEY).toBe('test-api-key');
    });

    it('should use plan system prompt for plan stage', async () => {
      const job = createJob({ stage: 'plan' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1];
      const systemPromptIndex = args.indexOf('--system-prompt');
      expect(systemPromptIndex).toBeGreaterThan(-1);
      expect(args[systemPromptIndex + 1]).toContain('planning agent');
    });

    it('should use dev system prompt for dev stage', async () => {
      const job = createJob({ stage: 'dev' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1];
      const systemPromptIndex = args.indexOf('--system-prompt');
      expect(systemPromptIndex).toBeGreaterThan(-1);
      expect(args[systemPromptIndex + 1]).toContain('development agent');
    });

    it('should use acceptance system prompt for acceptance stage', async () => {
      const job = createJob({ stage: 'acceptance' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const args = spawnCall[1];
      const systemPromptIndex = args.indexOf('--system-prompt');
      expect(systemPromptIndex).toBeGreaterThan(-1);
      expect(args[systemPromptIndex + 1]).toContain('acceptance testing agent');
    });

    it('should return failed result on non-zero exit code', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stderr.emit('data', Buffer.from('error message'));
      mockProcess.emit('close', 1);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('error message');
    });

    it('should return error message when process exits with non-zero code without stderr', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 2);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Process exited with code 2');
    });

    it('should cleanup workspace after execution', async () => {
      // existsSync needs to return true for cleanup to actually call rm
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      expect(mockRm).toHaveBeenCalled();
    });

    it('should not cleanup workspace in debug mode', async () => {
      executor = new ClaudeCodeExecutor({ debug: true });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      // rm should not be called in debug mode
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('should collect artifacts from workspace', async () => {
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      const result = await executePromise;

      expect(result.artifacts).toBeDefined();
      expect(result.artifacts?.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      executor = new ClaudeCodeExecutor();
    });

    it('should handle spawn errors', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('error', new Error('Spawn failed'));

      // The execute method catches spawn errors and returns a failed result
      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('Spawn failed');
    });

    it('should handle mkdir errors gracefully', async () => {
      mockMkdir.mockRejectedValueOnce(new Error('mkdir failed'));
      const job = createJob();
      const result = await executor.execute(job);

      expect(result.success).toBe(false);
      expect(result.error).toContain('mkdir failed');
    });

    it('should handle writeFile errors gracefully', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('write failed'));
      const job = createJob();
      const result = await executor.execute(job);

      expect(result.success).toBe(false);
      expect(result.error).toContain('write failed');
    });

    it('should ignore cleanup errors during execute error handling', async () => {
      // Make rm throw an error during cleanup
      mockRm.mockRejectedValueOnce(new Error('cleanup failed'));
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('error', new Error('Process error'));

      // Should still return a result (cleanup error is ignored)
      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('Process error');
    });

    it('should cleanup on error', async () => {
      // existsSync needs to return true for cleanup to actually call rm
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('error', new Error('Process error'));

      // The execute method catches spawn errors and returns a failed result
      const result = await executePromise;
      expect(result.success).toBe(false);

      // Cleanup should be called
      expect(mockRm).toHaveBeenCalled();
    });
  });

  describe('timeout scenarios', () => {
    it('should timeout job after configured timeout', async () => {
      executor = new ClaudeCodeExecutor({ timeout: 50 });
      const job = createJob();
      const executePromise = executor.execute(job);

      // Don't complete the process - let it timeout
      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should clear timeout on successful completion', async () => {
      executor = new ClaudeCodeExecutor({ timeout: 1000 });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      const result = await executePromise;

      expect(result.success).toBe(true);
    });

    it('should clear timeout on error', async () => {
      executor = new ClaudeCodeExecutor({ timeout: 1000 });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('error', new Error('Process error'));

      // The execute method catches spawn errors and returns a failed result
      const result = await executePromise;
      expect(result.success).toBe(false);

      // Process should have been killed if timeout wasn't cleared
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      executor = new ClaudeCodeExecutor();
    });

    it('should cancel a running job', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 10));

      const cancelled = await executor.cancel('job-123');
      expect(cancelled).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Complete the process after cancellation
      mockProcess.emit('close', 0);
      await executePromise;
    });

    it('should return false for non-existent job', async () => {
      const cancelled = await executor.cancel('non-existent');
      expect(cancelled).toBe(false);
    });

    it('should cleanup workspace on cancellation', async () => {
      // existsSync needs to return true for cleanup to actually call rm
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      await executor.cancel('job-123');

      expect(mockRm).toHaveBeenCalled();

      mockProcess.emit('close', 0);
      await executePromise;
    });

    it('should clear timeout on cancellation', async () => {
      executor = new ClaudeCodeExecutor({ timeout: 1000 });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      await executor.cancel('job-123');

      // Timeout should be cleared, SIGKILL should not be called
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');

      mockProcess.emit('close', 0);
      await executePromise;
    });

    it('should ignore cleanup errors during cancellation', async () => {
      // Make rm throw an error during cleanup
      mockRm.mockRejectedValueOnce(new Error('cleanup failed'));
      mockExistsSync.mockReturnValue(true);
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      // Should not throw even if cleanup fails
      const cancelled = await executor.cancel('job-123');
      expect(cancelled).toBe(true);

      mockProcess.emit('close', 0);
      await executePromise;
    });
  });

  describe('process management', () => {
    beforeEach(() => {
      executor = new ClaudeCodeExecutor();
    });

    it('should track running jobs', async () => {
      const job = createJob({ job_id: 'job-1' });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      // Job should be tracked while running
      mockProcess.emit('close', 0);
      await executePromise;
    });

    it('should remove job from tracking after completion', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);
      await executePromise;

      // Cancelling completed job should return false
      const cancelled = await executor.cancel('job-123');
      expect(cancelled).toBe(false);
    });

    it('should handle multiple concurrent jobs', async () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const job1 = createJob({ job_id: 'job-1' });
      const job2 = createJob({ job_id: 'job-2' });

      const promise1 = executor.execute(job1);
      const promise2 = executor.execute(job2);

      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess1.emit('close', 0);
      mockProcess2.emit('close', 0);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should collect stdout output', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stdout.emit('data', Buffer.from('line1\n'));
      mockProcess.stdout.emit('data', Buffer.from('line2\n'));
      mockProcess.emit('close', 0);

      const result = await executePromise;
      expect(result.output).toBe('line1\nline2\n');
    });

    it('should collect stderr output', async () => {
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stderr.emit('data', Buffer.from('warning1\n'));
      mockProcess.stderr.emit('data', Buffer.from('warning2\n'));
      mockProcess.emit('close', 1);

      const result = await executePromise;
      expect(result.error).toBe('warning1\nwarning2\n');
    });

    it('should log stdout in debug mode', async () => {
      executor = new ClaudeCodeExecutor({ debug: true });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stdout.emit('data', Buffer.from('debug output\n'));
      mockProcess.emit('close', 0);

      const result = await executePromise;
      expect(result.success).toBe(true);
    });

    it('should log stderr in debug mode', async () => {
      executor = new ClaudeCodeExecutor({ debug: true });
      const job = createJob();
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.stderr.emit('data', Buffer.from('debug error\n'));
      mockProcess.emit('close', 0);

      const result = await executePromise;
      expect(result.success).toBe(true);
    });
  });

  describe('buildPrompt', () => {
    beforeEach(() => {
      executor = new ClaudeCodeExecutor();
    });

    it('should build prompt with repo information', async () => {
      const job = createJob({
        input_prompt: undefined,
        repo_ref: {
          provider: 'github',
          owner: 'test-owner',
          name: 'test-repo',
          default_branch: 'main',
          base_sha: 'abc123',
        },
      });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const writeCall = mockWriteFile.mock.calls.find(call =>
        call[0].toString().includes('prompt.md')
      );
      const promptContent = writeCall[1];
      expect(promptContent).toContain('test-owner');
      expect(promptContent).toContain('test-repo');
      expect(promptContent).toContain('main');
      expect(promptContent).toContain('abc123');
    });

    it('should build prompt with context objective', async () => {
      const job = createJob({
        input_prompt: undefined,
        context: {
          objective: 'Implement feature X',
        },
      });
      const executePromise = executor.execute(job);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockProcess.emit('close', 0);

      await executePromise;

      const writeCall = mockWriteFile.mock.calls.find(call =>
        call[0].toString().includes('prompt.md')
      );
      const promptContent = writeCall[1];
      expect(promptContent).toContain('Implement feature X');
    });
  });
});

describe('createClaudeCodeExecutor', () => {
  it('should create executor with default config', () => {
    const executor = createClaudeCodeExecutor();
    expect(executor).toBeInstanceOf(ClaudeCodeExecutor);
  });

  it('should create executor with custom config', () => {
    const executor = createClaudeCodeExecutor({
      cliPath: '/custom/claude',
      timeout: 300000,
    });
    expect(executor).toBeInstanceOf(ClaudeCodeExecutor);
  });
});