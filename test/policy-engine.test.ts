import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '../src/domain/contracts/index.js';
import { createContractId, createPublishGate, expireGate, type Acceptance } from '@rna4219/agent-protocols';

const now = '2026-07-12T00:00:00.000Z';
function acceptance(): Acceptance {
  return {
    schemaVersion: '2.0.0', id: createContractId('Acceptance', { now }), kind: 'Acceptance',
    lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now,
    taskSeedId: createContractId('TaskSeed', { now }), status: 'passed', details: 'passed',
    criteria: ['all tests'], generationPolicy: { auto_activate: true, requiredActivationApprovals: [] },
  };
}

describe('PolicyEngine v2 delegation', () => {
  it('uses canonical low/medium/high/critical policy', () => {
    const engine = new PolicyEngine();
    expect(engine.assessPolicy(['read_repo']).autoApproved).toBe(true);
    expect(engine.assessPolicy(['read_repo', 'write_repo']).requiredApprovals).toEqual([]);
    expect(engine.assessPolicy(['read_repo', 'network_access']).requiredApprovals).toEqual(['project_lead', 'security_reviewer']);
    expect(engine.assessPolicy(['read_repo'], { productionDataAccess: true }).requiredApprovals).toEqual(['project_lead', 'security_reviewer', 'release_manager']);
  });
  it('requires every role once and increments revision', () => {
    const engine = new PolicyEngine();
    const gate = engine.createPublishGate(acceptance(), ['read_repo', 'install_deps']);
    const first = engine.recordApproval(gate, { role: 'project_lead', actorId: 'lead', decision: 'approved' });
    const final = engine.recordApproval(first, { role: 'security_reviewer', actorId: 'security', decision: 'approved' });
    expect(first.revision).toBe(2);
    expect(final.revision).toBe(3);
    expect(final.decision).toBe('approved');
    expect(final.lifecycle).toBe('final');
    expect(() => engine.recordApproval(final, { role: 'project_lead', actorId: 'again', decision: 'approved' })).toThrow();
  });
  it('expires pending gates as frozen', () => {
    const gate = createPublishGate(acceptance(), ['read_repo', 'network_access'], { clock: () => now });
    const expired = expireGate(gate, { clock: () => '2026-07-14T00:01:00.000Z' });
    expect(expired.decision).toBe('expired');
    expect(expired.lifecycle).toBe('frozen');
    expect(expired.revision).toBe(2);
  });
});
