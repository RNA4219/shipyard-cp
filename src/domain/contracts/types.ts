/**
 * Contract types for agent-protocols integration.
 * These types align with agent-protocols schemas.
 */

// Contract kinds
export type ContractKind = 'IntentContract' | 'TaskSeed' | 'Acceptance' | 'PublishGate' | 'Evidence';

// Contract states
export type ContractState = 'Draft' | 'Active' | 'Frozen' | 'Published' | 'Superseded' | 'Revoked' | 'Archived';

// Capabilities
export type Capability =
  | 'read_repo'
  | 'write_repo'
  | 'install_deps'
  | 'network_access'
  | 'read_secrets'
  | 'publish_release';

// Priority
export type Priority = 'low' | 'medium' | 'high' | 'critical';

// Risk level
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// Approval roles
export type ApprovalRole = 'policy_engine' | 'project_lead' | 'security_reviewer' | 'release_manager' | 'admin';

// Execution roles
export type ExecutionRole = 'developer' | 'ci_agent' | 'qa' | 'project_lead' | 'release_manager' | 'admin';

// Base contract interface
export interface BaseContract {
  schemaVersion: string;
  id: string;
  kind: ContractKind;
  state: ContractState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// IntentContract
export interface IntentContract extends BaseContract {
  kind: 'IntentContract';
  intent: string;
  creator: string;
  priority: Priority;
  requestedCapabilities: Capability[];
}

// Generation policy
export interface GenerationPolicy {
  auto_activate: boolean;
  requiredActivationApprovals: ApprovalRole[];
}

// TaskSeed
export interface TaskSeed extends BaseContract {
  kind: 'TaskSeed';
  intentId: string;
  description: string;
  ownerRole: ExecutionRole;
  executionPlan: string[];
  requestedCapabilitiesSnapshot: Capability[];
  generationPolicy: GenerationPolicy;
}

// Acceptance status
export type AcceptanceStatus = 'pending' | 'passed' | 'failed' | 'blocked';

// Acceptance
export interface Acceptance extends BaseContract {
  kind: 'Acceptance';
  taskSeedId: string;
  status: AcceptanceStatus;
  details: string;
  criteria: string[];
  generationPolicy: GenerationPolicy;
}

// Approval record
export interface ApprovalRecord {
  role: ApprovalRole;
  actorId: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  reason?: string;
}

// PublishGate action
export type PublishGateAction = 'publish' | 'reject' | 'hold';

// PublishGate final decision
export type FinalDecision = 'pending' | 'approved' | 'rejected' | 'expired';

// PublishGate
export interface PublishGate extends BaseContract {
  kind: 'PublishGate';
  entityId: string;
  action: PublishGateAction;
  riskLevel: RiskLevel;
  requiredApprovals: ApprovalRole[];
  approvals: ApprovalRecord[];
  finalDecision: FinalDecision;
  approvalDeadline?: string;
}

// Stale classification
export type StaleClassification = 'fresh' | 'soft_stale' | 'hard_stale';

// Merge status
export type MergeStatus = 'not_applicable' | 'not_attempted' | 'merged' | 'manual_resolution_required';

// Policy verdict
export type PolicyVerdict = 'approved' | 'rejected' | 'manual_review_required';

// Evidence
export interface Evidence extends BaseContract {
  kind: 'Evidence';
  taskSeedId: string;
  baseCommit: string;
  headCommit: string;
  inputHash: string;
  outputHash: string;
  model: {
    name: string;
    version: string;
    parametersHash: string;
  };
  tools: string[];
  environment: {
    os: string;
    runtime: string;
    containerImageDigest: string;
    lockfileHash: string;
  };
  staleStatus: {
    classification: StaleClassification;
    evaluatedAt: string;
    reason?: string;
  };
  mergeResult: {
    status: MergeStatus;
    mergedAt?: string;
    strategy?: string;
    reason?: string;
  };
  startTime: string;
  endTime: string;
  actor: string;
  approvalsSnapshot?: ApprovalRecord[];
  policyVerdict: PolicyVerdict;
  diffHash: string;
}

// Contract union type
export type Contract = IntentContract | TaskSeed | Acceptance | PublishGate | Evidence;

// Event types
export type ContractEventType =
  | 'intent.created.v1'
  | 'taskseed.created.v1'
  | 'taskseed.execution.completed.v1'
  | 'acceptance.created.v1'
  | 'publishgate.created.v1'
  | 'publishgate.decision.recorded.v1'
  | 'evidence.created.v1';

// Contract event
export interface ContractEvent {
  eventType: ContractEventType;
  timestamp: string;
  contractId: string;
  contractKind: ContractKind;
  payload: Record<string, unknown>;
}