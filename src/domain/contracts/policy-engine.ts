/**
 * Policy Engine for agent-protocols approval flow.
 * Handles risk assessment, PublishGate creation, and approval decisions.
 */

import type {
  Capability,
  RiskLevel,
  ApprovalRole,
  PublishGate,
  Acceptance,
  ApprovalRecord,
  FinalDecision,
  ContractState,
} from './types.js';
import { deriveRiskLevel, deriveGenerationPolicy } from './orchestrator.js';

// Policy configuration
export const POLICY_CONFIG = {
  // Risk level thresholds
  riskThresholds: {
    low: { requiresApproval: false },
    medium: { requiresApproval: false },
    high: { requiresApproval: true, approvalDeadlineHours: 24 },
    critical: { requiresApproval: true, approvalDeadlineHours: 48 },
  },
  // Required approvals by risk level
  requiredApprovals: {
    low: [] as ApprovalRole[],
    medium: [] as ApprovalRole[],
    high: ['project_lead', 'security_reviewer'] as ApprovalRole[],
    critical: ['project_lead', 'security_reviewer', 'release_manager'] as ApprovalRole[],
  },
  // Approval deadline hours by risk level
  deadlineHours: {
    low: 0,
    medium: 0,
    high: 24,
    critical: 48,
  },
};

// Risk factors for assessment
export interface RiskFactors {
  productionDataAccess?: boolean;
  externalSecretTransmission?: boolean;
  legalConcern?: boolean;
  rollbackImpossible?: boolean;
}

// Policy assessment result
export interface PolicyAssessment {
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  requiredApprovals: ApprovalRole[];
  approvalDeadline?: string;
  autoApproved: boolean;
}

/**
 * Policy Engine class
 */
export class PolicyEngine {
  /**
   * Assess risk and determine approval requirements
   */
  assessPolicy(capabilities: Capability[], riskFactors?: RiskFactors): PolicyAssessment {
    const riskLevel = deriveRiskLevel(capabilities, riskFactors);
    const config = POLICY_CONFIG.riskThresholds[riskLevel];
    const requiredApprovals = POLICY_CONFIG.requiredApprovals[riskLevel];

    const autoApproved = !config.requiresApproval;
    const approvalDeadline = config.requiresApproval
      ? new Date(Date.now() + POLICY_CONFIG.deadlineHours[riskLevel] * 60 * 60 * 1000).toISOString()
      : undefined;

    return {
      riskLevel,
      requiresApproval: config.requiresApproval,
      requiredApprovals,
      approvalDeadline,
      autoApproved,
    };
  }

  /**
   * Create PublishGate from Acceptance
   */
  createPublishGate(
    acceptance: Acceptance,
    capabilities: Capability[],
    riskFactors?: RiskFactors
  ): PublishGate {
    const assessment = this.assessPolicy(capabilities, riskFactors);
    const now = new Date().toISOString();

    const gate: PublishGate = {
      schemaVersion: '1.0.0',
      id: this.generateId('PG'),
      kind: 'PublishGate',
      state: assessment.autoApproved ? 'Published' : 'Active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      entityId: acceptance.id,
      action: 'publish',
      riskLevel: assessment.riskLevel,
      requiredApprovals: assessment.requiredApprovals,
      approvals: assessment.autoApproved
        ? [
            {
              role: 'policy_engine',
              actorId: 'policy-engine',
              decision: 'approved',
              decidedAt: now,
            },
          ]
        : [],
      finalDecision: assessment.autoApproved ? 'approved' : 'pending',
      approvalDeadline: assessment.approvalDeadline,
    };

    return gate;
  }

  /**
   * Record an approval decision
   */
  recordApproval(
    gate: PublishGate,
    approval: Omit<ApprovalRecord, 'decidedAt'> & { decidedAt?: string }
  ): PublishGate {
    const now = new Date().toISOString();
    const newApproval: ApprovalRecord = {
      ...approval,
      decidedAt: approval.decidedAt || now,
    };

    const updatedApprovals = [...gate.approvals, newApproval];

    // Check if all required approvals are met
    const approvedRoles = new Set(
      updatedApprovals
        .filter((a) => a.decision === 'approved')
        .map((a) => a.role)
    );

    let finalDecision: FinalDecision = gate.finalDecision;
    let state: ContractState = gate.state;

    // If any rejection, mark as rejected
    if (newApproval.decision === 'rejected') {
      finalDecision = 'rejected';
      state = 'Published'; // Published as rejected
    } else if (this.checkAllApprovalsMet(gate.requiredApprovals, approvedRoles)) {
      finalDecision = 'approved';
      state = 'Published';
    }

    const updatedGate: PublishGate = {
      ...gate,
      approvals: updatedApprovals,
      finalDecision,
      state,
      updatedAt: now,
      version: gate.version + 1,
    };

    return updatedGate;
  }

  /**
   * Check if deadline has expired
   */
  checkDeadlineExpiry(gate: PublishGate): PublishGate {
    if (gate.finalDecision !== 'pending') {
      return gate;
    }

    if (!gate.approvalDeadline) {
      return gate;
    }

    const now = new Date();
    const deadline = new Date(gate.approvalDeadline);

    if (now > deadline) {
      return {
        ...gate,
        finalDecision: 'expired',
        state: 'Frozen',
        updatedAt: now.toISOString(),
        version: gate.version + 1,
      };
    }

    return gate;
  }

  /**
   * Check if all required approvals are met
   */
  private checkAllApprovalsMet(
    requiredApprovals: ApprovalRole[],
    approvedRoles: Set<string>
  ): boolean {
    for (const required of requiredApprovals) {
      if (!approvedRoles.has(required)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Generate ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${String(Date.now()).slice(-6)}`;
  }
}

/**
 * Determine execution role based on capabilities
 */
export function determineExecutionRole(capabilities: Capability[]): 'developer' | 'ci_agent' {
  const hasInstallDeps = capabilities.includes('install_deps');
  const hasNetworkAccess = capabilities.includes('network_access');

  if (hasInstallDeps || hasNetworkAccess) {
    return 'ci_agent';
  }

  return 'developer';
}

/**
 * Check if capability is granted for role
 */
export function isCapabilityGranted(
  role: string,
  capability: Capability,
  capabilityMatrix: Record<string, Capability[]>
): boolean {
  const grantedCapabilities = capabilityMatrix[role] || [];
  return grantedCapabilities.includes(capability);
}

// Default capability matrix
export const DEFAULT_CAPABILITY_MATRIX: Record<string, Capability[]> = {
  requester: ['read_repo'],
  orchestrator: [],
  policy_engine: [],
  developer: ['read_repo', 'write_repo'],
  ci_agent: ['read_repo', 'write_repo', 'install_deps', 'network_access'],
  qa: ['read_repo', 'write_repo'],
  project_lead: ['read_repo', 'write_repo'],
  release_manager: ['read_repo', 'write_repo', 'publish_release'],
  security_reviewer: ['read_repo', 'read_secrets'],
  admin: ['read_repo', 'write_repo', 'install_deps', 'network_access', 'read_secrets', 'publish_release'],
};