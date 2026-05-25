/**
 * Event type definitions for OpenCode Event Ingestor.
 *
 * Phase 2B: Enhanced event stream normalization with full event tracking.
 */

// ============================================================================
// Event Categories (Phase 2B)
// ============================================================================

/**
 * Internal event category classification.
 */
export type EventCategory =
  | 'transcript_message'
  | 'tool_use'
  | 'permission_request'
  | 'stdout_chunk'
  | 'stderr_chunk'
  | 'session_lifecycle'
  | 'execution_completion';

/**
 * Cleanup reason classification (Phase 2B).
 */
export type CleanupReason =
  | 'task_completed'
  | 'task_cancelled'
  | 'task_failed'
  | 'timeout'
  | 'server_crash'
  | 'policy_mismatch'
  | 'ttl_expired'
  | 'manual_cleanup'
  | 'orphan_detected'
  | 'lease_expired';

/**
 * Fallback reason classification (Phase 2B).
 */
export type FallbackReason =
  | 'server_start_failed'
  | 'server_health_check_failed'
  | 'session_create_failed'
  | 'session_run_failed'
  | 'session_timeout'
  | 'session_crash'
  | 'connection_lost'
  | 'api_error';

// ============================================================================
// Raw Event Types
// ============================================================================

export interface PermissionRequestEvent {
  type: 'permission_request';
  id: string;
  tool?: string;
  action?: string;
  reason?: string;
  timestamp: number;
  context?: Record<string, unknown>;
  category: EventCategory;
}

export interface ToolUseEvent {
  type: 'tool_use';
  id: string;
  tool: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'pending' | 'success' | 'error' | 'denied';
  timestamp: number;
  duration_ms?: number;
  error?: string;
  category: EventCategory;
}

export interface TranscriptEvent {
  type: 'transcript';
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
  category: EventCategory;
}

export interface StdioEvent {
  type: 'stdout' | 'stderr';
  id: string;
  content: string;
  timestamp: number;
  category: EventCategory;
}

export interface SessionLifecycleEvent {
  type: 'session_lifecycle';
  id: string;
  lifecycle_event: 'created' | 'connected' | 'started' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cancelled';
  timestamp: number;
  sessionId?: string;
  reason?: string;
  category: EventCategory;
}

export interface ExecutionCompletionEvent {
  type: 'execution_completion';
  id: string;
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  timestamp: number;
  exit_code?: number;
  reason?: string;
  category: EventCategory;
}

export type OpenCodeEvent =
  | PermissionRequestEvent
  | ToolUseEvent
  | TranscriptEvent
  | StdioEvent
  | SessionLifecycleEvent
  | ExecutionCompletionEvent;

// ============================================================================
// Ingested Events Structure
// ============================================================================

export interface EventIngestorConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Include raw events in the result */
  includeRawEvents?: boolean;
}

export interface NormalizedEscalation {
  kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
  reason: string;
  approved?: boolean;
  raw: PermissionRequestEvent;
}

export interface NormalizedToolUse {
  tool: string;
  status: 'pending' | 'success' | 'error' | 'denied';
  duration_ms?: number;
  error?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface NormalizedTranscript {
  role: 'assistant' | 'user' | 'system';
  content: string;
  tokens?: number;
}

export interface IngestedEvents {
  /** All permission requests normalized */
  permissionRequests: NormalizedEscalation[];
  /** All tool uses normalized */
  toolUses: NormalizedToolUse[];
  /** All transcript messages normalized */
  transcripts: NormalizedTranscript[];
  /** Stdout chunks */
  stdout: string[];
  /** Stderr chunks */
  stderr: string[];
  /** Session lifecycle events */
  sessionLifecycle: Array<{
    event: string;
    timestamp: number;
    sessionId?: string;
    reason?: string;
  }>;
  /** Execution completion info */
  executionCompletion?: {
    status: string;
    exit_code?: number;
    reason?: string;
  };
  /** Raw event stream (if includeRawEvents is true) */
  rawEvents?: OpenCodeEvent[];
  /** Event counts by category */
  eventCounts: Record<EventCategory, number>;
  /** Ingestion metadata */
  ingestionMeta: {
    startedAt: number;
    completedAt: number;
    totalEvents: number;
    parseErrors: number;
  };
}

// ============================================================================
// Event Stream Container (for job-level tracking)
// ============================================================================

/**
 * Container for tracking event stream per job.
 */
export interface EventStreamContainer {
  jobId: string;
  sessionId: string;
  events: OpenCodeEvent[];
  ingested: IngestedEvents;
  transcriptArtifactUri?: string;
  eventStreamArtifactUri?: string;
  startedAt: number;
  completedAt?: number;
}