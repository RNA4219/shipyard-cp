import type { ApprovalPolicy, Capability, RiskLevel, WorkerStage, WorkerType } from '../../types.js';

const DEFAULT_WORKERS: Record<WorkerStage, WorkerType> = {
  plan: 'codex',
  dev: 'codex',
  acceptance: 'claude_code',
};

// Failover order for each stage (null means no failover)
// Plan stage: codex → claude_code → google_antigravity
const FAILOVER_ORDER: Record<WorkerStage, WorkerType[] | null> = {
  plan: ['codex', 'claude_code', 'google_antigravity'],
  dev: null, // No failover
  acceptance: null, // No failover
};

export class WorkerPolicy {
  static getDefaultWorker(stage: WorkerStage): WorkerType {
    return DEFAULT_WORKERS[stage];
  }

  static buildApprovalPolicy(stage: WorkerStage, risk: RiskLevel): ApprovalPolicy {
    if (stage === 'plan') {
      return { mode: 'deny', sandbox_profile: 'read_only', operator_approval_required: false };
    }

    if (risk === 'high') {
      return {
        mode: 'ask',
        operator_approval_required: true,
        sandbox_profile: 'workspace_write',
        allowed_side_effect_categories: ['network_access'],
      };
    }

    return {
      mode: 'ask',
      operator_approval_required: false,
      sandbox_profile: 'workspace_write',
    };
  }

  static getCapabilityRequirements(stage: WorkerStage): Capability[] {
    switch (stage) {
      case 'plan':
        return ['plan'];
      case 'dev':
        return ['edit_repo', 'run_tests', 'produces_patch'];
      case 'acceptance':
        return ['run_tests', 'produces_verdict'];
    }
  }

  static getRequestedOutputs(stage: WorkerStage): Array<'patch' | 'branch' | 'tests' | 'verdict' | 'artifacts' | 'plan_notes' | 'resolver_refs'> {
    switch (stage) {
      case 'plan':
        return ['plan_notes', 'artifacts'];
      case 'dev':
        return ['patch', 'tests', 'artifacts'];
      case 'acceptance':
        return ['verdict', 'tests', 'artifacts'];
    }
  }

  /**
   * Check if a stage supports failover.
   */
  static canFailover(stage: WorkerStage): boolean {
    return FAILOVER_ORDER[stage] !== null;
  }

  /**
   * Get the next worker in the failover chain.
   * Returns null if no more workers to failover to.
   */
  static getFailoverWorker(stage: WorkerStage, currentWorker: WorkerType): WorkerType | null {
    const order = FAILOVER_ORDER[stage];
    if (!order) return null;

    const currentIndex = order.indexOf(currentWorker);
    if (currentIndex < 0 || currentIndex >= order.length - 1) {
      return null;  // Cannot failover further
    }
    return order[currentIndex + 1];
  }
}