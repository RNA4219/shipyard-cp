/**
 * Contract Orchestrator for agent-protocols flow.
 * Handles: IntentContract -> TaskSeed -> Acceptance -> PublishGate -> Evidence
 */

import type {
  IntentContract,
  TaskSeed,
  Acceptance,
  PublishGate,
  Evidence,
  Contract,
  Capability,
  RiskLevel,
  GenerationPolicy,
  ApprovalRole,
  ContractEvent,
  ContractEventType,
  ContractState,
} from './types.js';

// Idempotency key type
export interface IdempotencyKey {
  sourceContractId: string;
  sourceVersion: number;
  targetKind: string;
}

// Retry configuration
export const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [30000, 60000, 120000], // 30s, 60s, 120s
};

// Stale thresholds
export const STALE_THRESHOLDS = {
  softStaleMs: 10 * 60 * 1000, // 10 minutes
  hardStaleMs: 60 * 60 * 1000, // 60 minutes
};

// Lock configuration
export const LOCK_CONFIG = {
  ttlMs: 300 * 1000, // 300 seconds
  heartbeatIntervalMs: 60 * 1000, // 60 seconds
  maxHeartbeatFailures: 2,
  retryDelays: [15000, 30000, 60000], // 15s, 30s, 60s
};

/**
 * Contract Orchestrator
 */
export class ContractOrchestrator {
  private readonly eventHandlers: Map<ContractEventType, EventHandler[]>;
  private readonly idempotencyCache: Map<string, string>;
  private readonly contractStore: Map<string, Contract>;

  constructor() {
    this.eventHandlers = new Map();
    this.idempotencyCache = new Map();
    this.contractStore = new Map();
  }

  /**
   * Generate idempotency key
   */
  static generateIdempotencyKey(
    sourceContractId: string,
    sourceVersion: number,
    targetKind: string
  ): string {
    return `${sourceContractId}:${sourceVersion}:${targetKind}`;
  }

  /**
   * Check if contract generation is idempotent
   */
  isIdempotent(key: string): boolean {
    return this.idempotencyCache.has(key);
  }

  /**
   * Store contract with idempotency
   */
  storeContract(contract: Contract, idempotencyKey?: string): void {
    this.contractStore.set(contract.id, contract);
    if (idempotencyKey) {
      this.idempotencyCache.set(idempotencyKey, contract.id);
    }
  }

  /**
   * Get contract by ID
   */
  getContract<T extends Contract>(id: string): T | undefined {
    return this.contractStore.get(id) as T | undefined;
  }

  /**
   * Emit event
   */
  emitEvent(event: ContractEvent): void {
    const handlers = this.eventHandlers.get(event.eventType) || [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(eventType: ContractEventType, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Transition contract state
   */
  transitionState(contract: Contract, newState: ContractState): Contract {
    const updated: Contract = {
      ...contract,
      state: newState,
      updatedAt: new Date().toISOString(),
    };
    this.contractStore.set(contract.id, updated);
    return updated;
  }
}

type EventHandler = (event: ContractEvent) => void;

/**
 * Derive generation policy from capabilities
 */
export function deriveGenerationPolicy(capabilities: Capability[]): GenerationPolicy {
  const hasInstallDeps = capabilities.includes('install_deps');
  const hasNetworkAccess = capabilities.includes('network_access');
  const hasReadSecrets = capabilities.includes('read_secrets');
  const hasPublishRelease = capabilities.includes('publish_release');

  // Safe capabilities: read_repo only or read_repo + write_repo
  const isSafeCapabilitySet =
    (capabilities.length === 1 && capabilities[0] === 'read_repo') ||
    (capabilities.length === 2 &&
      capabilities.includes('read_repo') &&
      capabilities.includes('write_repo'));

  if (isSafeCapabilitySet && !hasInstallDeps && !hasNetworkAccess && !hasReadSecrets && !hasPublishRelease) {
    return {
      auto_activate: true,
      requiredActivationApprovals: [],
    };
  }

  // Determine required approvals
  const requiredApprovals = new Set<ApprovalRole>();

  if (hasInstallDeps || hasNetworkAccess || hasReadSecrets) {
    requiredApprovals.add('project_lead');
    requiredApprovals.add('security_reviewer');
  }

  if (hasPublishRelease) {
    requiredApprovals.add('project_lead');
    requiredApprovals.add('release_manager');
  }

  return {
    auto_activate: false,
    requiredActivationApprovals: Array.from(requiredApprovals),
  };
}

/**
 * Derive risk level from capabilities and factors
 */
export function deriveRiskLevel(
  capabilities: Capability[],
  riskFactors?: {
    productionDataAccess?: boolean;
    externalSecretTransmission?: boolean;
    legalConcern?: boolean;
    rollbackImpossible?: boolean;
  }
): RiskLevel {
  const hasWriteRepo = capabilities.includes('write_repo');
  const hasInstallDeps = capabilities.includes('install_deps');
  const hasNetworkAccess = capabilities.includes('network_access');
  const hasReadSecrets = capabilities.includes('read_secrets');
  const hasPublishRelease = capabilities.includes('publish_release');

  // Critical conditions
  if (
    riskFactors?.productionDataAccess ||
    riskFactors?.externalSecretTransmission ||
    riskFactors?.legalConcern ||
    riskFactors?.rollbackImpossible
  ) {
    return 'critical';
  }

  // High conditions
  if (hasInstallDeps || hasNetworkAccess || hasReadSecrets || hasPublishRelease) {
    return 'high';
  }

  // Medium conditions
  if (hasWriteRepo) {
    return 'medium';
  }

  return 'low';
}

/**
 * Generate TaskSeed from IntentContract
 */
export function generateTaskSeed(
  intent: IntentContract,
  description: string,
  executionPlan: string[],
  ownerRole: TaskSeed['ownerRole']
): TaskSeed {
  const now = new Date().toISOString();
  const generationPolicy = deriveGenerationPolicy(intent.requestedCapabilities);

  const taskSeed: TaskSeed = {
    schemaVersion: '1.0.0',
    id: generateId('TS'),
    kind: 'TaskSeed',
    state: generationPolicy.auto_activate ? 'Active' : 'Draft',
    version: 1,
    createdAt: now,
    updatedAt: now,
    intentId: intent.id,
    description,
    ownerRole,
    executionPlan,
    requestedCapabilitiesSnapshot: [...intent.requestedCapabilities],
    generationPolicy,
  };

  return taskSeed;
}

/**
 * Generate Acceptance from TaskSeed execution
 */
export function generateAcceptance(
  taskSeed: TaskSeed,
  status: Acceptance['status'],
  details: string,
  criteria: string[]
): Acceptance {
  const now = new Date().toISOString();

  const acceptance: Acceptance = {
    schemaVersion: '1.0.0',
    id: generateId('AC'),
    kind: 'Acceptance',
    state: taskSeed.generationPolicy.auto_activate ? 'Active' : 'Draft',
    version: 1,
    createdAt: now,
    updatedAt: now,
    taskSeedId: taskSeed.id,
    status,
    details,
    criteria,
    generationPolicy: { ...taskSeed.generationPolicy },
  };

  return acceptance;
}

/**
 * Generate PublishGate from Acceptance
 */
export function generatePublishGate(
  acceptance: Acceptance,
  capabilities: Capability[],
  riskFactors?: Parameters<typeof deriveRiskLevel>[1]
): PublishGate {
  const now = new Date().toISOString();
  const riskLevel = deriveRiskLevel(capabilities, riskFactors);

  let requiredApprovals: ApprovalRole[] = [];
  let finalDecision: PublishGate['finalDecision'] = 'pending';
  let approvalDeadline: string | undefined;
  let state: ContractState = 'Active';

  switch (riskLevel) {
    case 'low':
    case 'medium':
      requiredApprovals = [];
      finalDecision = 'approved';
      state = 'Published';
      break;
    case 'high':
      requiredApprovals = ['project_lead', 'security_reviewer'];
      approvalDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'critical':
      requiredApprovals = ['project_lead', 'security_reviewer', 'release_manager'];
      approvalDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      break;
  }

  const publishGate: PublishGate = {
    schemaVersion: '1.0.0',
    id: generateId('PG'),
    kind: 'PublishGate',
    state,
    version: 1,
    createdAt: now,
    updatedAt: now,
    entityId: acceptance.id,
    action: 'publish',
    riskLevel,
    requiredApprovals,
    approvals: requiredApprovals.length === 0
      ? [
          {
            role: 'policy_engine',
            actorId: 'policy-engine',
            decision: 'approved',
            decidedAt: now,
          },
        ]
      : [],
    finalDecision,
    approvalDeadline,
  };

  return publishGate;
}

/**
 * Generate Evidence from execution
 */
export function generateEvidence(
  taskSeed: TaskSeed,
  execution: {
    baseCommit: string;
    headCommit: string;
    inputHash: string;
    outputHash: string;
    model: Evidence['model'];
    tools: string[];
    environment: Evidence['environment'];
    startTime: string;
    endTime: string;
    actor: string;
    policyVerdict: Evidence['policyVerdict'];
    diffHash: string;
    approvalsSnapshot?: Evidence['approvalsSnapshot'];
  }
): Evidence {
  const now = new Date().toISOString();

  const evidence: Evidence = {
    schemaVersion: '1.0.0',
    id: generateId('EV'),
    kind: 'Evidence',
    state: 'Published',
    version: 1,
    createdAt: now,
    updatedAt: now,
    taskSeedId: taskSeed.id,
    ...execution,
    staleStatus: {
      classification: 'fresh',
      evaluatedAt: now,
    },
    mergeResult: {
      status: 'not_applicable',
    },
  };

  return evidence;
}

// ID counter for testing (in production would use UUID or DB sequence)
let idCounter = 1;

/**
 * Generate contract ID
 */
function generateId(prefix: string): string {
  const num = String(idCounter++).padStart(3, '0');
  return `${prefix}-${num}`;
}

/**
 * Reset ID counter (for testing)
 */
export function resetIdCounter(): void {
  idCounter = 1;
}

/**
 * Set ID counter start (for testing)
 */
export function setIdCounterStart(start: number): void {
  idCounter = start;
}