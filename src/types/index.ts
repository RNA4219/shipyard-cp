// Re-export all types for backward compatibility
// This allows existing imports from '../types.js' or '../types/index.js' to work

// Base types
export type {
  RiskLevel,
  WorkerType,
  WorkerStage,
  FailureClass,
  SideEffectCategory,
  TaskState,
  NextAction,
  Capability,
  Reference,
} from './base.js';

// Task-related types
export type {
  RepoRef,
  WorkspaceRef,
  PublishPlan,
  RepoPolicy,
  Verdict,
  ManualChecklistItem,
  ArtifactRef,
  LinkRole,
  ExternalRef,
  ResolverRefs,
  ResolveDocsRequest,
  ResolveDocsResponse,
  AckDocsRequest,
  AckDocsResponse,
  StaleCheckRequest,
  StaleDocItem,
  StaleCheckResponse,
  TrackerLinkRequest,
  TrackerLinkResponse,
  Task,
} from './task.js';

// Run and checkpoint types
export type {
  BlockedContext,
  IntegrationState,
  IntegrationRun,
  PublishRun,
  RunStatus,
  Run,
  CheckpointRef,
} from './run.js';

// Worker job types
export type {
  WorkerJobContext,
  ApprovalPolicy,
  RetryPolicy,
  WorkerJob,
  TestResult,
  RequestedEscalation,
  WorkerResult,
} from './job.js';

// Event types
export type {
  StateTransitionEvent,
  AuditEventType,
  AuditEvent,
} from './event.js';

// Retrospective types
export type {
  RetrospectiveStatus,
  SummaryMetrics,
  NarrativeGeneration,
  Retrospective,
  RetrospectiveGenerationRequest,
} from './retrospective.js';

// API request/response types
export type {
  DispatchRequest,
  CreateTaskRequest,
  IntegrateRequest,
  CompleteIntegrateRequest,
  IntegrateResponse,
  PublishRequest,
  ApprovePublishRequest,
  CompletePublishRequest,
  CompleteAcceptanceRequest,
  CompleteAcceptanceResponse,
  PublishResponse,
  ResultApplyResponse,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
  Lease,
} from './api.js';