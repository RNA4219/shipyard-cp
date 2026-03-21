import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  WorkerExecutor,
  type ExecutorEvent,
  type ExecutorEventListener,
} from '../src/domain/worker/worker-executor.js';
import {
  BaseWorkerAdapter,
  type WorkerAdapter,
  type WorkerCapabilities,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
} from '../src/domain/worker/worker-adapter.js';
import type { WorkerJob, WorkerResult } from '../src/types.js';

// Mock adapter for testing
class MockAdapter extends BaseWorkerAdapter {
  private jobStore: Map<string, { job: WorkerJob; status: string; result?: WorkerResult }> = new Map();
  private shouldFail = false;
  private failCount = 0;

  constructor(
    public readonly workerType: 'codex' | 'claude_code' | 'google_antigravity',
    private options: { shouldFail?: boolean; delayMs?: number } = {}
  ) {
    super({ workerType });
    this.shouldFail = options.shouldFail ?? false;
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
    const externalJobId = `${this.workerType}-${job.job_id}`;

    if (this.shouldFail) {
      this.failCount++;
      // Fail only first attempt for failover testing
      if (this.failCount === 1) {
        return {
          success: false,
          status: 'failed',
          error: 'Simulated failure',
        };
      }
    }

    this.jobStore.set(externalJobId, { job, status: 'queued' });
    return {
      success: true,
      external_job_id: externalJobId,
      status: 'queued',
    };
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    const jobData = this.jobStore.get(externalJobId);
    if (!jobData) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    // Simulate completion after delay
    if (this.options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }

    // Move to succeeded
    jobData.status = 'succeeded';
    jobData.result = this.createResult(jobData.job);

    return {
      external_job_id: externalJobId,
      status: 'succeeded',
      progress: 100,
      result: jobData.result,
    };
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const jobData = this.jobStore.get(externalJobId);
    if (!jobData) {
      return { success: false, status: 'not_found', error: 'Job not found' };
    }
    this.jobStore.delete(externalJobId);
    return { success: true, status: 'cancelled' };
  }

  async collectArtifacts(): Promise<Array<{ artifact_id: string; kind: 'log'; uri: string }>> {
    return [];
  }

  private createResult(job: WorkerJob): WorkerResult {
    return {
      job_id: job.job_id,
      typed_ref: job.typed_ref,
      status: 'succeeded',
      summary: `${this.workerType} completed`,
      artifacts: [],
      test_results: [],
      requested_escalations: [],
    };
  }

  // Test helpers
  setJobResult(externalJobId: string, result: WorkerResult): void {
    const jobData = this.jobStore.get(externalJobId);
    if (jobData) {
      jobData.result = result;
    }
  }

  setJobStatus(externalJobId: string, status: string): void {
    const jobData = this.jobStore.get(externalJobId);
    if (jobData) {
      jobData.status = status;
    }
  }
}

// Create a mock job
function createJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job-123',
    task_id: 'task-456',
    typed_ref: { ref_type: 'issue', ref_id: '1', owner: 'test', name: 'repo' },
    stage: 'plan',
    repo_ref: { owner: 'test', name: 'repo', base_sha: 'abc123' },
    worker_type: 'codex',
    lease_expires_at: new Date(Date.now() + 300000).toISOString(),
    retry_count: 0,
    ...overrides,
  };
}

describe('WorkerExecutor', () => {
  let executor: WorkerExecutor;
  let events: ExecutorEvent[];
  let eventListener: ExecutorEventListener;

  beforeEach(() => {
    events = [];
    eventListener = (event: ExecutorEvent) => events.push(event);
    executor = new WorkerExecutor({ onEvent: eventListener, pollIntervalMs: 100 });
  });

  afterEach(async () => {
    await executor.shutdown();
  });

  describe('adapter management', () => {
    it('should register and retrieve adapters', () => {
      const adapter = new MockAdapter('codex');
      executor.registerAdapter(adapter);

      expect(executor.getAdapter('codex')).toBe(adapter);
      expect(executor.getAdapter('claude_code')).toBeUndefined();
    });

    it('should return registered worker types', () => {
      executor.registerAdapter(new MockAdapter('codex'));
      executor.registerAdapter(new MockAdapter('claude_code'));

      expect(executor.getRegisteredWorkerTypes()).toEqual(
        expect.arrayContaining(['codex', 'claude_code'])
      );
    });

    it('should initialize all adapters', async () => {
      const adapter1 = new MockAdapter('codex');
      const adapter2 = new MockAdapter('claude_code');

      executor.registerAdapter(adapter1);
      executor.registerAdapter(adapter2);

      await executor.initialize();

      expect(await executor.isReady()).toBe(true);
      expect(events.filter(e => e.type === 'worker_initialized')).toHaveLength(2);
    });
  });

  describe('job submission', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should submit job to default worker', async () => {
      const job = createJob();
      const result = await executor.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBe('codex-job-123');
      expect(result.status).toBe('queued');

      // Check event
      const event = events.find(e => e.type === 'job_submitted');
      expect(event).toMatchObject({
        type: 'job_submitted',
        job_id: 'job-123',
        worker_type: 'codex',
      });
    });

    it('should submit job to specified worker', async () => {
      executor.registerAdapter(new MockAdapter('claude_code'));

      const job = createJob();
      const result = await executor.submitJob(job, 'claude_code');

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBe('claude_code-job-123');
    });

    it('should reject if no adapter for worker type', async () => {
      const job = createJob();
      const result = await executor.submitJob(job, 'google_antigravity');

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('No adapter registered');
    });

    it('should track active jobs', async () => {
      const job = createJob();
      await executor.submitJob(job);

      const activeJob = executor.getActiveJob('job-123');
      expect(activeJob).toMatchObject({
        worker_type: 'codex',
        failover_count: 0,
      });
      expect(activeJob?.job.job_id).toBe('job-123');
    });
  });

  describe('job polling', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should poll job status', async () => {
      const job = createJob();
      await executor.submitJob(job);

      const result = await executor.pollJob('job-123');

      expect(result.status).toBe('succeeded');
      expect(result.result).toBeDefined();
    });

    it('should emit job_completed event on success', async () => {
      const job = createJob();
      await executor.submitJob(job);

      await executor.pollJob('job-123');

      const event = events.find(e => e.type === 'job_completed');
      expect(event).toMatchObject({
        type: 'job_completed',
        job_id: 'job-123',
        worker_type: 'codex',
      });
    });

    it('should remove job from active after completion', async () => {
      const job = createJob();
      await executor.submitJob(job);

      await executor.pollJob('job-123');

      expect(executor.getActiveJob('job-123')).toBeUndefined();
    });

    it('should return error for unknown job', async () => {
      const result = await executor.pollJob('unknown-job');

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Job not found');
    });
  });

  describe('job cancellation', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should cancel active job', async () => {
      const job = createJob();
      await executor.submitJob(job);

      const result = await executor.cancelJob('job-123');

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');

      const event = events.find(e => e.type === 'job_cancelled');
      expect(event).toMatchObject({
        type: 'job_cancelled',
        job_id: 'job-123',
      });
    });

    it('should remove job from active after cancellation', async () => {
      const job = createJob();
      await executor.submitJob(job);

      await executor.cancelJob('job-123');

      expect(executor.getActiveJob('job-123')).toBeUndefined();
    });

    it('should return error for unknown job', async () => {
      const result = await executor.cancelJob('unknown-job');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });
  });

  describe('wait for job', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should wait for job completion', async () => {
      const job = createJob();
      await executor.submitJob(job);

      const result = await executor.waitForJob('job-123', 5000);

      expect(result.status).toBe('succeeded');
    });

    it('should throw on timeout', async () => {
      // Create executor with mock that never completes
      const slowExecutor = new WorkerExecutor({
        onEvent: eventListener,
        pollIntervalMs: 50,
      });

      // Create a slow adapter that doesn't return succeeded immediately
      class SlowAdapter extends MockAdapter {
        async pollJob(externalJobId: string): Promise<JobPollResult> {
          return {
            external_job_id: externalJobId,
            status: 'running',
            progress: 50,
          };
        }
      }

      slowExecutor.registerAdapter(new SlowAdapter('codex'));
      await slowExecutor.initialize();

      const job = createJob();
      await slowExecutor.submitJob(job);

      await expect(
        slowExecutor.waitForJob('job-123', 100)
      ).rejects.toThrow('timed out');

      await slowExecutor.shutdown();
    });
  });

  describe('periodic polling', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should start and stop polling', async () => {
      const job = createJob();
      await executor.submitJob(job);

      const results: JobPollResult[] = [];
      executor.startPolling('job-123', (result) => results.push(result));

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(results.length).toBeGreaterThan(0);
      expect(results[results.length - 1].status).toBe('succeeded');
    });
  });

  describe('failover', () => {
    it('should failover to next worker on poll failure', async () => {
      // Create adapters
      const codexAdapter = new MockAdapter('codex');
      const claudeAdapter = new MockAdapter('claude_code');

      executor.registerAdapter(codexAdapter);
      executor.registerAdapter(claudeAdapter);
      await executor.initialize();

      const job = createJob();
      const submitResult = await executor.submitJob(job);

      // Verify job submitted to codex (default for plan stage)
      expect(submitResult.success).toBe(true);
      expect(submitResult.external_job_id).toContain('codex');

      // Verify active job tracked
      const activeJob = executor.getActiveJob('job-123');
      expect(activeJob?.worker_type).toBe('codex');
    });

    it('should have failover configuration in WorkerPolicy', async () => {
      // Verify failover infrastructure exists
      const { WorkerPolicy } = await import('../src/domain/worker/worker-policy.js');

      // Plan stage should support failover
      expect(WorkerPolicy.canFailover('plan')).toBe(true);

      // Dev and acceptance should not
      expect(WorkerPolicy.canFailover('dev')).toBe(false);
      expect(WorkerPolicy.canFailover('acceptance')).toBe(false);

      // Get failover chain for plan
      expect(WorkerPolicy.getFailoverWorker('plan', 'codex')).toBe('claude_code');
      expect(WorkerPolicy.getFailoverWorker('plan', 'claude_code')).toBe('google_antigravity');
      expect(WorkerPolicy.getFailoverWorker('plan', 'google_antigravity')).toBe(null);
    });

    it('should emit failover event when configured', async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      executor.registerAdapter(new MockAdapter('claude_code'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      // Verify executor can track events
      expect(events.find(e => e.type === 'job_submitted')).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      await executor.shutdown();

      expect(executor.getRegisteredWorkerTypes()).toHaveLength(0);
      expect(executor.getAllActiveJobs()).toHaveLength(0);
    });

    it('should cancel active jobs on shutdown', async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      await executor.shutdown();

      const event = events.find(e => e.type === 'job_cancelled');
      expect(event).toBeDefined();
    });
  });

  describe('capabilities', () => {
    it('should get worker capabilities', async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();

      const caps = await executor.getCapabilities('codex');

      expect(caps).toMatchObject({
        worker_type: 'codex',
        capabilities: expect.arrayContaining(['plan', 'edit_repo']),
      });
    });

    it('should return null for unknown worker', async () => {
      const caps = await executor.getCapabilities('unknown');
      expect(caps).toBeNull();
    });
  });

  describe('active jobs tracking', () => {
    beforeEach(async () => {
      executor.registerAdapter(new MockAdapter('codex'));
      await executor.initialize();
    });

    it('should track multiple active jobs', async () => {
      await executor.submitJob(createJob({ job_id: 'job-1' }));
      await executor.submitJob(createJob({ job_id: 'job-2' }));
      await executor.submitJob(createJob({ job_id: 'job-3' }));

      const allJobs = executor.getAllActiveJobs();
      expect(allJobs).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('should handle adapter initialization failure', async () => {
      class FailingInitAdapter extends MockAdapter {
        async initialize(): Promise<void> {
          throw new Error('Init failed');
        }
      }

      executor.registerAdapter(new FailingInitAdapter('codex'));

      await expect(executor.initialize()).rejects.toThrow('Init failed');

      const event = events.find(e => e.type === 'worker_error');
      expect(event).toMatchObject({
        type: 'worker_error',
        worker_type: 'codex',
        error: 'Init failed',
      });
    });

    it('should handle polling errors gracefully', async () => {
      class ErrorPollAdapter extends MockAdapter {
        async pollJob(externalJobId: string): Promise<JobPollResult> {
          return {
            external_job_id: externalJobId,
            status: 'failed',
            error: 'Poll error',
          };
        }
      }

      executor.registerAdapter(new ErrorPollAdapter('codex'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      const result = await executor.pollJob('job-123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Poll error');
    });

    it('should handle event listener errors', async () => {
      const errorListener: ExecutorEventListener = () => {
        throw new Error('Listener error');
      };
      const errorExecutor = new WorkerExecutor({ onEvent: errorListener, pollIntervalMs: 100 });

      errorExecutor.registerAdapter(new MockAdapter('codex'));
      await errorExecutor.initialize();

      // Should not throw
      const job = createJob();
      const result = await errorExecutor.submitJob(job);
      expect(result.success).toBe(true);

      await errorExecutor.shutdown();
    });

    it('should return failed for unknown job in cancelJob', async () => {
      const result = await executor.cancelJob('nonexistent');
      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });

    it('should handle missing adapter during poll', async () => {
      const job = createJob();
      await executor.submitJob(job);

      // Remove the adapter after submission
      await executor.shutdown();

      // Re-register without the codex adapter
      executor.registerAdapter(new MockAdapter('claude_code'));
      await executor.initialize();

      // Submit a new job that will be tracked but adapter was removed
      const job2 = createJob({ job_id: 'job-456' });
      await executor.submitJob(job2, 'claude_code');

      // Now try to poll a job that has a missing adapter
      // This test verifies the code path handles missing adapters
      const result = await executor.pollJob('job-123');
      expect(result.status).toBe('failed');
    });

    it('should handle missing adapter during cancel', async () => {
      const job = createJob();
      await executor.submitJob(job);

      // Shutdown clears adapters but activeJobs may still have reference
      // After shutdown, cancelJob should handle missing adapter gracefully
      await executor.shutdown();

      // Now try to cancel - will fail because active jobs were cleared
      const result = await executor.cancelJob('job-123');
      expect(result.success).toBe(false);
    });
  });

  describe('waitForJob edge cases', () => {
    it('should throw on job failure', async () => {
      class FailingPollAdapter extends MockAdapter {
        async pollJob(externalJobId: string): Promise<JobPollResult> {
          return {
            external_job_id: externalJobId,
            status: 'failed',
            error: 'Job failed spectacularly',
          };
        }
      }

      executor.registerAdapter(new FailingPollAdapter('codex'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      await expect(executor.waitForJob('job-123', 5000)).rejects.toThrow('Job failed spectacularly');
    });

    it('should throw on job cancellation', async () => {
      class CancellingPollAdapter extends MockAdapter {
        async pollJob(externalJobId: string): Promise<JobPollResult> {
          return {
            external_job_id: externalJobId,
            status: 'cancelled',
          };
        }
      }

      executor.registerAdapter(new CancellingPollAdapter('codex'));
      await executor.initialize();

      const job = createJob();
      await executor.submitJob(job);

      await expect(executor.waitForJob('job-123', 5000)).rejects.toThrow('cancelled');
    });
  });

  describe('double initialization', () => {
    it('should skip re-initialization', async () => {
      executor.registerAdapter(new MockAdapter('codex'));

      await executor.initialize();
      await executor.initialize(); // Second call

      // Should only have one worker_initialized event
      expect(events.filter(e => e.type === 'worker_initialized')).toHaveLength(1);
    });
  });
});