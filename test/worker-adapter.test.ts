import { describe, it, expect, beforeEach } from 'vitest';
import {
  BaseWorkerAdapter,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
  type WorkerJob,
} from '../src/domain/worker/worker-adapter.js';
import type { WorkerType } from '../src/types.js';

// Interface for testing protected methods
interface TestAdapterInternals {
  buildPrompt(job: WorkerJob): string;
  validateJob(job: WorkerJob): { valid: boolean; errors: string[] };
}

// Test adapter implementation
class TestWorkerAdapter extends BaseWorkerAdapter {
  readonly workerType: WorkerType = 'codex';

  constructor(config: WorkerAdapterConfig) {
    super(config);
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: this.workerType,
      capabilities: ['plan', 'edit_repo', 'run_tests'],
      max_concurrent_jobs: 5,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0',
    };
  }

  async submitJob(job: WorkerJob): Promise<JobSubmissionResult> {
    const validation = this.validateJob(job);
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        error: validation.errors.join(', '),
      };
    }
    return {
      success: true,
      external_job_id: `ext-${job.job_id}`,
      status: 'queued',
    };
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    return {
      external_job_id: externalJobId,
      status: 'running',
      progress: 50,
    };
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    return {
      success: true,
      status: 'cancelled',
    };
  }

  async collectArtifacts(externalJobId: string) {
    return [];
  }
}

describe('WorkerAdapter', () => {
  let adapter: TestWorkerAdapter;

  beforeEach(() => {
    adapter = new TestWorkerAdapter({
      workerType: 'codex',
      endpoint: 'http://localhost:8080',
    });
  });

  describe('initialize / shutdown', () => {
    it('should initialize adapter', async () => {
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });

    it('should shutdown adapter', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(await adapter.isReady()).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('should return worker capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('codex');
      expect(caps.capabilities).toContain('plan');
      expect(caps.max_concurrent_jobs).toBe(5);
      expect(caps.version).toBe('1.0.0');
    });
  });

  describe('submitJob', () => {
    it('should submit valid job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'plan',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test prompt',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBe('ext-job_123');
      expect(result.status).toBe('queued');
    });

    it('should reject invalid job', async () => {
      const job = {} as WorkerJob;

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toBeDefined();
    });
  });

  describe('pollJob', () => {
    it('should poll job status', async () => {
      const result = await adapter.pollJob('ext-job_123');

      expect(result.external_job_id).toBe('ext-job_123');
      expect(result.status).toBe('running');
    });
  });

  describe('cancelJob', () => {
    it('should cancel job', async () => {
      const result = await adapter.cancelJob('ext-job_123');

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize valid escalation', () => {
      const raw = {
        kind: 'network_access',
        reason: 'Need to fetch dependencies',
        approved: false,
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('Need to fetch dependencies');
    });

    it('should return null for invalid escalation', () => {
      const result = adapter.normalizeEscalation(null);
      expect(result).toBeNull();
    });

    it('should return null for invalid kind', () => {
      const raw = {
        kind: 'invalid_kind',
        reason: 'Test',
      };

      const result = adapter.normalizeEscalation(raw);
      expect(result).toBeNull();
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt from job', () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'agent-taskstate:task:github:123',
        stage: 'dev',
        worker_type: 'codex',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: '',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['edit_repo'],
        risk_level: 'medium',
        approval_policy: { mode: 'ask' },
        context: {
          objective: 'Implement feature X',
          acceptance_criteria: ['Tests pass', 'Code reviewed'],
          constraints: ['No breaking changes'],
        },
      };

      const prompt = (adapter as TestAdapterInternals).buildPrompt(job);

      expect(prompt).toContain('# Task: task_123');
      expect(prompt).toContain('## Stage: dev');
      expect(prompt).toContain('### Objective');
      expect(prompt).toContain('Implement feature X');
      expect(prompt).toContain('### Acceptance Criteria');
      expect(prompt).toContain('Tests pass');
      expect(prompt).toContain('### Constraints');
      expect(prompt).toContain('No breaking changes');
    });
  });

  describe('validateJob', () => {
    it('should validate complete job', () => {
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

      const result = (adapter as TestAdapterInternals).validateJob(job);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing job_id', () => {
      const job = { task_id: 'task_123' } as WorkerJob;
      const result = (adapter as TestAdapterInternals).validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('job_id is required');
    });

    it('should detect missing repo_ref', () => {
      const job = {
        job_id: 'job_123',
        task_id: 'task_123',
      } as WorkerJob;
      const result = (adapter as TestAdapterInternals).validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('repo_ref with owner and name is required');
    });

    it('should require input_prompt or context', () => {
      const job = {
        job_id: 'job_123',
        task_id: 'task_123',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
      } as WorkerJob;
      const result = (adapter as TestAdapterInternals).validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('either input_prompt or context is required');
    });
  });
});

describe('WorkerAdapterConfig', () => {
  it('should accept minimal config', () => {
    const config: WorkerAdapterConfig = {
      workerType: 'codex',
    };
    expect(config.workerType).toBe('codex');
  });

  it('should accept full config', () => {
    const config: WorkerAdapterConfig = {
      workerType: 'claude_code',
      endpoint: 'http://localhost:8080',
      auth: {
        type: 'api_key',
        value: 'test-key',
      },
      timeouts: {
        submit_ms: 5000,
        poll_ms: 1000,
        cancel_ms: 3000,
      },
      retry: {
        max_retries: 3,
        backoff_ms: 100,
      },
    };

    expect(config.workerType).toBe('claude_code');
    expect(config.auth?.type).toBe('api_key');
    expect(config.timeouts?.submit_ms).toBe(5000);
  });
});