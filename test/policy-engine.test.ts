import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PolicyEngine,
  POLICY_CONFIG,
  determineExecutionRole,
  isCapabilityGranted,
  DEFAULT_CAPABILITY_MATRIX,
  type RiskFactors,
  type Acceptance,
} from '../src/domain/contracts/index.js';

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  const createAcceptance = (): Acceptance => ({
    schemaVersion: '1.0.0',
    id: 'AC-001',
    kind: 'Acceptance',
    state: 'Active',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskSeedId: 'TS-001',
    status: 'passed',
    details: 'All criteria met',
    criteria: ['test1'],
    generationPolicy: { auto_activate: true, requiredActivationApprovals: [] },
  });

  describe('assessPolicy', () => {
    it('should return low risk for read_repo only', () => {
      const assessment = engine.assessPolicy(['read_repo']);
      expect(assessment.riskLevel).toBe('low');
      expect(assessment.requiresApproval).toBe(false);
      expect(assessment.autoApproved).toBe(true);
    });

    it('should return medium risk for write_repo', () => {
      const assessment = engine.assessPolicy(['read_repo', 'write_repo']);
      expect(assessment.riskLevel).toBe('medium');
      expect(assessment.requiresApproval).toBe(false);
      expect(assessment.autoApproved).toBe(true);
    });

    it('should return high risk for install_deps', () => {
      const assessment = engine.assessPolicy(['install_deps']);
      expect(assessment.riskLevel).toBe('high');
      expect(assessment.requiresApproval).toBe(true);
      expect(assessment.autoApproved).toBe(false);
      expect(assessment.requiredApprovals).toContain('project_lead');
      expect(assessment.requiredApprovals).toContain('security_reviewer');
      expect(assessment.approvalDeadline).toBeDefined();
    });

    it('should return high risk for network_access', () => {
      const assessment = engine.assessPolicy(['network_access']);
      expect(assessment.riskLevel).toBe('high');
      expect(assessment.requiresApproval).toBe(true);
    });

    it('should return high risk for read_secrets', () => {
      const assessment = engine.assessPolicy(['read_secrets']);
      expect(assessment.riskLevel).toBe('high');
    });

    it('should return high risk for publish_release', () => {
      const assessment = engine.assessPolicy(['publish_release']);
      expect(assessment.riskLevel).toBe('high');
    });

    it('should return critical risk for production data access', () => {
      const riskFactors: RiskFactors = { productionDataAccess: true };
      const assessment = engine.assessPolicy(['read_repo'], riskFactors);
      expect(assessment.riskLevel).toBe('critical');
      expect(assessment.requiresApproval).toBe(true);
      expect(assessment.requiredApprovals).toContain('release_manager');
    });

    it('should return critical risk for external secret transmission', () => {
      const riskFactors: RiskFactors = { externalSecretTransmission: true };
      const assessment = engine.assessPolicy(['read_repo'], riskFactors);
      expect(assessment.riskLevel).toBe('critical');
    });

    it('should return critical risk for legal concern', () => {
      const riskFactors: RiskFactors = { legalConcern: true };
      const assessment = engine.assessPolicy(['read_repo'], riskFactors);
      expect(assessment.riskLevel).toBe('critical');
    });

    it('should return critical risk for rollback impossible', () => {
      const riskFactors: RiskFactors = { rollbackImpossible: true };
      const assessment = engine.assessPolicy(['read_repo'], riskFactors);
      expect(assessment.riskLevel).toBe('critical');
    });
  });

  describe('createPublishGate', () => {
    it('should create auto-approved gate for low risk', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['read_repo']);

      expect(gate.riskLevel).toBe('low');
      expect(gate.requiredApprovals).toEqual([]);
      expect(gate.finalDecision).toBe('approved');
      expect(gate.state).toBe('Published');
      expect(gate.approvals).toHaveLength(1);
      expect(gate.approvals[0].role).toBe('policy_engine');
    });

    it('should create auto-approved gate for medium risk', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['read_repo', 'write_repo']);

      expect(gate.riskLevel).toBe('medium');
      expect(gate.requiredApprovals).toEqual([]);
      expect(gate.finalDecision).toBe('approved');
    });

    it('should create pending gate for high risk', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['install_deps']);

      expect(gate.riskLevel).toBe('high');
      expect(gate.requiredApprovals).toContain('project_lead');
      expect(gate.requiredApprovals).toContain('security_reviewer');
      expect(gate.finalDecision).toBe('pending');
      expect(gate.state).toBe('Active');
      expect(gate.approvalDeadline).toBeDefined();
      expect(gate.approvals).toHaveLength(0);
    });

    it('should create pending gate for critical risk', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['read_repo'], { productionDataAccess: true });

      expect(gate.riskLevel).toBe('critical');
      expect(gate.requiredApprovals).toContain('project_lead');
      expect(gate.requiredApprovals).toContain('security_reviewer');
      expect(gate.requiredApprovals).toContain('release_manager');
      expect(gate.finalDecision).toBe('pending');
    });
  });

  describe('recordApproval', () => {
    it('should record approval and keep pending if not all approvals met', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['install_deps']);

      const updatedGate = engine.recordApproval(gate, {
        role: 'project_lead',
        actorId: 'lead-001',
        decision: 'approved',
      });

      expect(updatedGate.approvals).toHaveLength(1);
      expect(updatedGate.finalDecision).toBe('pending'); // Still need security_reviewer
    });

    it('should approve when all required approvals are met', () => {
      const acceptance = createAcceptance();
      let gate = engine.createPublishGate(acceptance, ['install_deps']);

      gate = engine.recordApproval(gate, {
        role: 'project_lead',
        actorId: 'lead-001',
        decision: 'approved',
      });

      gate = engine.recordApproval(gate, {
        role: 'security_reviewer',
        actorId: 'security-001',
        decision: 'approved',
      });

      expect(gate.finalDecision).toBe('approved');
      expect(gate.state).toBe('Published');
    });

    it('should reject on any rejection', () => {
      const acceptance = createAcceptance();
      let gate = engine.createPublishGate(acceptance, ['install_deps']);

      gate = engine.recordApproval(gate, {
        role: 'project_lead',
        actorId: 'lead-001',
        decision: 'rejected',
        reason: 'Security concerns',
      });

      expect(gate.finalDecision).toBe('rejected');
      expect(gate.state).toBe('Published');
    });

    it('should increment version on each approval', () => {
      const acceptance = createAcceptance();
      let gate = engine.createPublishGate(acceptance, ['install_deps']);

      expect(gate.version).toBe(1);

      gate = engine.recordApproval(gate, {
        role: 'project_lead',
        actorId: 'lead-001',
        decision: 'approved',
      });

      expect(gate.version).toBe(2);

      gate = engine.recordApproval(gate, {
        role: 'security_reviewer',
        actorId: 'security-001',
        decision: 'approved',
      });

      expect(gate.version).toBe(3);
    });
  });

  describe('checkDeadlineExpiry', () => {
    it('should not change gate that is already decided', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['read_repo']);

      const checkedGate = engine.checkDeadlineExpiry(gate);
      expect(checkedGate.finalDecision).toBe('approved');
    });

    it('should mark gate as expired if deadline passed', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['install_deps']);

      // Manually set deadline to past
      gate.approvalDeadline = new Date(Date.now() - 1000).toISOString();

      const checkedGate = engine.checkDeadlineExpiry(gate);

      expect(checkedGate.finalDecision).toBe('expired');
      expect(checkedGate.state).toBe('Frozen');
    });

    it('should not expire if deadline not passed', () => {
      const acceptance = createAcceptance();
      const gate = engine.createPublishGate(acceptance, ['install_deps']);

      const checkedGate = engine.checkDeadlineExpiry(gate);

      expect(checkedGate.finalDecision).toBe('pending');
    });
  });
});

describe('POLICY_CONFIG', () => {
  it('should have correct risk thresholds', () => {
    expect(POLICY_CONFIG.riskThresholds.low.requiresApproval).toBe(false);
    expect(POLICY_CONFIG.riskThresholds.medium.requiresApproval).toBe(false);
    expect(POLICY_CONFIG.riskThresholds.high.requiresApproval).toBe(true);
    expect(POLICY_CONFIG.riskThresholds.critical.requiresApproval).toBe(true);
  });

  it('should have correct required approvals', () => {
    expect(POLICY_CONFIG.requiredApprovals.low).toEqual([]);
    expect(POLICY_CONFIG.requiredApprovals.medium).toEqual([]);
    expect(POLICY_CONFIG.requiredApprovals.high).toContain('security_reviewer');
    expect(POLICY_CONFIG.requiredApprovals.critical).toContain('release_manager');
  });

  it('should have correct deadline hours', () => {
    expect(POLICY_CONFIG.deadlineHours.low).toBe(0);
    expect(POLICY_CONFIG.deadlineHours.medium).toBe(0);
    expect(POLICY_CONFIG.deadlineHours.high).toBe(24);
    expect(POLICY_CONFIG.deadlineHours.critical).toBe(48);
  });
});

describe('determineExecutionRole', () => {
  it('should return ci_agent for install_deps', () => {
    expect(determineExecutionRole(['install_deps'])).toBe('ci_agent');
  });

  it('should return ci_agent for network_access', () => {
    expect(determineExecutionRole(['network_access'])).toBe('ci_agent');
  });

  it('should return developer for read_repo only', () => {
    expect(determineExecutionRole(['read_repo'])).toBe('developer');
  });

  it('should return developer for read_repo + write_repo', () => {
    expect(determineExecutionRole(['read_repo', 'write_repo'])).toBe('developer');
  });
});

describe('isCapabilityGranted', () => {
  it('should return true for granted capability', () => {
    expect(isCapabilityGranted('developer', 'read_repo', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('developer', 'write_repo', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
  });

  it('should return false for not granted capability', () => {
    expect(isCapabilityGranted('developer', 'install_deps', DEFAULT_CAPABILITY_MATRIX)).toBe(false);
    expect(isCapabilityGranted('developer', 'network_access', DEFAULT_CAPABILITY_MATRIX)).toBe(false);
  });

  it('should grant all capabilities to admin', () => {
    expect(isCapabilityGranted('admin', 'read_repo', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'write_repo', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'install_deps', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'network_access', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'read_secrets', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'publish_release', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
  });

  it('should grant read_secrets only to security_reviewer and admin', () => {
    expect(isCapabilityGranted('security_reviewer', 'read_secrets', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'read_secrets', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('developer', 'read_secrets', DEFAULT_CAPABILITY_MATRIX)).toBe(false);
  });

  it('should grant publish_release only to release_manager and admin', () => {
    expect(isCapabilityGranted('release_manager', 'publish_release', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('admin', 'publish_release', DEFAULT_CAPABILITY_MATRIX)).toBe(true);
    expect(isCapabilityGranted('developer', 'publish_release', DEFAULT_CAPABILITY_MATRIX)).toBe(false);
  });
});

describe('DEFAULT_CAPABILITY_MATRIX', () => {
  it('should have orchestrator with no capabilities', () => {
    expect(DEFAULT_CAPABILITY_MATRIX.orchestrator).toEqual([]);
  });

  it('should have policy_engine with no capabilities', () => {
    expect(DEFAULT_CAPABILITY_MATRIX.policy_engine).toEqual([]);
  });

  it('should grant ci_agent necessary capabilities', () => {
    expect(DEFAULT_CAPABILITY_MATRIX.ci_agent).toContain('install_deps');
    expect(DEFAULT_CAPABILITY_MATRIX.ci_agent).toContain('network_access');
  });
});