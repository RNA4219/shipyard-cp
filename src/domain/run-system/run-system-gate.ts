import type { RunSystemPacket } from './run-system-packet.js';
import type { ExternalRunSystemCliReport } from './run-system-cli-adapter.js';

export type GatefieldVerdict = 'pass' | 'warn' | 'hold' | 'block';
export type StateGateVerdict = 'allow' | 'revise' | 'needs_approval' | 'require_human' | 'stale_blocked' | 'deny';

export interface RunSystemGateReport {
  schema_version: '1.0';
  mode: RunSystemPacket['mode'];
  gatefield: {
    verdict: GatefieldVerdict;
    reasons: string[];
  };
  agent_state_gate: {
    verdict: StateGateVerdict;
    reasons: string[];
  };
  manual_bb: {
    required: boolean;
    reason?: string;
  };
  qeg: {
    profile: 'standard';
    expected_verdict: 'go' | 'conditional_go' | 'no_go';
    blockers: string[];
    residual_risks: string[];
  };
  blocks_shipyard_transition: boolean;
}

export function evaluateRunSystemGate(packet: RunSystemPacket): RunSystemGateReport {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const residualRisks: string[] = [];
  const decisionInput = packet.agent_gatefield.decision_input;
  const toolPlan = decisionInput.tool_plan;

  let gatefieldVerdict: GatefieldVerdict = 'pass';
  let stateGateVerdict: StateGateVerdict = 'allow';
  let manualRequired = false;
  let manualReason: string | undefined;

  const raise = (
    gatefield: GatefieldVerdict,
    stateGate: StateGateVerdict,
    reason: string,
    options: { blocker?: boolean; residualRisk?: boolean; manual?: boolean } = {},
  ) => {
    gatefieldVerdict = maxGatefield(gatefieldVerdict, gatefield);
    stateGateVerdict = maxStateGate(stateGateVerdict, stateGate);
    reasons.push(reason);
    if (options.blocker) blockers.push(reason);
    if (options.residualRisk) residualRisks.push(reason);
    if (options.manual) {
      manualRequired = true;
      manualReason = manualReason ?? reason;
    }
  };

  if (decisionInput.worker_status === 'failed' || decisionInput.worker_status === 'blocked') {
    raise('block', 'deny', `worker result is ${decisionInput.worker_status}`, { blocker: true, manual: true });
  }

  if (decisionInput.test_summary.failed > 0) {
    raise('hold', 'revise', 'test failure requires rework before publish', { blocker: true });
  }

  if (decisionInput.requested_escalation_count > 0) {
    raise('hold', 'needs_approval', 'permission escalation requires approval evidence', { residualRisk: true, manual: true });
  }

  if (decisionInput.side_effects.length > 0) {
    raise('warn', 'needs_approval', 'side effects require explicit review', { residualRisk: true, manual: true });
  }

  if (toolPlan) {
    if (toolPlan.execution_verdict === 'failed') {
      raise('block', 'deny', 'tool_plan execution failed', { blocker: true, manual: true });
    }
    if (toolPlan.execution_verdict === 'skipped') {
      raise('warn', 'revise', 'tool_plan was skipped by policy or unsupported operation', { residualRisk: true });
    }
    if (toolPlan.dry_run) {
      raise('warn', 'revise', 'tool_plan dry-run must be applied and accepted before publish', { residualRisk: true });
    }
    if (toolPlan.acceptance_gate_required) {
      raise('hold', 'needs_approval', 'shipyard acceptance gate is required for applied tool_plan output', { manual: true });
    }
    if (toolPlan.errors) {
      raise('hold', 'revise', 'tool_plan reported execution errors', { blocker: true });
    }
  }

  const expectedVerdict = blockers.length > 0
    ? 'no_go'
    : residualRisks.length > 0 || manualRequired
      ? 'conditional_go'
      : 'go';

  return {
    schema_version: '1.0',
    mode: packet.mode,
    gatefield: {
      verdict: gatefieldVerdict,
      reasons,
    },
    agent_state_gate: {
      verdict: stateGateVerdict,
      reasons,
    },
    manual_bb: {
      required: manualRequired,
      reason: manualReason,
    },
    qeg: {
      profile: 'standard',
      expected_verdict: expectedVerdict,
      blockers,
      residual_risks: residualRisks,
    },
    blocks_shipyard_transition: packet.mode === 'enforce' && shouldBlock(gatefieldVerdict, stateGateVerdict),
  };
}

export function mergeExternalCliGateReport(
  report: RunSystemGateReport,
  external: ExternalRunSystemCliReport,
): RunSystemGateReport {
  const gatefieldVerdict = external.gatefield_decision
    ? maxGatefield(report.gatefield.verdict, external.gatefield_decision)
    : report.gatefield.verdict;
  const stateGateVerdict = external.state_gate_verdict
    ? maxStateGate(report.agent_state_gate.verdict, external.state_gate_verdict)
    : report.agent_state_gate.verdict;
  const externalReasons = [
    ...external.blockers.map(reason => `external CLI blocker: ${reason}`),
    ...external.residual_risks.map(reason => `external CLI residual risk: ${reason}`),
  ];
  const blockers = [...report.qeg.blockers, ...external.blockers];
  const residualRisks = [...report.qeg.residual_risks, ...external.residual_risks];
  const manualRequired = report.manual_bb.required || external.residual_risks.length > 0 || external.blockers.length > 0;
  const expectedVerdict = blockers.length > 0
    ? 'no_go'
    : residualRisks.length > 0 || manualRequired
      ? 'conditional_go'
      : 'go';

  return {
    ...report,
    gatefield: {
      verdict: gatefieldVerdict,
      reasons: [...report.gatefield.reasons, ...externalReasons],
    },
    agent_state_gate: {
      verdict: stateGateVerdict,
      reasons: [...report.agent_state_gate.reasons, ...externalReasons],
    },
    manual_bb: {
      required: manualRequired,
      reason: report.manual_bb.reason ?? external.blockers[0] ?? external.residual_risks[0],
    },
    qeg: {
      ...report.qeg,
      expected_verdict: expectedVerdict,
      blockers,
      residual_risks: residualRisks,
    },
    blocks_shipyard_transition: report.mode === 'enforce' && shouldBlock(gatefieldVerdict, stateGateVerdict),
  };
}

function maxGatefield(current: GatefieldVerdict, candidate: GatefieldVerdict): GatefieldVerdict {
  const order: Record<GatefieldVerdict, number> = {
    pass: 0,
    warn: 1,
    hold: 2,
    block: 3,
  };
  return order[candidate] > order[current] ? candidate : current;
}

function maxStateGate(current: StateGateVerdict, candidate: StateGateVerdict): StateGateVerdict {
  const order: Record<StateGateVerdict, number> = {
    allow: 0,
    revise: 1,
    needs_approval: 2,
    require_human: 3,
    stale_blocked: 4,
    deny: 5,
  };
  return order[candidate] > order[current] ? candidate : current;
}

function shouldBlock(gatefield: GatefieldVerdict, stateGate: StateGateVerdict): boolean {
  return gatefield === 'hold' || gatefield === 'block' || stateGate !== 'allow';
}
