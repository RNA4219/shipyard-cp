import {
  createContractEvent,
  createContractId,
  createPublishGate,
  deriveGenerationPolicy,
  deriveRiskLevel,
  safeParseContract,
  validateTransition,
  type Acceptance,
  type Capability,
  type CloudEvent,
  type Contract,
  type Evidence,
  type IntentContract,
  type TaskSeed,
  type ApprovalRecord,
  type RiskFactors,
} from '@rna4219/agent-protocols';

export { deriveGenerationPolicy, deriveRiskLevel };

export const RETRY_CONFIG = { maxRetries: 3, delays: [30000, 60000, 120000] };
export const STALE_THRESHOLDS = { softStaleMs: 10 * 60 * 1000, hardStaleMs: 60 * 60 * 1000 };
export const LOCK_CONFIG = { ttlMs: 300000, heartbeatIntervalMs: 60000, maxHeartbeatFailures: 2, retryDelays: [15000, 30000, 60000] };

type EventHandler = (event: CloudEvent) => void;

export class ContractOrchestrator {
  private readonly eventHandlers = new Map<string, EventHandler[]>();
  private readonly contractStore = new Map<string, Contract>();
  private readonly idempotencyCache = new Map<string, string>();

  static generateIdempotencyKey(sourceContractId: string, sourceRevision: number, targetKind: string): string {
    return sourceContractId + ':' + sourceRevision + ':' + targetKind;
  }

  isIdempotent(key: string): boolean { return this.idempotencyCache.has(key); }

  storeContract(contract: Contract, idempotencyKey?: string): void {
    const parsed = safeParseContract(contract);
    if (!parsed.success) throw new Error(parsed.errors.map((error) => error.code + ': ' + error.message).join('; '));
    this.contractStore.set(parsed.data.id, parsed.data);
    if (idempotencyKey) this.idempotencyCache.set(idempotencyKey, parsed.data.id);
  }

  getContract<T extends Contract>(id: string): T | undefined {
    return this.contractStore.get(id) as T | undefined;
  }

  emitEvent(event: CloudEvent): void {
    for (const handler of this.eventHandlers.get(event.type) ?? []) handler(event);
  }

  subscribe(eventType: string, handler: EventHandler): void {
    this.eventHandlers.set(eventType, [...(this.eventHandlers.get(eventType) ?? []), handler]);
  }

  transitionState(contract: Contract, next: Contract): Contract {
    const validation = validateTransition(contract, next);
    if (!validation.valid) throw new Error(validation.errors.map((error) => error.code + ': ' + error.message).join('; '));
    this.storeContract(next);
    return next;
  }
}

export function generateTaskSeed(
  intent: IntentContract,
  description: string,
  executionPlan: string[],
  ownerRole: TaskSeed['ownerRole'],
): TaskSeed {
  const now = new Date().toISOString();
  const result = safeParseContract({
    schemaVersion: '2.0.0',
    id: createContractId('TaskSeed', { now }),
    kind: 'TaskSeed',
    lifecycle: deriveGenerationPolicy(intent.requestedCapabilities).auto_activate ? 'active' : 'draft',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    intentId: intent.id,
    description,
    ownerRole,
    executionPlan,
    requestedCapabilitiesSnapshot: [...intent.requestedCapabilities],
    generationPolicy: deriveGenerationPolicy(intent.requestedCapabilities),
  });
  if (!result.success || result.data.kind !== 'TaskSeed') throw new Error('Generated TaskSeed failed shared validation');
  return result.data;
}

export function generateAcceptance(taskSeed: TaskSeed, status: Acceptance['status'], details: string, criteria: string[]): Acceptance {
  const now = new Date().toISOString();
  const result = safeParseContract({
    schemaVersion: '2.0.0',
    id: createContractId('Acceptance', { now }),
    kind: 'Acceptance',
    lifecycle: taskSeed.generationPolicy.auto_activate ? 'active' : 'draft',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    taskSeedId: taskSeed.id,
    status,
    details,
    criteria,
    generationPolicy: taskSeed.generationPolicy,
  });
  if (!result.success || result.data.kind !== 'Acceptance') throw new Error('Generated Acceptance failed shared validation');
  return result.data;
}

export function generatePublishGate(acceptance: Acceptance, capabilities: Capability[], riskFactors?: RiskFactors) {
  return createPublishGate(acceptance, capabilities, { riskFactors });
}

function hash(value: unknown, algorithm: string) {
  return typeof value === 'object' && value !== null ? value : { algorithm, value: String(value) };
}

export function generateEvidence(taskSeed: TaskSeed, execution: {
  stage?: Evidence['stage'];
  baseCommit: unknown; headCommit: unknown; inputHash: unknown; outputHash: unknown;
  model: Evidence['model']; tools: Array<string | Evidence['tools'][number]>;
  environment: Evidence['environment']; startTime: string; endTime: string; actor: string;
  policyVerdict: Evidence['policyVerdict']; diffHash: unknown; approvalsSnapshot?: Evidence['approvalsSnapshot'];
  acceptanceId?: string; publishGateId?: string;
}): Evidence {
  const now = new Date().toISOString();
  const value = {
    schemaVersion: '2.0.0', id: createContractId('Evidence', { now }), kind: 'Evidence',
    lifecycle: 'final', revision: 1, createdAt: now, updatedAt: now,
    stage: execution.stage ?? 'execution', taskSeedId: taskSeed.id,
    acceptanceId: execution.acceptanceId, publishGateId: execution.publishGateId,
    baseCommit: hash(execution.baseCommit, 'git'), headCommit: hash(execution.headCommit, 'git'),
    inputHash: hash(execution.inputHash, 'sha256'), outputHash: hash(execution.outputHash, 'sha256'),
    model: { ...execution.model, parametersHash: hash(execution.model.parametersHash, 'sha256') },
    tools: execution.tools.map((tool) => typeof tool === 'string' ? { name: tool } : tool),
    environment: {
      ...execution.environment,
      containerImageDigest: hash(execution.environment.containerImageDigest, 'sha256'),
      lockfileHash: hash(execution.environment.lockfileHash, 'sha256'),
    },
    staleStatus: { classification: 'fresh', evaluatedAt: now },
    mergeResult: { status: 'not_applicable' },
    startTime: execution.startTime, endTime: execution.endTime, actor: execution.actor,
    approvalsSnapshot: execution.approvalsSnapshot, policyVerdict: execution.policyVerdict,
    diffHash: hash(execution.diffHash, 'sha256'),
  };
  const result = safeParseContract(value);
  if (!result.success || result.data.kind !== 'Evidence') throw new Error('Generated Evidence failed shared validation');
  return result.data;
}

export function resetIdCounter(): void {}
export function setIdCounterStart(_start: number): void {}

export function createContractCloudEvent(contract: Contract): CloudEvent {
  return createContractEvent(contract);
}
