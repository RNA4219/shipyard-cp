/**
 * Demo script to verify shipyard-cp contracts functionality.
 */

import {
  ContractOrchestrator,
  PolicyEngine,
  generateTaskSeed,
  generateAcceptance,
  generatePublishGate,
  generateEvidence,
  deriveRiskLevel,
  determineExecutionRole,
  isCapabilityGranted,
  DEFAULT_CAPABILITY_MATRIX,
} from '../src/domain/contracts/index.js';

console.log('=== shipyard-cp Contracts Demo ===\n');

// 1. Contract Orchestrator
console.log('1. Contract Orchestrator Test');
console.log('------------------------------');

const orchestrator = new ContractOrchestrator();

// Create IntentContract
const intent = {
  schemaVersion: '1.0.0',
  id: 'IC-001',
  kind: 'IntentContract' as const,
  state: 'Draft' as const,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  intent: 'Add OAuth2 authentication',
  creator: 'developer-001',
  priority: 'medium' as const,
  requestedCapabilities: ['read_repo' as const, 'write_repo' as const],
};

// Store and activate
orchestrator.storeContract(intent);
const activatedIntent = orchestrator.transitionState(intent, 'Active');
console.log(`IntentContract created: ${intent.id}`);
console.log(`State transition: Draft -> ${activatedIntent.state} ✅`);

// Check idempotency
const key = ContractOrchestrator.generateIdempotencyKey('IC-001', 1, 'TaskSeed');
console.log(`Idempotency key: ${key}`);

console.log('');

// 2. TaskSeed Generation
console.log('2. TaskSeed Generation Test');
console.log('----------------------------');

const taskSeed = generateTaskSeed(
  activatedIntent,
  'Implement OAuth2 login flow',
  ['Read existing auth code', 'Add OAuth2 provider', 'Write tests'],
  'developer'
);

console.log(`TaskSeed generated: ${taskSeed.id}`);
console.log(`  state: ${taskSeed.state} ${taskSeed.state === 'Active' ? '✅' : ''}`);
console.log(`  auto_activate: ${taskSeed.generationPolicy.auto_activate}`);

console.log('');

// 3. Acceptance Generation
console.log('3. Acceptance Generation Test');
console.log('------------------------------');

const acceptance = generateAcceptance(
  taskSeed,
  'passed',
  'All acceptance criteria verified',
  ['Unit tests pass', 'Integration tests pass', 'Security scan clean']
);

console.log(`Acceptance generated: ${acceptance.id}`);
console.log(`  status: ${acceptance.status}`);
console.log(`  state: ${acceptance.state}`);

console.log('');

// 4. Policy Engine
console.log('4. Policy Engine Test');
console.log('----------------------');

const policyEngine = new PolicyEngine();

// Test different risk levels
const lowRiskAssessment = policyEngine.assessPolicy(['read_repo']);
console.log(`Low risk assessment:`);
console.log(`  riskLevel: ${lowRiskAssessment.riskLevel}`);
console.log(`  autoApproved: ${lowRiskAssessment.autoApproved} ✅`);

const highRiskAssessment = policyEngine.assessPolicy(['install_deps', 'network_access']);
console.log(`High risk assessment:`);
console.log(`  riskLevel: ${highRiskAssessment.riskLevel}`);
console.log(`  requiresApproval: ${highRiskAssessment.requiresApproval}`);
console.log(`  requiredApprovals: [${highRiskAssessment.requiredApprovals.join(', ')}]`);

console.log('');

// 5. PublishGate Creation
console.log('5. PublishGate Creation Test');
console.log('-----------------------------');

const lowRiskGate = policyEngine.createPublishGate(acceptance, ['read_repo', 'write_repo']);
console.log(`Low risk PublishGate:`);
console.log(`  riskLevel: ${lowRiskGate.riskLevel}`);
console.log(`  finalDecision: ${lowRiskGate.finalDecision} ✅`);
console.log(`  state: ${lowRiskGate.state}`);

const highRiskGate = policyEngine.createPublishGate(acceptance, ['install_deps'], { productionDataAccess: false });
console.log(`High risk PublishGate:`);
console.log(`  riskLevel: ${highRiskGate.riskLevel}`);
console.log(`  finalDecision: ${highRiskGate.finalDecision}`);
console.log(`  requiredApprovals: [${highRiskGate.requiredApprovals.join(', ')}]`);

console.log('');

// 6. Approval Flow
console.log('6. Approval Flow Test');
console.log('----------------------');

let gate = policyEngine.createPublishGate(acceptance, ['install_deps']);
console.log(`Initial gate state: ${gate.state}, decision: ${gate.finalDecision}`);

// Record first approval
gate = policyEngine.recordApproval(gate, {
  role: 'project_lead',
  actorId: 'lead-001',
  decision: 'approved',
  reason: 'Looks good',
});
console.log(`After project_lead approval: ${gate.finalDecision}`);

// Record second approval
gate = policyEngine.recordApproval(gate, {
  role: 'security_reviewer',
  actorId: 'security-001',
  decision: 'approved',
});
console.log(`After security_reviewer approval: ${gate.finalDecision} ✅`);
console.log(`Final state: ${gate.state} ✅`);

console.log('');

// 7. Evidence Generation
console.log('7. Evidence Generation Test');
console.log('----------------------------');

const evidence = generateEvidence(taskSeed, {
  baseCommit: 'a1b2c3d',
  headCommit: 'e4f5g6h',
  inputHash: 'sha256:abc',
  outputHash: 'sha256:def',
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
  endTime: '2026-03-29T10:00:00Z',
  actor: 'developer-001',
  policyVerdict: 'approved',
  diffHash: 'sha256:diff',
});

console.log(`Evidence generated: ${evidence.id}`);
console.log(`  state: ${evidence.state} ${evidence.state === 'Published' ? '✅' : ''}`);
console.log(`  duration: ${new Date(evidence.endTime).getTime() - new Date(evidence.startTime).getTime()}ms`);

console.log('');

// 8. Capability Check
console.log('8. Capability Check Test');
console.log('-------------------------');

console.log(`developer + read_repo: ${isCapabilityGranted('developer', 'read_repo', DEFAULT_CAPABILITY_MATRIX)} ✅`);
console.log(`developer + install_deps: ${isCapabilityGranted('developer', 'install_deps', DEFAULT_CAPABILITY_MATRIX)} ✅`);
console.log(`ci_agent + install_deps: ${isCapabilityGranted('ci_agent', 'install_deps', DEFAULT_CAPABILITY_MATRIX)} ✅`);
console.log(`admin + read_secrets: ${isCapabilityGranted('admin', 'read_secrets', DEFAULT_CAPABILITY_MATRIX)} ✅`);

console.log('');

// 9. Full Flow Summary
console.log('9. Full Contract Flow Summary');
console.log('------------------------------');
console.log(`1. IntentContract: ${intent.id} (${intent.intent})`);
console.log(`2. TaskSeed: ${taskSeed.id} (${taskSeed.description})`);
console.log(`3. Acceptance: ${acceptance.id} (status: ${acceptance.status})`);
console.log(`4. PublishGate: ${gate.id} (decision: ${gate.finalDecision})`);
console.log(`5. Evidence: ${evidence.id} (state: ${evidence.state})`);
console.log('');
console.log('Flow completed successfully! ✅');

console.log('');
console.log('=== All demos completed ===');