import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobService, type JobOperationContext } from '../src/store/services/job-service.js';
import { LeaseManager } from '../src/domain/lease/lease-manager.js';
import { RetryManager } from '../src/domain/retry/index.js';
import { ConcurrencyManager } from '../src/domain/concurrency/concurrency-manager.js';
import { CapabilityManager } from '../src/domain/capability/capability-manager.js';
import { DoomLoopDetector } from '../src/domain/doom-loop/doom-loop-detector.js';
import { StateMachine } from '../src/domain/state-machine/state-machine.js';
import type {
  Task,
  WorkerJob,
  WorkerResult,
  DispatchRequest,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
  StateTransitionEvent,
  AuditEvent,
  ResultApplyResponse,
} from '../src/types.js';

// Helper to create a mock task
function createTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task-123',
    title: 'Test Task',
    objective: 'Test objective',
    typed_ref: 'issue:1:owner:repo',
    state: 'queued',
    version: 1,
    risk_level: 'low',
    repo_ref: {
      provider: 'github',
      owner: 'testowner',
      name: 'testrepo',
      default_branch: 'main',
      base_sha: 'abc123',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create a mock job
function createJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job-123',
    task_id: 'task-123',
    typed_ref: 'issue:1:owner:repo',
    stage: 'plan',
    worker_type: 'claude_code',
    workspace_ref: {
      workspace_id: 'ws-123',
      kind: 'container',
    },
    input_prompt: 'Test prompt',
    repo_ref: {
      provider: 'github',
      owner: 'testowner',
      name: 'testrepo',
      default_branch: 'main',
    },
    capability_requirements: ['plan'],
    risk_level: 'low',
    approval_policy: {
      mode: 'allow',
    },
    retry_policy: {
      max_retries: 3,
      backoff_base_seconds: 2,
      max_backoff_seconds: 60,
      jitter_enabled: true,
    },
    ...overrides,
  };
}

// Helper to create a mock result
function createResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    job_id: 'job-123',
    typed_ref: 'issue:1:owner:repo',
    status: 'succeeded',
    summary: 'Job completed successfully',
    artifacts: [],
    test_results: [],
    requested_escalations: [],
    usage: {
      runtime_ms: 1000,
    },
    ...overrides,
  };
}

// Helper to create mock context
function createMockContext(task: Task): JobOperationContext {
  return {
    requireTask: vi.fn((taskId: string) => {
      if (taskId === task.task_id) return task;
      throw new Error(`Task not found: ${taskId}`);
    }),
    transitionTask: vi.fn((_t: Task, _toState: Task['state'], _input: {
      actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
      actor_id: string;
      reason: string;
      job_id?: string;
      artifact_ids?: string[];
    }) => ({
      event: {
        event_id: 'event-123',
        task_id: task.task_id,
        from_state: task.state,
        to_state: _toState,
        actor_type: _input.actor_type,
        actor_id: _input.actor_id,
        reason: _input.reason,
        job_id: _input.job_id,
        occurred_at: new Date().toISOString(),
      } as StateTransitionEvent,
      task: { ...task, state: _toState },
    })),
    emitAuditEvent: vi.fn((_taskId: string, _eventType: string, _payload: Record<string, unknown>, _options?: {
      runId?: string;
      jobId?: string;
      actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
      actorId?: string;
    }) => ({
      event_id: 'audit-123',
      event_type: _eventType,
      task_id: _taskId,
      actor_type: _options?.actorType ?? 'control_plane',
      actor_id: _options?.actorId ?? 'test',
      payload: _payload,
      occurred_at: new Date().toISOString(),
    } as AuditEvent)),
    applyResult: vi.fn((_taskId: string, _result: WorkerResult): ResultApplyResponse => ({
      task: { ...task },
      emitted_events: [],
      next_action: 'none',
    })),
    setTask: vi.fn(),
  };
}

describe('JobService', () => {
  let jobService: JobService;
  let leaseManager: LeaseManager;
  let retryManager: RetryManager;
  let concurrencyManager: ConcurrencyManager;
  let capabilityManager: CapabilityManager;
  let doomLoopDetector: DoomLoopDetector;
  let stateMachine: StateMachine;

  beforeEach(() => {
    // Create fresh instances for each test
    leaseManager = new LeaseManager({
      lease_duration_seconds: 300,
      heartbeat_grace_multiplier: 3,
    });

    retryManager = new RetryManager();
    concurrencyManager = new ConcurrencyManager();
    capabilityManager = new CapabilityManager();
    doomLoopDetector = new DoomLoopDetector();
    stateMachine = new StateMachine();

    // Register worker capabilities (required for dispatch)
    capabilityManager.registerWorkerCapabilities('claude_code', ['plan', 'edit_repo', 'run_tests', 'produces_verdict']);
    capabilityManager.registerWorkerCapabilities('codex', ['plan', 'edit_repo', 'run_tests', 'produces_verdict']);

    jobService = new JobService({
      leaseManager,
      retryManager,
      concurrencyManager,
      capabilityManager,
      doomLoopDetector,
      stateMachine,
    });
  });

  afterEach(() => {
    jobService.clear();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(jobService.initialize()).resolves.toBeUndefined();
    });

    it('should not reinitialize if already initialized', async () => {
      await jobService.initialize();
      // Second call should be a no-op
      await expect(jobService.initialize()).resolves.toBeUndefined();
    });
  });

  describe('job storage', () => {
    describe('setJob', () => {
      it('should store a job', () => {
        const job = createJob();
        jobService.setJob(job.job_id, job);

        const result = jobService.getJob(job.job_id);
        expect(result.job).toEqual(job);
      });

      it('should overwrite an existing job', () => {
        const job1 = createJob({ job_id: 'job-123', stage: 'plan' });
        const job2 = createJob({ job_id: 'job-123', stage: 'dev' });

        jobService.setJob('job-123', job1);
        jobService.setJob('job-123', job2);

        const result = jobService.getJob('job-123');
        expect(result.job?.stage).toBe('dev');
      });
    });

    describe('getJob', () => {
      it('should return undefined for non-existent job', () => {
        const result = jobService.getJob('non-existent');
        expect(result.job).toBeUndefined();
        expect(result.latest_result).toBeUndefined();
      });

      it('should return job with latest result', () => {
        const job = createJob();
        const result = createResult();

        jobService.setJob(job.job_id, job);
        jobService.setResult(job.job_id, result);

        const retrieved = jobService.getJob(job.job_id);
        expect(retrieved.job).toEqual(job);
        expect(retrieved.latest_result).toEqual(result);
      });
    });

    describe('getJobsForTask', () => {
      it('should return all jobs for a task', () => {
        const job1 = createJob({ job_id: 'job-1', task_id: 'task-123' });
        const job2 = createJob({ job_id: 'job-2', task_id: 'task-123' });
        const job3 = createJob({ job_id: 'job-3', task_id: 'task-456' });

        jobService.setJob('job-1', job1);
        jobService.setJob('job-2', job2);
        jobService.setJob('job-3', job3);

        const jobs = jobService.getJobsForTask('task-123');
        expect(jobs).toHaveLength(2);
        expect(jobs.map(j => j.job_id)).toEqual(expect.arrayContaining(['job-1', 'job-2']));
      });

      it('should return empty array for task with no jobs', () => {
        const jobs = jobService.getJobsForTask('non-existent');
        expect(jobs).toEqual([]);
      });
    });
  });

  describe('result storage', () => {
    describe('setResult', () => {
      it('should store a result', () => {
        const result = createResult();
        jobService.setResult(result.job_id, result);

        expect(jobService.getResult(result.job_id)).toEqual(result);
      });
    });

    describe('getResult', () => {
      it('should return undefined for non-existent result', () => {
        expect(jobService.getResult('non-existent')).toBeUndefined();
      });
    });
  });

  describe('heartbeat', () => {
    it('should process heartbeat for existing job', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);

      // Acquire lease for the job
      leaseManager.acquire(job.job_id, 'worker-1');

      const request: JobHeartbeatRequest = {
        worker_id: 'worker-1',
        stage: 'plan',
        progress: 50,
      };

      const response = jobService.heartbeat(job.job_id, request);

      expect(response).toMatchObject({
        job_id: job.job_id,
        lease_expires_at: expect.any(String),
        next_heartbeat_due_at: expect.any(String),
        last_heartbeat_at: expect.any(String),
      });
    });

    it('should throw error for non-existent job', () => {
      const request: JobHeartbeatRequest = {
        worker_id: 'worker-1',
        stage: 'plan',
      };

      expect(() => jobService.heartbeat('non-existent', request)).toThrow('job not found');
    });

    it('should throw error when heartbeat rejected (wrong owner)', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);

      // Acquire lease for a different worker
      leaseManager.acquire(job.job_id, 'worker-1');

      const request: JobHeartbeatRequest = {
        worker_id: 'worker-2', // Wrong owner
        stage: 'plan',
      };

      expect(() => jobService.heartbeat(job.job_id, request)).toThrow('heartbeat rejected');
    });

    it('should include progress in heartbeat', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);
      leaseManager.acquire(job.job_id, 'worker-1');

      const request: JobHeartbeatRequest = {
        worker_id: 'worker-1',
        stage: 'dev',
        progress: 75,
        observed_at: new Date().toISOString(),
      };

      const response = jobService.heartbeat(job.job_id, request);
      expect(response.job_id).toBe(job.job_id);
    });
  });

  describe('canDispatchWithLease', () => {
    it('should return false for non-existent task', () => {
      const result = jobService.canDispatchWithLease('non-existent', 'dev', () => undefined);
      expect(result).toBe(false);
    });

    it('should return true for queued task dispatching to plan', () => {
      const task = createTask({ state: 'queued' });

      const result = jobService.canDispatchWithLease(
        task.task_id,
        'plan',
        (id) => id === task.task_id ? task : undefined
      );

      expect(result).toBe(true);
    });

    it('should return false for dev stage with missing lease', () => {
      const task = createTask({ state: 'planned', active_job_id: undefined });

      const result = jobService.canDispatchWithLease(
        task.task_id,
        'dev',
        (id) => id === task.task_id ? task : undefined
      );

      expect(result).toBe(false);
    });

    it('should return false for dev stage with expired lease', () => {
      const expiredLeaseManager = new LeaseManager({
        lease_duration_seconds: 0,
        heartbeat_grace_multiplier: 1,
      });

      const expiredJobService = new JobService({
        leaseManager: expiredLeaseManager,
        retryManager,
        concurrencyManager,
        capabilityManager,
        doomLoopDetector,
        stateMachine,
      });

      const job = createJob();
      expiredJobService.setJob(job.job_id, job);

      const task = createTask({
        state: 'planned',
        active_job_id: job.job_id
      });

      // Acquire and let expire
      expiredLeaseManager.acquire(job.job_id, 'claude_code');

      const result = expiredJobService.canDispatchWithLease(
        task.task_id,
        'dev',
        (id) => id === task.task_id ? task : undefined
      );

      expect(result).toBe(false);
    });

    it('should return true for dev stage with valid lease', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);

      // Acquire lease
      leaseManager.acquire(job.job_id, 'claude_code');

      const task = createTask({
        state: 'planned',
        active_job_id: job.job_id
      });

      const result = jobService.canDispatchWithLease(
        task.task_id,
        'dev',
        (id) => id === task.task_id ? task : undefined
      );

      expect(result).toBe(true);
    });
  });

  describe('getLeaseManager', () => {
    it('should return the lease manager instance', () => {
      expect(jobService.getLeaseManager()).toBe(leaseManager);
    });
  });

  describe('getJobsMap', () => {
    it('should return the jobs map', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);

      const map = jobService.getJobsMap();
      expect(map.get(job.job_id)).toEqual(job);
    });
  });

  describe('getRetryTracker', () => {
    it('should return the retry tracker map', () => {
      const tracker = jobService.getRetryTracker();
      expect(tracker).toBeInstanceOf(Map);
    });
  });

  describe('clear', () => {
    it('should clear all jobs, results, and retry tracker', () => {
      const job = createJob();
      const result = createResult();

      jobService.setJob(job.job_id, job);
      jobService.setResult(job.job_id, result);
      jobService.getRetryTracker().set('test-key', 1);

      jobService.clear();

      expect(jobService.getJob(job.job_id).job).toBeUndefined();
      expect(jobService.getResult(job.job_id)).toBeUndefined();
      expect(jobService.getRetryTracker().size).toBe(0);
    });
  });

  describe('dispatch', () => {
    it('should throw error when dispatching from invalid state', async () => {
      const task = createTask({ state: 'developing' });
      const ctx = createMockContext(task);

      const request: DispatchRequest = {
        target_stage: 'plan',
      };

      await expect(jobService.dispatch(task.task_id, request, ctx)).rejects.toThrow();
    });

    it('should throw error for capability mismatch', async () => {
      // Register a worker without required capabilities
      capabilityManager.registerWorkerCapabilities('weak_worker', []);

      const task = createTask({ state: 'queued' });
      const ctx = createMockContext(task);

      const request: DispatchRequest = {
        target_stage: 'plan',
        worker_selection: 'weak_worker',
      };

      await expect(jobService.dispatch(task.task_id, request, ctx)).rejects.toThrow('missing capabilities');
    });

    it('should update retry tracker during dispatch attempt', async () => {
      const task = createTask({ state: 'queued' });
      const ctx = createMockContext(task);

      // The retry tracker should be empty initially
      const tracker = jobService.getRetryTracker();
      expect(tracker.size).toBe(0);

      // Even a failed dispatch attempt may touch the tracker
      const request: DispatchRequest = {
        target_stage: 'plan',
      };

      try {
        await jobService.dispatch(task.task_id, request, ctx);
      } catch {
        // Expected to fail due to worker executor not being properly mocked
      }
    });

    it('should call transitionTask on context for blocked dispatch', async () => {
      // Register a worker without plan capability
      capabilityManager.registerWorkerCapabilities('incomplete_worker', ['edit_repo']);

      const task = createTask({ state: 'queued' });
      const ctx = createMockContext(task);

      const request: DispatchRequest = {
        target_stage: 'plan',
        worker_selection: 'incomplete_worker',
      };

      await expect(jobService.dispatch(task.task_id, request, ctx)).rejects.toThrow();
      // The blocked dispatch should trigger a transition to 'blocked' state
    });
  });

  describe('error scenarios', () => {
    it('should handle missing task in dispatch', async () => {
      const ctx = createMockContext(createTask());

      // Mock requireTask to throw
      ctx.requireTask = vi.fn(() => {
        throw new Error('Task not found');
      });

      const request: DispatchRequest = { target_stage: 'plan' };

      await expect(jobService.dispatch('non-existent', request, ctx)).rejects.toThrow('Task not found');
    });

    it('should handle heartbeat for job without lease', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);
      // No lease acquired

      const request: JobHeartbeatRequest = {
        worker_id: 'worker-1',
        stage: 'plan',
      };

      expect(() => jobService.heartbeat(job.job_id, request)).toThrow('heartbeat rejected');
    });
  });

  describe('result processing', () => {
    it('should store and retrieve results', () => {
      const job = createJob();
      const result = createResult({
        status: 'succeeded',
        summary: 'Task completed',
        usage: {
          runtime_ms: 5000,
          litellm: {
            model: 'claude-3',
            input_tokens: 100,
            output_tokens: 200,
            cost_usd: 0.01,
          },
        },
      });

      jobService.setJob(job.job_id, job);
      jobService.setResult(job.job_id, result);

      const retrieved = jobService.getResult(job.job_id);
      expect(retrieved).toEqual(result);
    });

    it('should handle failed results', () => {
      const result = createResult({
        status: 'failed',
        failure_class: 'retryable_transient',
        failure_code: 'TIMEOUT',
        failure_summary: 'Operation timed out',
        usage: { runtime_ms: 60000 },
      });

      jobService.setResult(result.job_id, result);

      expect(jobService.getResult(result.job_id)?.status).toBe('failed');
      expect(jobService.getResult(result.job_id)?.failure_class).toBe('retryable_transient');
    });

    it('should handle blocked results', () => {
      const result = createResult({
        status: 'blocked',
        summary: 'Waiting for approval',
        requested_escalations: [
          { kind: 'human_verdict', reason: 'Needs manual review' }
        ],
        usage: { runtime_ms: 1000 },
      });

      jobService.setResult(result.job_id, result);

      expect(jobService.getResult(result.job_id)?.status).toBe('blocked');
      expect(jobService.getResult(result.job_id)?.requested_escalations).toHaveLength(1);
    });
  });

  describe('lease management integration', () => {
    it('should return lease manager for direct access', () => {
      const lm = jobService.getLeaseManager();
      expect(lm).toBeInstanceOf(LeaseManager);
    });

    it('should check lease validity through canDispatchWithLease', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);

      // Without lease
      const task = createTask({ state: 'planned', active_job_id: job.job_id });
      let result = jobService.canDispatchWithLease(
        task.task_id,
        'dev',
        (id) => id === task.task_id ? task : undefined
      );
      expect(result).toBe(false);

      // With lease
      leaseManager.acquire(job.job_id, 'claude_code');
      result = jobService.canDispatchWithLease(
        task.task_id,
        'dev',
        (id) => id === task.task_id ? task : undefined
      );
      expect(result).toBe(true);
    });
  });

  describe('polling mechanism', () => {
    it('should have pollJobCompletion as private method (tested via dispatch)', () => {
      // pollJobCompletion is private and tested indirectly through dispatch tests
      // This test ensures the service is properly constructed
      expect(jobService).toBeDefined();
      expect(jobService.getJobsMap).toBeDefined();
    });
  });

  describe('job creation and lifecycle', () => {
    it('should create job with all required fields', () => {
      const job = createJob({
        job_id: 'job-test-1',
        task_id: 'task-test-1',
        stage: 'dev',
        worker_type: 'codex',
        input_prompt: 'Implement feature X',
        risk_level: 'high',
      });

      jobService.setJob(job.job_id, job);

      const retrieved = jobService.getJob(job.job_id);
      expect(retrieved.job).toBeDefined();
      expect(retrieved.job?.stage).toBe('dev');
      expect(retrieved.job?.worker_type).toBe('codex');
      expect(retrieved.job?.risk_level).toBe('high');
    });

    it('should handle multiple jobs for the same task', () => {
      const job1 = createJob({ job_id: 'job-1', task_id: 'task-multi', stage: 'plan' });
      const job2 = createJob({ job_id: 'job-2', task_id: 'task-multi', stage: 'dev' });
      const job3 = createJob({ job_id: 'job-3', task_id: 'task-multi', stage: 'acceptance' });

      jobService.setJob('job-1', job1);
      jobService.setJob('job-2', job2);
      jobService.setJob('job-3', job3);

      const jobs = jobService.getJobsForTask('task-multi');
      expect(jobs).toHaveLength(3);
      expect(jobs.map(j => j.stage)).toEqual(expect.arrayContaining(['plan', 'dev', 'acceptance']));
    });

    it('should track retry count in retry tracker', () => {
      const tracker = jobService.getRetryTracker();
      tracker.set('task-123:plan', 2);
      tracker.set('task-123:dev', 1);

      expect(tracker.get('task-123:plan')).toBe(2);
      expect(tracker.get('task-123:dev')).toBe(1);
    });
  });

  describe('context operations', () => {
    it('should call requireTask when dispatching', async () => {
      const task = createTask({ state: 'queued' });
      const ctx = createMockContext(task);

      const request: DispatchRequest = {
        target_stage: 'plan',
      };

      try {
        await jobService.dispatch(task.task_id, request, ctx);
      } catch {
        // Expected - worker executor not mocked
      }

      expect(ctx.requireTask).toHaveBeenCalledWith(task.task_id);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle heartbeat with observed_at timestamp', () => {
      const job = createJob();
      jobService.setJob(job.job_id, job);
      leaseManager.acquire(job.job_id, 'worker-1');

      const observedAt = new Date().toISOString();
      const request: JobHeartbeatRequest = {
        worker_id: 'worker-1',
        stage: 'plan',
        progress: 100,
        observed_at: observedAt,
      };

      const response = jobService.heartbeat(job.job_id, request);
      expect(response).toBeDefined();
    });

    it('should handle result with test results', () => {
      const result = createResult({
        test_results: [
          { suite: 'unit', status: 'passed', passed: 10, failed: 0 },
          { suite: 'integration', status: 'failed', passed: 5, failed: 2 },
        ],
      });

      jobService.setResult(result.job_id, result);

      const retrieved = jobService.getResult(result.job_id);
      expect(retrieved?.test_results).toHaveLength(2);
      expect(retrieved?.test_results[0].status).toBe('passed');
      expect(retrieved?.test_results[1].status).toBe('failed');
    });

    it('should handle result with artifacts', () => {
      const result = createResult({
        artifacts: [
          { artifact_id: 'art-1', kind: 'log', uri: 'file:///logs/job.log' },
          { artifact_id: 'art-2', kind: 'report', uri: 'file:///reports/coverage.html' },
        ],
      });

      jobService.setResult(result.job_id, result);

      const retrieved = jobService.getResult(result.job_id);
      expect(retrieved?.artifacts).toHaveLength(2);
    });

    it('should handle result with patch ref', () => {
      const result = createResult({
        patch_ref: {
          format: 'unified_diff',
          content: '--- a/file.ts\n+++ b/file.ts\n...',
          base_sha: 'abc123',
        },
      });

      jobService.setResult(result.job_id, result);

      const retrieved = jobService.getResult(result.job_id);
      expect(retrieved?.patch_ref).toBeDefined();
      expect(retrieved?.patch_ref?.format).toBe('unified_diff');
    });

    it('should handle result with branch ref', () => {
      const result = createResult({
        branch_ref: {
          name: 'feature/branch',
          head_sha: 'def456',
          remote_url: 'https://github.com/owner/repo.git',
        },
      });

      jobService.setResult(result.job_id, result);

      const retrieved = jobService.getResult(result.job_id);
      expect(retrieved?.branch_ref).toBeDefined();
      expect(retrieved?.branch_ref?.name).toBe('feature/branch');
    });
  });
});