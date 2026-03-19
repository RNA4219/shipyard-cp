/**
 * Type definitions index
 * Re-exports all types from domain-specific modules
 */

// Common types
export type {
  RiskLevel,
  WorkerType,
  WorkerStage,
  FailureClass,
  SideEffectCategory,
  TaskState,
  NextAction,
  LinkRole,
  Capability,
  RepoRef,
  WorkspaceRef,
  PublishPlan,
  RepoPolicy,
  Verdict,
  ManualChecklistItem,
  ArtifactRef,
  ExternalRef,
  Reference,
} from './common.js';

// Task types
export type {
  BlockedContext,
  IntegrationState,
  IntegrationRun,
  PublishRun,
  ResolverRefs,
  Task,
} from './task.js';

// Worker types
export type {
  WorkerJobContext,
  ApprovalPolicy,
  RetryPolicy,
  WorkerJob,
  TestResult,
  RequestedEscalation,
  WorkerResult,
  StateTransitionEvent,
  ResultApplyResponse,
} from './worker.js';

// Resolver types
export type {
  ResolveDocsRequest,
  ResolveDocsResponse,
  AckDocsRequest,
  AckDocsResponse,
  StaleCheckRequest,
  StaleDocItem,
  StaleCheckResponse,
  TrackerLinkRequest,
  TrackerLinkResponse,
} from './resolver.js';

// Run types
export type {
  RunStatus,
  CheckpointRef,
  Run,
} from './run.js';

// Audit types
export type {
  AuditEventType,
  AuditEvent,
} from './audit.js';

// API types
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
  JobHeartbeatRequest,
  JobHeartbeatResponse,
  Lease,
} from './api.js';

// Retrospective types
export type {
  RetrospectiveStatus,
  SummaryMetrics,
  NarrativeGeneration,
  Retrospective,
  RetrospectiveGenerationRequest,
} from './retrospective.js';