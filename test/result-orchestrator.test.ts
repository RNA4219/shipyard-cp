/**
 * Unit tests for ResultOrchestrator
 *
 * Tests the core result handling logic including:
 * - Success paths (plan/dev/acceptance stages)
 * - Retry logic with exponential backoff
 * - Failover to different worker
 * - Doom loop detection
 * - Blocked state handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResultOrchestrator } from '../src/domain/result/result-orchestrator.js';
import type { Task, WorkerJob, WorkerResult, StateTransitionEvent, TaskState } from '../src/types.js';
import type { RetryManager, DoomLoopDetector, LeaseManager, ConcurrencyManager, SideEffectAnalyzer, StateMachine } from '../src/domain/index.js';

// Mock dependencies
function createMockDeps() {
  return {
    retryManager: {
      classifyFromResult: vi.fn(() => 'transient' as const),
      shouldRetry: vi.fn(() => true),
      getDefaultMaxRetries: vi.fn(() => 3),
      calculateBackoff: vi.fn((count: number) => count * 2),
    } as unknown as RetryManager,
    doomLoopDetector: {
      detectLoop: vi.fn(() => null),
      trackTransition: vi.fn(),
    } as unknown as DoomLoopDetector,
    leaseManager: {
      release: vi.fn(),
      acquire: vi.fn(() => ({ lease_owner: 'test', lease_expires_at: new Date().toISOString() })),
    } as unknown as LeaseManager,
    concurrencyManager: {
      recordComplete: vi.fn(),
    } as unknown as ConcurrencyManager,
    sideEffectAnalyzer: {
      analyzeSideEffects: vi.fn(() => ({ categories: [], hasSideEffects: false })),
    } as unknown as SideEffectAnalyzer,
    stateMachine: {
      stageToActiveState: vi.fn((stage: string) => {
        if (stage === 'plan') return 'planning';
        if (stage === 'dev') return 'developing';
        return 'accepting';
      }),
      isTerminal: vi.fn(() => false),
      validateTransition: vi.fn(),
    } as unknown as StateMachine,
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_001',
    typed_ref: 'github:owner/repo:main:path',
    objective: 'Test objective',
    state: 'planning',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_001',
    task_id: 'task_001',
    typed_ref: 'github:owner/repo:main:path',
    stage: 'plan',
    worker_type: 'codex',
    lease_owner: 'worker_1',
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    input_prompt: 'Test prompt',
    retry_policy: { max_retries: 3, backoff_base_seconds: 2, max_backoff_seconds: 60, jitter_enabled: true },
    loop_fingerprint: 'fp_001',
    ...overrides,
  };
}

function createMockResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    job_id: 'job_001',
    typed_ref: 'agent-taskstate:task:github:task_001',
    status: 'succeeded',
    summary: 'Task completed',
    artifacts: [],
    test_results: [],
    requested_escalations: [],
    usage: { runtime_ms: 1000 },
    ...overrides,
  };
}

function createMockContext() {
  const events: StateTransitionEvent[] = [];
  return {
    context: {
      transitionTask: vi.fn((task: Task, toState: TaskState, input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>) => {
        const event: StateTransitionEvent = {
          event_id: `evt_${events.length}`,
          task_id: task.task_id,
          from_state: task.state,
          to_state: toState,
          occurred_at: new Date().toISOString(),
          ...input,
        };
        events.push(event);
        return { event, task: { ...task, state: toState } };
      }),
      emitAuditEvent: vi.fn(),
      setTask: vi.fn(),
      completeAcceptance: vi.fn((taskId: string, request?: { verdict?: Task['last_verdict'] }) => ({
        ...createMockTask({ task_id: taskId, state: 'accepted' }),
        last_verdict: request?.verdict,
      })),
    },
    events,
  };
}

describe('ResultOrchestrator', () => {
  let orchestrator: ResultOrchestrator;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    orchestrator = new ResultOrchestrator(deps);
  });

  describe('handleSucceededResult', () => {
    it('should transition to planned on plan stage success', () => {
      const task = createMockTask({ state: 'planning' });
      const job = createMockJob({ stage: 'plan' });
      const result = createMockResult({ status: 'succeeded', summary: 'Plan done' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('dispatch_dev');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task_001' }),
        'planned',
        expect.objectContaining({ reason: 'Plan done' })
      );
    });

    it('should transition to dev_completed on dev stage success', () => {
      const task = createMockTask({ state: 'developing' });
      const job = createMockJob({ stage: 'dev' });
      const result = createMockResult({
        status: 'succeeded',
        summary: 'Dev done',
        patch_ref: { format: 'unified_diff', content: 'diff content' },
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('dispatch_acceptance');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task_001' }),
        'dev_completed',
        expect.objectContaining({ reason: 'Dev done' })
      );
    });

    it('should require acceptance gate when dev tool_plan applied workspace changes', () => {
      const task = createMockTask({ state: 'developing' });
      const job = createMockJob({ stage: 'dev' });
      const result = createMockResult({
        status: 'succeeded',
        summary: 'tool_plan applied',
        artifacts: [{ artifact_id: 'tool-plan-json', kind: 'json', uri: 'artifact://artifacts/jobs/job_001/tool_plan.json' }],
        metadata: {
          tool_plan_execution_verdict: 'applied',
          tool_plan_applied: true,
        },
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('dispatch_acceptance');
      expect(response.taskUpdates.acceptance_gate_context).toMatchObject({
        required: true,
        source_job_id: 'job_001',
        artifact_ids: ['tool-plan-json'],
      });
      expect(context.emitAuditEvent).toHaveBeenCalledWith(
        'task_001',
        'run.acceptanceGateRequired',
        expect.objectContaining({
          required: true,
          source_job_id: 'job_001',
        }),
        { jobId: 'job_001' },
      );
    });

    it('should retain an accept verdict and wait for explicit manual acceptance', () => {
      const task = createMockTask({ state: 'accepting' });
      const job = createMockJob({ stage: 'acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'LGTM' },
        test_results: [{ suite: 'unit', status: 'passed', passed: 5 }],
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.transitionTask).not.toHaveBeenCalled();
      expect(context.setTask).not.toHaveBeenCalled();
      expect(context.completeAcceptance).not.toHaveBeenCalled();
      expect(response.task.state).toBe('accepting');
      expect(response.task.last_verdict).toEqual(expect.objectContaining({
        outcome: 'accept',
        reason: 'LGTM',
      }));
    });

    it('should emit acceptance gate enforcement audit when accepting a tool_plan gated task', () => {
      const task = createMockTask({
        state: 'accepting',
        acceptance_gate_context: {
          required: true,
          source_job_id: 'job_dev',
          reason: 'tool_plan applied workspace changes',
          artifact_ids: ['tool-plan-diff'],
          created_at: new Date().toISOString(),
        },
      });
      const job = createMockJob({ stage: 'acceptance', job_id: 'job_acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'verified' },
        test_results: [{ suite: 'unit', status: 'passed', passed: 5 }],
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.emitAuditEvent).toHaveBeenCalledWith(
        'task_001',
        'run.acceptanceGateEnforced',
        expect.objectContaining({
          source_job_id: 'job_dev',
          acceptance_job_id: 'job_acceptance',
          verdict: 'accept',
        }),
        { jobId: 'job_acceptance' },
      );
    });

    it('should never invoke automatic acceptance completion', () => {
      const task = createMockTask({ state: 'accepting' });
      const job = createMockJob({ stage: 'acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'Needs recorded approval' },
        test_results: [{ suite: 'unit', status: 'passed', passed: 5 }],
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.completeAcceptance).not.toHaveBeenCalled();
      expect(context.transitionTask).not.toHaveBeenCalled();
      expect(response.task.state).toBe('accepting');
      expect(response.task.last_verdict?.outcome).toBe('accept');
    });

    it('should transition to rework_required on reject verdict', () => {
      const task = createMockTask({ state: 'accepting' });
      const job = createMockJob({ stage: 'acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'reject', reason: 'Code quality issues' }
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('dispatch_dev');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task_001' }),
        'rework_required',
        expect.objectContaining({ reason: 'Code quality issues' })
      );
    });
  });

  describe('handleFailedResult', () => {
    it('should failover to different worker for plan stage before retry', () => {
      const task = createMockTask({ state: 'planning' });
      const job = createMockJob({ stage: 'plan', worker_type: 'codex' });
      const result = createMockResult({ status: 'failed', summary: 'Codex failed' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      vi.mocked(deps.retryManager.shouldRetry).mockReturnValue(true);

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      // Plan stage tries failover first (codex -> claude_code)
      expect(response.next_action).toBe('failover');
      expect(response.failover_worker).toBe('claude_code');
    });

    it('should retry when failover is not available', () => {
      const task = createMockTask({ state: 'developing' });
      const job = createMockJob({ stage: 'dev', worker_type: 'codex' });
      const result = createMockResult({ status: 'failed', summary: 'Dev failed' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      vi.mocked(deps.retryManager.shouldRetry).mockReturnValue(true);

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      // Dev stage doesn't have failover, so it retries
      expect(response.next_action).toBe('retry');
      expect(response.retry_scheduled_at).toBeDefined();
      expect(retryTracker.get('task_001:dev')).toBe(1);
    });

    it('should not retry after max retries', () => {
      const task = createMockTask({ state: 'developing' });
      const job = createMockJob({ stage: 'dev' });
      const result = createMockResult({
        status: 'failed',
        summary: 'Permanent error',
        artifacts: [{ artifact_id: 'tool-plan-diff', kind: 'other', uri: 'artifact://artifacts/jobs/job_001/tool-plan.diff' }],
        metadata: {
          tool_plan_test_failure_summaries: JSON.stringify(['expected 1 received 2']),
        },
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>([['task_001:dev', 3]]);

      vi.mocked(deps.retryManager.shouldRetry).mockReturnValue(false);

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('dispatch_dev');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task_001' }),
        'rework_required',
        expect.objectContaining({ reason: 'Permanent error' })
      );
      expect(response.taskUpdates.rework_context).toMatchObject({
        source_job_id: 'job_001',
        stage: 'dev',
        attempt: 1,
        max_attempts: 2,
        reason: 'Permanent error',
        test_failure_summary: 'expected 1 received 2',
        artifact_ids: ['tool-plan-diff'],
      });
      expect(context.emitAuditEvent).toHaveBeenCalledWith(
        'task_001',
        'run.reworkPayloadPrepared',
        expect.objectContaining({
          source_job_id: 'job_001',
          attempt: 1,
          max_attempts: 2,
          test_failure_summary: 'expected 1 received 2',
        }),
        { jobId: 'job_001' },
      );
    });

    it('should block when bounded rework attempts are exhausted', () => {
      const task = createMockTask({
        state: 'developing',
        rework_context: {
          source_job_id: 'job_previous',
          stage: 'dev',
          attempt: 2,
          max_attempts: 2,
          reason: 'previous failure',
          artifact_ids: [],
          created_at: new Date().toISOString(),
        },
      });
      const job = createMockJob({ stage: 'dev' });
      const result = createMockResult({ status: 'failed', summary: 'still failing' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>([['task_001:dev', 3]]);

      vi.mocked(deps.retryManager.shouldRetry).mockReturnValue(false);

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task_001' }),
        'blocked',
        expect.objectContaining({ actor_id: 'rework_loop_guard' }),
      );
      expect(response.taskUpdates.blocked_context?.reason).toContain('bounded rework attempts exhausted');
    });
  });

  describe('handleDoomLoop', () => {
    it('should block task on doom loop detection', () => {
      const task = createMockTask({ state: 'planning' });
      const job = createMockJob({ stage: 'plan', loop_fingerprint: 'fp_loop' });
      const result = createMockResult({ status: 'failed', summary: 'Recurring failure' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      vi.mocked(deps.doomLoopDetector.detectLoop).mockReturnValue({ loop_type: 'state_oscillation' });

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.any(Object),
        'blocked',
        expect.objectContaining({ reason: expect.stringContaining('doom loop') })
      );
    });
  });

  describe('handleBlockedResult', () => {
    it('should transition to blocked state with resume info', () => {
      const task = createMockTask({ state: 'developing' });
      const job = createMockJob({ stage: 'dev' });
      const result = createMockResult({ status: 'blocked', summary: 'Need manual intervention' });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.transitionTask).toHaveBeenCalledWith(
        expect.any(Object),
        'blocked',
        expect.objectContaining({ reason: 'Need manual intervention' })
      );
    });
  });

  describe('taskUpdates from result', () => {
    it('should merge artifacts from result', () => {
      const task = createMockTask({ state: 'planning', artifacts: [] });
      const job = createMockJob({ stage: 'plan' });
      const result = createMockResult({
        status: 'succeeded',
        summary: 'Plan created',
        artifacts: [
          { artifact_id: 'art_001', kind: 'json', uri: 'artifact://plan.json' }
        ]
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.taskUpdates.mergeArtifacts).toBeDefined();
    });

    it('should store resolver refs from result', () => {
      const task = createMockTask({ state: 'planning' });
      const job = createMockJob({ stage: 'plan' });
      const result = createMockResult({
        status: 'succeeded',
        summary: 'Plan created',
        resolver_refs: {
          doc_refs: ['doc_001'],
          stale_status: 'fresh',
        }
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.taskUpdates.mergeResolverRefs).toBeDefined();
    });
  });
});
