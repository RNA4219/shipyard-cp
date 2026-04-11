import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContractOrchestrator,
  deriveGenerationPolicy,
  deriveRiskLevel,
  generateTaskSeed,
  generateAcceptance,
  generatePublishGate,
  generateEvidence,
  resetIdCounter,
  type IntentContract,
  type TaskSeed,
} from '../src/domain/contracts/index.js';

describe('ContractOrchestrator', () => {
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    orchestrator = new ContractOrchestrator();
    resetIdCounter();
  });

  describe('Idempotency', () => {
    it('should generate idempotency key correctly', () => {
      const key = ContractOrchestrator.generateIdempotencyKey('IC-001', 1, 'TaskSeed');
      expect(key).toBe('IC-001:1:TaskSeed');
    });

    it('should track idempotency', () => {
      const key = 'IC-001:1:TaskSeed';
      expect(orchestrator.isIdempotent(key)).toBe(false);

      orchestrator.idempotencyCache.set(key, 'TS-001');
      expect(orchestrator.isIdempotent(key)).toBe(true);
    });
  });

  describe('Event handling', () => {
    it('should emit and receive events', () => {
      const events: unknown[] = [];
      orchestrator.subscribe('intent.created.v1', (event) => {
        events.push(event);
      });

      orchestrator.emitEvent({
        eventType: 'intent.created.v1',
        timestamp: new Date().toISOString(),
        contractId: 'IC-001',
        contractKind: 'IntentContract',
        payload: {},
      });

      expect(events).toHaveLength(1);
    });
  });

  describe('State transitions', () => {
    it('should transition contract state', () => {
      const intent: IntentContract = {
        schemaVersion: '1.0.0',
        id: 'IC-001',
        kind: 'IntentContract',
        state: 'Draft',
        version: 1,
        createdAt: '2026-03-29T10:00:00.000Z',
        updatedAt: '2026-03-29T10:00:00.000Z',
        intent: 'Test intent',
        creator: 'user-001',
        priority: 'medium',
        requestedCapabilities: ['read_repo'],
      };

      orchestrator.storeContract(intent);
      const updated = orchestrator.transitionState(intent, 'Active');

      expect(updated.state).toBe('Active');
    });
  });
});

describe('deriveGenerationPolicy', () => {
  it('should auto-activate for read_repo only', () => {
    const policy = deriveGenerationPolicy(['read_repo']);
    expect(policy.auto_activate).toBe(true);
    expect(policy.requiredActivationApprovals).toEqual([]);
  });

  it('should auto-activate for read_repo + write_repo', () => {
    const policy = deriveGenerationPolicy(['read_repo', 'write_repo']);
    expect(policy.auto_activate).toBe(true);
    expect(policy.requiredActivationApprovals).toEqual([]);
  });

  it('should require approvals for install_deps', () => {
    const policy = deriveGenerationPolicy(['read_repo', 'install_deps']);
    expect(policy.auto_activate).toBe(false);
    expect(policy.requiredActivationApprovals).toContain('project_lead');
    expect(policy.requiredActivationApprovals).toContain('security_reviewer');
  });

  it('should require approvals for network_access', () => {
    const policy = deriveGenerationPolicy(['network_access']);
    expect(policy.auto_activate).toBe(false);
    expect(policy.requiredActivationApprovals).toContain('security_reviewer');
  });

  it('should require approvals for read_secrets', () => {
    const policy = deriveGenerationPolicy(['read_secrets']);
    expect(policy.auto_activate).toBe(false);
    expect(policy.requiredActivationApprovals).toContain('security_reviewer');
  });

  it('should require approvals for publish_release', () => {
    const policy = deriveGenerationPolicy(['publish_release']);
    expect(policy.auto_activate).toBe(false);
    expect(policy.requiredActivationApprovals).toContain('release_manager');
  });
});

describe('deriveRiskLevel', () => {
  it('should return low for read_repo only', () => {
    expect(deriveRiskLevel(['read_repo'])).toBe('low');
  });

  it('should return medium for write_repo', () => {
    expect(deriveRiskLevel(['read_repo', 'write_repo'])).toBe('medium');
  });

  it('should return high for install_deps', () => {
    expect(deriveRiskLevel(['install_deps'])).toBe('high');
  });

  it('should return high for network_access', () => {
    expect(deriveRiskLevel(['network_access'])).toBe('high');
  });

  it('should return high for read_secrets', () => {
    expect(deriveRiskLevel(['read_secrets'])).toBe('high');
  });

  it('should return high for publish_release', () => {
    expect(deriveRiskLevel(['publish_release'])).toBe('high');
  });

  it('should return critical for production data access', () => {
    expect(deriveRiskLevel(['read_repo'], { productionDataAccess: true })).toBe('critical');
  });

  it('should return critical for external secret transmission', () => {
    expect(deriveRiskLevel(['read_repo'], { externalSecretTransmission: true })).toBe('critical');
  });
});

describe('generateTaskSeed', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate TaskSeed from IntentContract', () => {
    const intent: IntentContract = {
      schemaVersion: '1.0.0',
      id: 'IC-001',
      kind: 'IntentContract',
      state: 'Active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intent: 'Implement feature',
      creator: 'user-001',
      priority: 'medium',
      requestedCapabilities: ['read_repo', 'write_repo'],
    };

    const taskSeed = generateTaskSeed(
      intent,
      'Implement authentication',
      ['Read code', 'Write code', 'Test'],
      'developer'
    );

    expect(taskSeed.kind).toBe('TaskSeed');
    expect(taskSeed.intentId).toBe('IC-001');
    expect(taskSeed.state).toBe('Active'); // auto_activate = true
    expect(taskSeed.requestedCapabilitiesSnapshot).toEqual(['read_repo', 'write_repo']);
    expect(taskSeed.generationPolicy.auto_activate).toBe(true);
  });

  it('should generate TaskSeed in Draft state for high-risk capabilities', () => {
    const intent: IntentContract = {
      schemaVersion: '1.0.0',
      id: 'IC-001',
      kind: 'IntentContract',
      state: 'Active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intent: 'Deploy to production',
      creator: 'user-001',
      priority: 'high',
      requestedCapabilities: ['read_repo', 'network_access'],
    };

    const taskSeed = generateTaskSeed(
      intent,
      'Deploy application',
      ['Build', 'Deploy'],
      'ci_agent'
    );

    expect(taskSeed.state).toBe('Draft'); // auto_activate = false
    expect(taskSeed.generationPolicy.auto_activate).toBe(false);
    expect(taskSeed.generationPolicy.requiredActivationApprovals.length).toBeGreaterThan(0);
  });
});

describe('generateAcceptance', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate Acceptance from TaskSeed', () => {
    const taskSeed: TaskSeed = {
      schemaVersion: '1.0.0',
      id: 'TS-001',
      kind: 'TaskSeed',
      state: 'Active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intentId: 'IC-001',
      description: 'Test task',
      ownerRole: 'developer',
      executionPlan: ['step1'],
      requestedCapabilitiesSnapshot: ['read_repo'],
      generationPolicy: { auto_activate: true, requiredActivationApprovals: [] },
    };

    const acceptance = generateAcceptance(
      taskSeed,
      'passed',
      'All tests passed',
      ['unit test', 'integration test']
    );

    expect(acceptance.kind).toBe('Acceptance');
    expect(acceptance.taskSeedId).toBe('TS-001');
    expect(acceptance.status).toBe('passed');
    expect(acceptance.state).toBe('Active');
  });
});

describe('generatePublishGate', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate auto-approved PublishGate for low risk', () => {
    const acceptance = {
      schemaVersion: '1.0.0',
      id: 'AC-001',
      kind: 'Acceptance' as const,
      state: 'Active' as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskSeedId: 'TS-001',
      status: 'passed' as const,
      details: 'Passed',
      criteria: ['test'],
      generationPolicy: { auto_activate: true, requiredActivationApprovals: [] },
    };

    const gate = generatePublishGate(acceptance, ['read_repo']);

    expect(gate.riskLevel).toBe('low');
    expect(gate.requiredApprovals).toEqual([]);
    expect(gate.finalDecision).toBe('approved');
    expect(gate.state).toBe('Published');
  });

  it('should generate pending PublishGate for high risk', () => {
    const acceptance = {
      schemaVersion: '1.0.0',
      id: 'AC-001',
      kind: 'Acceptance' as const,
      state: 'Active' as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskSeedId: 'TS-001',
      status: 'passed' as const,
      details: 'Passed',
      criteria: ['test'],
      generationPolicy: { auto_activate: false, requiredActivationApprovals: ['project_lead'] },
    };

    const gate = generatePublishGate(acceptance, ['install_deps']);

    expect(gate.riskLevel).toBe('high');
    expect(gate.requiredApprovals).toContain('project_lead');
    expect(gate.requiredApprovals).toContain('security_reviewer');
    expect(gate.finalDecision).toBe('pending');
    expect(gate.approvalDeadline).toBeDefined();
    expect(gate.state).toBe('Active');
  });

  it('should generate pending PublishGate for critical risk', () => {
    const acceptance = {
      schemaVersion: '1.0.0',
      id: 'AC-001',
      kind: 'Acceptance' as const,
      state: 'Active' as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskSeedId: 'TS-001',
      status: 'passed' as const,
      details: 'Passed',
      criteria: ['test'],
      generationPolicy: { auto_activate: false, requiredActivationApprovals: ['project_lead'] },
    };

    const gate = generatePublishGate(acceptance, ['read_repo'], { productionDataAccess: true });

    expect(gate.riskLevel).toBe('critical');
    expect(gate.requiredApprovals).toContain('release_manager');
    expect(gate.finalDecision).toBe('pending');
  });
});

describe('generateEvidence', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate Evidence with state Published', () => {
    const taskSeed: TaskSeed = {
      schemaVersion: '1.0.0',
      id: 'TS-001',
      kind: 'TaskSeed',
      state: 'Active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intentId: 'IC-001',
      description: 'Test',
      ownerRole: 'developer',
      executionPlan: ['step1'],
      requestedCapabilitiesSnapshot: ['read_repo'],
      generationPolicy: { auto_activate: true, requiredActivationApprovals: [] },
    };

    const evidence = generateEvidence(taskSeed, {
      baseCommit: 'abc1234',
      headCommit: 'def5678',
      inputHash: 'sha256:input',
      outputHash: 'sha256:output',
      model: {
        name: 'claude-sonnet-4-6',
        version: '20250514',
        parametersHash: 'sha256:params',
      },
      tools: ['Read', 'Edit'],
      environment: {
        os: 'Linux',
        runtime: 'Node.js 20',
        containerImageDigest: 'sha256:container',
        lockfileHash: 'sha256:lock',
      },
      startTime: '2026-03-29T08:00:00Z',
      endTime: '2026-03-29T09:00:00Z',
      actor: 'developer-001',
      policyVerdict: 'approved',
      diffHash: 'sha256:diff',
    });

    expect(evidence.kind).toBe('Evidence');
    expect(evidence.state).toBe('Published');
    expect(evidence.taskSeedId).toBe('TS-001');
    expect(evidence.staleStatus.classification).toBe('fresh');
  });
});

describe('Full Contract Flow', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should execute full flow: IntentContract -> TaskSeed -> Acceptance -> PublishGate -> Evidence', () => {
    // 1. IntentContract
    const intent: IntentContract = {
      schemaVersion: '1.0.0',
      id: 'IC-001',
      kind: 'IntentContract',
      state: 'Active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intent: 'Add user authentication',
      creator: 'user-001',
      priority: 'medium',
      requestedCapabilities: ['read_repo', 'write_repo'],
    };

    // 2. Generate TaskSeed
    const taskSeed = generateTaskSeed(
      intent,
      'Implement authentication module',
      ['Read existing code', 'Implement auth', 'Add tests'],
      'developer'
    );

    expect(taskSeed.intentId).toBe('IC-001');
    expect(taskSeed.state).toBe('Active');

    // 3. Generate Acceptance
    const acceptance = generateAcceptance(
      taskSeed,
      'passed',
      'All tests passed successfully',
      ['Unit tests', 'Integration tests', 'Security scan']
    );

    expect(acceptance.taskSeedId).toBe(taskSeed.id);
    expect(acceptance.status).toBe('passed');

    // 4. Generate PublishGate
    const publishGate = generatePublishGate(
      acceptance,
      intent.requestedCapabilities
    );

    expect(publishGate.entityId).toBe(acceptance.id);
    expect(publishGate.riskLevel).toBe('medium');
    expect(publishGate.finalDecision).toBe('approved');

    // 5. Generate Evidence
    const evidence = generateEvidence(taskSeed, {
      baseCommit: 'abc1234',
      headCommit: 'def5678',
      inputHash: 'sha256:input',
      outputHash: 'sha256:output',
      model: {
        name: 'claude-sonnet-4-6',
        version: '20250514',
        parametersHash: 'sha256:params',
      },
      tools: ['Read', 'Edit', 'Write'],
      environment: {
        os: 'Linux',
        runtime: 'Node.js 20',
        containerImageDigest: 'sha256:container',
        lockfileHash: 'sha256:lock',
      },
      startTime: '2026-03-29T08:00:00Z',
      endTime: '2026-03-29T09:00:00Z',
      actor: 'developer-001',
      policyVerdict: 'approved',
      diffHash: 'sha256:diff',
    });

    expect(evidence.taskSeedId).toBe(taskSeed.id);
    expect(evidence.state).toBe('Published');
  });
});