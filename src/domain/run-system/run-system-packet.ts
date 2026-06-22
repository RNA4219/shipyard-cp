import type { Task, WorkerJob, WorkerResult } from '../../types.js';

export type RunSystemMode = 'advisory' | 'enforce';

export interface RunSystemPacket {
  schema_version: '1.0';
  mode: RunSystemMode;
  run: {
    run_ref: string;
    task_ref: string;
    job_ref: string;
    task_id: string;
    job_id: string;
    stage: WorkerJob['stage'];
    worker_type: WorkerJob['worker_type'];
    result_status: WorkerResult['status'];
  };
  contract_refs: {
    intent_contract_ref: string;
    task_seed_ref: string;
    acceptance_ref?: string;
    evidence_ref: string;
  };
  agent_protocols: {
    flow: 'IntentContract -> TaskSeed -> Acceptance -> PublishGate -> Evidence';
    evidence_candidate: {
      kind: 'Evidence';
      state: 'Published';
      taskSeedId: string;
      inputHash: string;
      outputHash: string;
      runtimeMs: number;
      exitCode?: number;
    };
  };
  agent_taskstate: {
    task_ref: string;
    run_ref: string;
    current_state: Task['state'];
    context_bundle_ref?: string;
    resolver_refs: Task['resolver_refs'];
    external_refs: Task['external_refs'];
  };
  agent_gatefield: {
    profile: 'standard';
    decision_input: {
      run_id: string;
      artifact_count: number;
      test_summary: {
        passed: number;
        failed: number;
        skipped: number;
        not_run: number;
      };
      requested_escalation_count: number;
      side_effects: string[];
      has_patch: boolean;
      has_branch: boolean;
      worker_status: WorkerResult['status'];
      tool_plan?: ToolPlanRunSummary;
    };
  };
  agent_state_gate: {
    assessment_input: {
      run_ref: string;
      task_ref: string;
      evidence_refs: string[];
      decision_packet_ref?: string;
      context_bundle_ref?: string;
      expected_verdicts: Array<'allow' | 'revise' | 'needs_approval' | 'require_human' | 'stale_blocked' | 'deny'>;
    };
  };
  invariants: string[];
}

export interface BuildRunSystemPacketOptions {
  mode?: RunSystemMode;
}

export type ToolPlanExecutionVerdict = 'executed' | 'applied' | 'skipped' | 'failed' | 'dry_run';

export interface ToolPlanRunSummary {
  execution_verdict: ToolPlanExecutionVerdict;
  dry_run: boolean;
  operations?: string;
  workspace_root?: string | null;
  artifact_paths?: string;
  errors?: string;
  acceptance_gate_required: boolean;
}

export function buildRunSystemPacket(
  task: Task,
  job: WorkerJob,
  result: WorkerResult,
  options: BuildRunSystemPacketOptions = {},
): RunSystemPacket {
  const mode = options.mode ?? 'advisory';
  const taskRef = task.typed_ref || typedRef('agent-taskstate', 'task', task.task_id);
  const runRef = typedRef('agent-taskstate', 'run', job.job_id);
  const jobRef = typedRef('shipyard-cp', 'worker_job', job.worker_type, job.job_id);
  const intentRef = typedRef('agent-protocols', 'intent_contract', task.task_id);
  const taskSeedRef = typedRef('agent-protocols', 'task_seed', job.job_id);
  const evidenceRef = typedRef('agent-protocols', 'evidence', `${job.job_id}-${result.status}`);
  const acceptanceRef = job.stage === 'acceptance'
    ? typedRef('agent-protocols', 'acceptance', job.job_id)
    : undefined;

  return {
    schema_version: '1.0',
    mode,
    run: {
      run_ref: runRef,
      task_ref: taskRef,
      job_ref: jobRef,
      task_id: task.task_id,
      job_id: job.job_id,
      stage: job.stage,
      worker_type: job.worker_type,
      result_status: result.status,
    },
    contract_refs: {
      intent_contract_ref: intentRef,
      task_seed_ref: taskSeedRef,
      acceptance_ref: acceptanceRef,
      evidence_ref: evidenceRef,
    },
    agent_protocols: {
      flow: 'IntentContract -> TaskSeed -> Acceptance -> PublishGate -> Evidence',
      evidence_candidate: {
        kind: 'Evidence',
        state: 'Published',
        taskSeedId: taskSeedRef,
        inputHash: stableToken(job.input_prompt),
        outputHash: stableToken(result.summary ?? result.status),
        runtimeMs: result.usage.runtime_ms,
        exitCode: result.usage.exit_code,
      },
    },
    agent_taskstate: {
      task_ref: taskRef,
      run_ref: runRef,
      current_state: task.state,
      context_bundle_ref: result.context_bundle_ref ?? task.context_bundle_ref,
      resolver_refs: result.resolver_refs ?? task.resolver_refs,
      external_refs: result.external_refs ?? task.external_refs,
    },
    agent_gatefield: {
      profile: 'standard',
      decision_input: {
        run_id: job.job_id,
        artifact_count: result.artifacts.length,
        test_summary: summarizeTests(result),
        requested_escalation_count: result.requested_escalations.length,
        side_effects: result.detected_side_effects ?? task.detected_side_effects ?? [],
        has_patch: Boolean(result.patch_ref),
        has_branch: Boolean(result.branch_ref),
        worker_status: result.status,
        tool_plan: buildToolPlanRunSummary(result),
      },
    },
    agent_state_gate: {
      assessment_input: {
        run_ref: runRef,
        task_ref: taskRef,
        evidence_refs: [evidenceRef],
        context_bundle_ref: result.context_bundle_ref ?? task.context_bundle_ref,
        expected_verdicts: ['allow', 'revise', 'needs_approval', 'require_human', 'stale_blocked', 'deny'],
      },
    },
    invariants: [
      'agent-taskstate owns Task, Run, ContextBundle, and typed_ref state.',
      'agent-protocols owns IntentContract, TaskSeed, Acceptance, PublishGate, and Evidence contracts.',
      'agent-gatefield owns DecisionPacket pass|warn|hold|block scoring.',
      'agent-state-gate owns final allow|revise|needs_approval|require_human|stale_blocked|deny assessment.',
      'shipyard-cp remains the Run state-machine owner and records this packet as advisory evidence until enforce mode is explicitly enabled.',
    ],
  };
}

function buildToolPlanRunSummary(result: WorkerResult): ToolPlanRunSummary | undefined {
  const metadata = result.metadata;
  if (!metadata || !hasToolPlanMetadata(metadata)) {
    return undefined;
  }

  const executed = metadata.tool_plan_executed === true;
  const applied = metadata.tool_plan_applied === true;
  const errors = typeof metadata.tool_plan_errors === 'string' ? metadata.tool_plan_errors : undefined;
  const dryRun = metadata.tool_plan_dry_run === true;
  const explicitVerdict = typeof metadata.tool_plan_execution_verdict === 'string'
    ? metadata.tool_plan_execution_verdict
    : undefined;

  let executionVerdict: ToolPlanExecutionVerdict = 'skipped';
  if (isToolPlanExecutionVerdict(explicitVerdict)) {
    executionVerdict = explicitVerdict;
  } else if (dryRun) {
    executionVerdict = 'dry_run';
  } else if (result.status === 'failed' || errors) {
    executionVerdict = 'failed';
  } else if (applied) {
    executionVerdict = 'applied';
  } else if (executed) {
    executionVerdict = 'executed';
  }

  return {
    execution_verdict: executionVerdict,
    dry_run: dryRun,
    operations: typeof metadata.tool_plan_operations === 'string' ? metadata.tool_plan_operations : undefined,
    workspace_root: typeof metadata.tool_plan_workspace_root === 'string' || metadata.tool_plan_workspace_root === null
      ? metadata.tool_plan_workspace_root
      : undefined,
    artifact_paths: typeof metadata.tool_plan_artifact_paths === 'string'
      ? metadata.tool_plan_artifact_paths
      : undefined,
    errors,
    acceptance_gate_required: applied || executionVerdict === 'failed',
  };
}

function isToolPlanExecutionVerdict(value: string | undefined): value is ToolPlanExecutionVerdict {
  return value === 'executed' ||
    value === 'applied' ||
    value === 'skipped' ||
    value === 'failed' ||
    value === 'dry_run';
}

function hasToolPlanMetadata(metadata: NonNullable<WorkerResult['metadata']>): boolean {
  return Object.keys(metadata).some(key => key.startsWith('tool_plan_'));
}

function summarizeTests(result: WorkerResult): RunSystemPacket['agent_gatefield']['decision_input']['test_summary'] {
  const summary = { passed: 0, failed: 0, skipped: 0, not_run: 0 };
  for (const test of result.test_results) {
    if (test.status === 'passed') summary.passed += 1;
    if (test.status === 'failed') summary.failed += 1;
    if (test.status === 'skipped') summary.skipped += 1;
    if (test.status === 'not_run') summary.not_run += 1;
  }
  return summary;
}

function typedRef(domain: string, entityType: string, providerOrId: string, maybeId?: string): string {
  const provider = maybeId === undefined ? 'local' : providerOrId;
  const entityId = maybeId ?? providerOrId;
  return `${domain}:${entityType}:${provider}:${normalizeRefSegment(entityId)}`;
}

function normalizeRefSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function stableToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
