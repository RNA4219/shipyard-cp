import { describe, expect, it } from 'vitest';
import { ContractOrchestrator, createContractCloudEvent, deriveGenerationPolicy, deriveRiskLevel, generateAcceptance, generateEvidence, generatePublishGate, generateTaskSeed } from '../src/domain/contracts/index.js';
import { createContractId, safeParseEvent } from '@rna4219/agent-protocols';

const now = '2026-07-12T00:00:00.000Z';
const intent = {
  schemaVersion: '2.0.0' as const, id: createContractId('IntentContract', { now }), kind: 'IntentContract' as const,
  lifecycle: 'active' as const, revision: 1, createdAt: now, updatedAt: now,
  intent: 'Shipyard v2 contract integration', creator: 'test', priority: 'low' as const,
  requestedCapabilities: ['read_repo' as const],
};

describe('shipyard contract boundary v2', () => {
  it('delegates policy to the canonical package', () => {
    expect(deriveGenerationPolicy(['read_repo'])).toEqual({ auto_activate: true, requiredActivationApprovals: [] });
    expect(deriveRiskLevel(['read_repo', 'write_repo'])).toBe('medium');
  });
  it('runs the contract flow with v2 metadata', () => {
    const task = generateTaskSeed(intent, 'run tests', ['npm test'], 'developer');
    const acceptance = generateAcceptance(task, 'passed', 'all checks passed', ['tests']);
    const gate = generatePublishGate(acceptance, ['read_repo']);
    const evidence = generateEvidence(task, {
      baseCommit: 'base', headCommit: 'head', inputHash: 'input', outputHash: 'output',
      model: { name: 'test-model', version: '1', parametersHash: { algorithm: 'sha256', value: 'params' } },
      tools: [{ name: 'vitest', version: '3' }],
      environment: { os: 'windows', runtime: 'node20', containerImageDigest: { algorithm: 'sha256', value: 'image' }, lockfileHash: { algorithm: 'sha256', value: 'lock' } },
      startTime: now, endTime: now, actor: 'worker', policyVerdict: 'approved', diffHash: 'diff',
    });
    expect(task.schemaVersion).toBe('2.0.0');
    expect(gate.acceptanceId).toBe(acceptance.id);
    expect(gate.lifecycle).toBe('final');
    expect(evidence.lifecycle).toBe('final');
    expect(evidence.baseCommit).toEqual({ algorithm: 'git', value: 'base' });
  });
  it('uses CloudEvents and validates transitions before storing', () => {
    const event = createContractCloudEvent(intent);
    expect(event.specversion).toBe('1.0');
    expect(safeParseEvent(event).success).toBe(true);
    const orchestrator = new ContractOrchestrator();
    orchestrator.storeContract(intent);
    const frozen = { ...intent, lifecycle: 'frozen' as const, revision: 2, updatedAt: '2026-07-12T00:01:00.000Z' };
    expect(orchestrator.transitionState(intent, frozen)).toEqual(frozen);
  });
});
