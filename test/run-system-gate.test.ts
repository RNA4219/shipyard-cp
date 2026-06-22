import { describe, expect, it, vi } from 'vitest';
import { buildRunSystemPacket, evaluateRunSystemGate, type RunSystemCliAdapter } from '../src/domain/run-system/index.js';
import { ResultOrchestrator } from '../src/domain/result/result-orchestrator.js';
import type { Task, WorkerJob, WorkerResult, StateTransitionEvent, TaskState } from '../src/types.js';
import type {
  ConcurrencyManager,
  DoomLoopDetector,
  LeaseManager,
  RetryManager,
  SideEffectAnalyzer,
  StateMachine,
} from '../src/domain/index.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_gate_001',
    title: 'Run system gate',
    objective: 'Enforce external gate contracts',
    typed_ref: 'agent-taskstate:task:local:task_gate_001',
    state: 'developing',
    version: 1,
    risk_level: 'high',
    repo_ref: {
      provider: 'github',
      owner: 'local',
      name: 'shipyard-cp',
      default_branch: 'main',
    },
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_gate_001',
    task_id: 'task_gate_001',
    typed_ref: 'agent-taskstate:task:local:task_gate_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'completed',
    input_prompt: 'Implement gate',
    capability_requirements: ['edit_repo', 'run_tests'],
    risk_level: 'high',
    approval_policy: {
      mode: 'ask',
      sandbox_profile: 'workspace_write',
    },
    ...overrides,
  };
}

function result(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    job_id: 'job_gate_001',
    typed_ref: 'agent-taskstate:task:local:task_gate_001',
    status: 'succeeded',
    summary: 'Implemented',
    artifacts: [
      { artifact_id: 'tool-plan-diff', kind: 'other', uri: 'artifact://artifacts/jobs/job_gate_001/diff.patch' },
    ],
    test_results: [
      { suite: 'unit', status: 'passed', passed: 12 },
    ],
    requested_escalations: [],
    usage: { runtime_ms: 1234, exit_code: 0 },
    patch_ref: { format: 'unified_diff', content: 'diff --git a/docs/example.md b/docs/example.md' },
    metadata: {
      tool_plan_execution_verdict: 'applied',
      tool_plan_applied: true,
      tool_plan_dry_run: false,
    },
    ...overrides,
  };
}

function deps() {
  return {
    retryManager: {
      classifyFromResult: vi.fn(() => 'non_retryable_logic'),
      shouldRetry: vi.fn(() => false),
      getDefaultMaxRetries: vi.fn(() => 3),
      calculateBackoff: vi.fn(() => 1),
    } as unknown as RetryManager,
    doomLoopDetector: {
      detectLoop: vi.fn(() => null),
    } as unknown as DoomLoopDetector,
    leaseManager: {
      release: vi.fn(),
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
    } as unknown as StateMachine,
  };
}

function context() {
  const transitions: StateTransitionEvent[] = [];
  const auditEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  return {
    transitions,
    auditEvents,
    context: {
      transitionTask: vi.fn((inputTask: Task, toState: TaskState, input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>) => {
        const event: StateTransitionEvent = {
          event_id: `evt_${transitions.length}`,
          task_id: inputTask.task_id,
          from_state: inputTask.state,
          to_state: toState,
          occurred_at: '2026-06-22T00:00:00.000Z',
          ...input,
        };
        transitions.push(event);
        return { event, task: { ...inputTask, state: toState } };
      }),
      emitAuditEvent: vi.fn((_taskId: string, eventType: string, payload: Record<string, unknown>) => {
        auditEvents.push({ eventType, payload });
      }),
    },
  };
}

describe('run system gate', () => {
  it('keeps advisory mode non-blocking while surfacing conditional gate evidence', () => {
    const packet = buildRunSystemPacket(task(), job(), result());
    const report = evaluateRunSystemGate(packet);

    expect(report.mode).toBe('advisory');
    expect(report.gatefield.verdict).toBe('hold');
    expect(report.agent_state_gate.verdict).toBe('needs_approval');
    expect(report.manual_bb.required).toBe(true);
    expect(report.blocks_shipyard_transition).toBe(false);
    expect(report.qeg.expected_verdict).toBe('conditional_go');
  });

  it('blocks enforce mode when applied tool_plan still needs acceptance', () => {
    const orchestrator = new ResultOrchestrator(deps(), { runSystemMode: 'enforce' });
    const ctx = context();

    const response = orchestrator.applyResult(result(), task(), job(), new Map(), ctx.context);

    expect(response.next_action).toBe('wait_manual');
    expect(response.task.state).toBe('blocked');
    expect(response.taskUpdates.blocked_context).toMatchObject({
      waiting_on: 'human',
    });
    expect(ctx.auditEvents.some(event => event.eventType === 'run.systemGateEvaluated')).toBe(true);
    expect(ctx.auditEvents.some(event => event.eventType === 'run.systemGateBlocked')).toBe(true);
  });

  it('allows enforce mode when QEG/manual-bb inputs are clean', () => {
    const orchestrator = new ResultOrchestrator(deps(), { runSystemMode: 'enforce' });
    const ctx = context();

    const response = orchestrator.applyResult(
      result({
        artifacts: [],
        metadata: undefined,
      }),
      task(),
      job(),
      new Map(),
      ctx.context,
    );

    expect(response.next_action).toBe('dispatch_acceptance');
    expect(response.task.state).toBe('dev_completed');
    expect(ctx.auditEvents.find(event => event.eventType === 'run.systemGateEvaluated')?.payload).toMatchObject({
      qeg: { expected_verdict: 'go' },
      blocks_shipyard_transition: false,
    });
  });

  it('blocks enforce mode when external state gate CLI returns deny', () => {
    const externalCliAdapter: RunSystemCliAdapter = {
      run(packet) {
        return {
          schema_version: '1.0',
          invoked: true,
          mode: packet.mode,
          results: [
            {
              system: 'agent-state-gate',
              command: 'agent-state-gate gate evaluate',
              cwd: 'C:/repo/agent-state-gate',
              exit_code: 0,
              status: 'passed',
              stdout: '{"verdict":"deny"}',
              stderr: '',
              parsed_json: { verdict: 'deny' },
              summary: 'deny',
            },
          ],
          state_gate_verdict: 'deny',
          blockers: [],
          residual_risks: [],
        };
      },
    };
    const orchestrator = new ResultOrchestrator(deps(), {
      runSystemMode: 'enforce',
      externalCliAdapter,
    });
    const ctx = context();

    const response = orchestrator.applyResult(
      result({
        artifacts: [],
        metadata: undefined,
      }),
      task(),
      job(),
      new Map(),
      ctx.context,
    );

    expect(response.next_action).toBe('wait_manual');
    expect(response.task.state).toBe('blocked');
    expect(ctx.auditEvents.some(event => event.eventType === 'run.externalCliGateEvaluated')).toBe(true);
    expect(ctx.auditEvents.some(event => event.eventType === 'run.systemGateBlocked')).toBe(true);
  });
});
