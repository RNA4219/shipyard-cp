import { describe, expect, it, vi } from 'vitest';
import { buildRunSystemPacket } from '../src/domain/run-system/run-system-packet.js';
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
    task_id: 'task_001',
    title: 'Run system integration',
    objective: 'Connect run evidence gates',
    typed_ref: 'agent-taskstate:task:local:task_001',
    state: 'developing',
    version: 1,
    risk_level: 'medium',
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
    job_id: 'job_001',
    task_id: 'task_001',
    typed_ref: 'agent-taskstate:task:local:task_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'completed',
    workspace_ref: {
      workspace_id: 'ws_001',
      kind: 'host_path',
      reusable: true,
    },
    input_prompt: 'Implement run system packet',
    repo_ref: {
      provider: 'github',
      owner: 'local',
      name: 'shipyard-cp',
      default_branch: 'main',
    },
    capability_requirements: ['edit_repo', 'run_tests'],
    risk_level: 'medium',
    approval_policy: {
      mode: 'ask',
      sandbox_profile: 'workspace_write',
    },
    ...overrides,
  };
}

function result(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    job_id: 'job_001',
    typed_ref: 'agent-taskstate:task:local:task_001',
    status: 'succeeded',
    summary: 'Implemented',
    artifacts: [
      { artifact_id: 'artifact_001', kind: 'json', uri: 'memory://result.json' },
    ],
    test_results: [
      { suite: 'unit', status: 'passed', passed: 3 },
      { suite: 'lint', status: 'skipped' },
    ],
    requested_escalations: [],
    usage: { runtime_ms: 1234, exit_code: 0 },
    patch_ref: { format: 'unified_diff', content: 'diff --git a/x b/x' },
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

describe('run system packet', () => {
  it('maps a WorkerResult into the four external system boundaries', () => {
    const packet = buildRunSystemPacket(task(), job(), result());

    expect(packet.mode).toBe('advisory');
    expect(packet.run.run_ref).toBe('agent-taskstate:run:local:job_001');
    expect(packet.contract_refs.evidence_ref).toBe('agent-protocols:evidence:local:job_001-succeeded');
    expect(packet.agent_protocols.flow).toBe('IntentContract -> TaskSeed -> Acceptance -> PublishGate -> Evidence');
    expect(packet.agent_protocols.evidence_candidate.state).toBe('Published');
    expect(packet.agent_taskstate.task_ref).toBe('agent-taskstate:task:local:task_001');
    expect(packet.agent_gatefield.profile).toBe('standard');
    expect(packet.agent_gatefield.decision_input.test_summary).toEqual({
      passed: 1,
      failed: 0,
      skipped: 1,
      not_run: 0,
    });
    expect(packet.agent_gatefield.decision_input.has_patch).toBe(true);
    expect(packet.agent_state_gate.assessment_input.expected_verdicts).toContain('allow');
    expect(packet.invariants).toContain(
      'agent-state-gate owns final allow|revise|needs_approval|require_human|stale_blocked|deny assessment.',
    );
  });

  it('passes GLM tool_plan execution verdict into gatefield input', () => {
    const packet = buildRunSystemPacket(
      task(),
      job(),
      result({
        metadata: {
          tool_plan_execution_verdict: 'applied',
          tool_plan_dry_run: false,
          tool_plan_executed: true,
          tool_plan_applied: true,
          tool_plan_operations: '[{"tool":"write_file","status":"applied","path":"docs/example.md"}]',
          tool_plan_artifact_paths: '["artifacts/jobs/job_001/tool-plan.json","artifacts/jobs/job_001/tool-plan.diff"]',
          tool_plan_workspace_root: 'repo',
        },
      }),
    );

    expect(packet.agent_gatefield.decision_input.tool_plan).toMatchObject({
      execution_verdict: 'applied',
      dry_run: false,
      acceptance_gate_required: true,
      artifact_paths: '["artifacts/jobs/job_001/tool-plan.json","artifacts/jobs/job_001/tool-plan.diff"]',
    });
  });

  it('keeps dry-run tool_plan results out of automatic acceptance gate requirement', () => {
    const packet = buildRunSystemPacket(
      task(),
      job(),
      result({
        metadata: {
          tool_plan_execution_verdict: 'dry_run',
          tool_plan_dry_run: true,
          tool_plan_executed: true,
          tool_plan_applied: false,
          tool_plan_operations: '[{"tool":"write_file","status":"planned","path":"docs/example.md"}]',
          tool_plan_workspace_root: 'repo',
        },
      }),
    );

    expect(packet.agent_gatefield.decision_input.tool_plan).toMatchObject({
      execution_verdict: 'dry_run',
      dry_run: true,
      acceptance_gate_required: false,
    });
  });

  it('emits an advisory run.systemPacketPrepared audit event while applying a valid result', () => {
    const orchestrator = new ResultOrchestrator(deps());
    const auditEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const transitions: StateTransitionEvent[] = [];
    const context = {
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
    };

    const response = orchestrator.applyResult(result(), task(), job(), new Map(), context);

    expect(response.next_action).toBe('dispatch_acceptance');
    const packetEvent = auditEvents.find((event) => event.eventType === 'run.systemPacketPrepared');
    expect(packetEvent).toBeDefined();
    expect(packetEvent?.payload.mode).toBe('advisory');
    expect(packetEvent?.payload.agent_gatefield).toMatchObject({
      profile: 'standard',
      decision_input: {
        run_id: 'job_001',
        artifact_count: 1,
        worker_status: 'succeeded',
      },
    });
  });
});
