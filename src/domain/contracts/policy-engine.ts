import {
  applyApproval,
  assessPolicy,
  createPublishGate,
  expireGate,
  type Acceptance,
  type ApprovalRecord,
  type Capability,
  type PublishGate,
  type RiskFactors,
} from '@rna4219/agent-protocols';

export { assessPolicy };

export class PolicyEngine {
  assessPolicy(capabilities: Capability[], riskFactors?: RiskFactors) {
    return assessPolicy(capabilities, riskFactors);
  }

  createPublishGate(acceptance: Acceptance, capabilities: Capability[], riskFactors?: RiskFactors): PublishGate {
    return createPublishGate(acceptance, capabilities, { riskFactors });
  }

  recordApproval(gate: PublishGate, approval: Omit<ApprovalRecord, 'decidedAt'> & { decidedAt?: string }): PublishGate {
    return applyApproval(gate, approval);
  }

  checkDeadlineExpiry(gate: PublishGate): PublishGate {
    if (gate.decision !== 'pending') return gate;
    return expireGate(gate);
  }
}
