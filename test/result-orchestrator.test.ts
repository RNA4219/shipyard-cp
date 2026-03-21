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
    typed_ref: 'github:owner/repo:main:path',
    status: 'succeeded',
    summary: 'Task completed',
    artifacts: [],
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
      const result = createMockResult({ status: 'succeeded', summary: 'Dev done' });
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

    it('should auto-complete acceptance for accept verdict when gate passes', () => {
      const task = createMockTask({ state: 'accepting' });
      const job = createMockJob({ stage: 'acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'LGTM' }
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('integrate');
      expect(context.transitionTask).not.toHaveBeenCalled();
      expect(context.setTask).toHaveBeenCalledWith(
        'task_001',
        expect.objectContaining({
          task_id: 'task_001',
          state: 'accepting',
          last_verdict: expect.objectContaining({ outcome: 'accept', reason: 'LGTM' }),
        })
      );
      expect(context.completeAcceptance).toHaveBeenCalledWith(
        'task_001',
        expect.objectContaining({
          verdict: expect.objectContaining({ outcome: 'accept', reason: 'LGTM' }),
        })
      );
      expect(response.task.state).toBe('accepted');
    });

    it('should fall back to manual acceptance when auto-complete gate fails', () => {
      const task = createMockTask({ state: 'accepting' });
      const job = createMockJob({ stage: 'acceptance' });
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'Needs recorded approval' }
      });
      const { context } = createMockContext();
      const retryTracker = new Map<string, number>();
      vi.mocked(context.completeAcceptance).mockImplementation(() => {
        throw new Error('manual checklist not complete');
      });

      const response = orchestrator.applyResult(result, task, job, retryTracker, context);

      expect(response.next_action).toBe('wait_manual');
      expect(context.completeAcceptance).toHaveBeenCalled();
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
      const result = createMockResult({ status: 'failed', summary: 'Permanent error' });
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
        artifacts: [
          { artifact_id: 'art_001', kind: 'code', path: '/src/main.ts', content_hash: 'abc123' }
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
