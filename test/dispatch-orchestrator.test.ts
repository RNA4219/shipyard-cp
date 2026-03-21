/**
 * Unit tests for DispatchOrchestrator
 *
 * Tests the dispatch workflow including:
 * - Stage validation
 * - Worker selection
 * - Lease acquisition
 * - Job creation
 * - Concurrency management
 * - Capability verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DispatchOrchestrator } from '../src/domain/dispatch/dispatch-orchestrator.js';
import type { Task, WorkerJob, DispatchRequest, StateTransitionEvent, TaskState, Capability, WorkerStage } from '../src/types.js';
import type { CapabilityManager, ConcurrencyManager, LeaseManager, RetryManager, DoomLoopDetector, StateMachine } from '../src/domain/index.js';
import type { CapabilityCheckResult } from '../src/domain/capability/types.js';

function createMockDeps() {
  return {
    capabilityManager: {
      getWorkerCapabilities: vi.fn((workerId: string): Capability[] => {
        // Return appropriate capabilities for each worker type
        if (workerId === 'codex') return ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'];
        if (workerId === 'claude_code') return ['plan', 'edit_repo', 'run_tests', 'needs_approval', 'produces_patch', 'produces_verdict', 'networked'];
        return ['plan', 'produces_verdict'];
      }),
      validateCapabilities: vi.fn(() => ({ valid: true, missing: [] })),
      registerWorkerCapabilities: vi.fn(),
      checkCapabilities: vi.fn((required: Capability[], available: Capability[]): CapabilityCheckResult => ({
        required,
        present: available.filter(c => required.includes(c)),
        missing: required.filter(c => !available.includes(c)),
        passed: required.every(c => available.includes(c)),
      })),
      getRequiredCapabilitiesForStage: vi.fn((stage: WorkerStage): Capability[] => {
        if (stage === 'plan') return ['plan'];
        if (stage === 'dev') return ['edit_repo', 'run_tests'];
        return ['produces_verdict'];
      }),
      getAllRequiredCapabilities: vi.fn((options: { stage: WorkerStage; worker_capabilities: Capability[] }): Capability[] => {
        // Return base requirements
        if (options.stage === 'plan') return ['plan'];
        if (options.stage === 'dev') return ['edit_repo', 'run_tests'];
        return ['produces_verdict'];
      }),
    } as unknown as CapabilityManager,
    concurrencyManager: {
      canAccept: vi.fn(() => ({ accepted: true })),
      recordStart: vi.fn(),
    } as unknown as ConcurrencyManager,
    leaseManager: {
      acquire: vi.fn(() => ({
        lease_owner: 'worker_1',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })),
      release: vi.fn(),
    } as unknown as LeaseManager,
    retryManager: {
      getDefaultMaxRetries: vi.fn(() => 3),
    } as unknown as RetryManager,
    doomLoopDetector: {
      trackTransition: vi.fn(),
    } as unknown as DoomLoopDetector,
    stateMachine: {
      getAllowedDispatchStage: vi.fn((state: TaskState) => {
        if (state === 'queued') return 'plan';
        if (state === 'planned') return 'dev';
        if (state === 'dev_completed') return 'acceptance';
        throw new Error(`Invalid state for dispatch: ${state}`);
      }),
      stageToActiveState: vi.fn((stage: string) => {
        if (stage === 'plan') return 'planning';
        if (stage === 'dev') return 'developing';
        return 'accepting';
      }),
    } as unknown as StateMachine,
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_001',
    typed_ref: 'github:owner/repo:main:path',
    objective: 'Test objective',
    state: 'queued',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repo_ref: {
      provider: 'github',
      owner: 'owner',
      name: 'repo',
      default_branch: 'main',
    },
    risk_level: 'low',
    ...overrides,
  };
}

function createMockContext() {
  return {
    transitionTask: vi.fn((task: Task, toState: TaskState, input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>) => {
      const event: StateTransitionEvent = {
        event_id: 'evt_001',
        task_id: task.task_id,
        from_state: task.state,
        to_state: toState,
        occurred_at: new Date().toISOString(),
        ...input,
      };
      return { event, task: { ...task, state: toState } };
    }),
  };
}

describe('DispatchOrchestrator', () => {
  let orchestrator: DispatchOrchestrator;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    orchestrator = new DispatchOrchestrator(deps);
  });

  describe('dispatch', () => {
    it('should dispatch plan job for queued task', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job).toBeDefined();
        expect(result.job.stage).toBe('plan');
        expect(result.nextState).toBe('planning');
        expect(jobs.has(result.job.job_id)).toBe(true);
      }
    });

    it('should dispatch dev job for planned task', () => {
      const task = createMockTask({ state: 'planned' });
      const request: DispatchRequest = { target_stage: 'dev' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job.stage).toBe('dev');
        expect(result.nextState).toBe('developing');
      }
    });

    it('should dispatch acceptance job for dev_completed task', () => {
      const task = createMockTask({ state: 'dev_completed' });
      const request: DispatchRequest = { target_stage: 'acceptance' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job.stage).toBe('acceptance');
        expect(result.nextState).toBe('accepting');
      }
    });

    it('should throw error for invalid state/stage combination', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'dev' }; // queued can only dispatch plan
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      expect(() => orchestrator.dispatch(task, request, jobs, retryTracker, ctx)).toThrow(
        'state queued cannot dispatch dev'
      );
    });

    it('should use provided worker selection', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan', worker_selection: 'claude_code' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job.worker_type).toBe('claude_code');
      }
    });

    it('should use override risk level', () => {
      const task = createMockTask({ state: 'queued', risk_level: 'low' });
      const request: DispatchRequest = { target_stage: 'plan', override_risk_level: 'high' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job.risk_level).toBe('high');
      }
    });

    it('should acquire lease for the job', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(deps.leaseManager.acquire).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.job.lease_owner).toBe('worker_1');
      }
    });

    it('should throw when concurrency limit reached', () => {
      vi.mocked(deps.concurrencyManager.canAccept).mockReturnValue({
        accepted: false,
        reason: 'Max concurrent jobs reached',
      });

      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      expect(() => orchestrator.dispatch(task, request, jobs, retryTracker, ctx)).toThrow(
        'cannot dispatch: Max concurrent jobs reached'
      );
    });

    it('should throw when lease acquisition fails', () => {
      vi.mocked(deps.leaseManager.acquire).mockReturnValue(null as never);

      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      expect(() => orchestrator.dispatch(task, request, jobs, retryTracker, ctx)).toThrow(
        'Failed to acquire lease for job'
      );
    });

    it('should track transition for doom-loop detection', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(deps.doomLoopDetector.trackTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          from_state: 'queued',
          to_state: 'planning',
          stage: 'plan',
        })
      );
    });

    it('should record concurrency start', () => {
      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(deps.concurrencyManager.recordStart).toHaveBeenCalledWith(
          expect.objectContaining({
            job_id: result.job.job_id,
            worker_id: 'codex',
            stage: 'plan',
          })
        );
      }
    });

    it('should return blocked result when capabilities are missing', () => {
      // Mock worker with insufficient capabilities
      vi.mocked(deps.capabilityManager.getWorkerCapabilities).mockReturnValue([]);

      const task = createMockTask({ state: 'queued' });
      const request: DispatchRequest = { target_stage: 'plan' };
      const jobs = new Map<string, WorkerJob>();
      const retryTracker = new Map<string, number>();
      const ctx = createMockContext();

      const result = orchestrator.dispatch(task, request, jobs, retryTracker, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('insufficient_capability');
        expect(result.missing_capabilities).toContain('plan');
      }
    });
  });
});