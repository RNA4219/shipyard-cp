/**
 * Session Executor Types
 *
 * Type definitions for session executor configuration and results.
 */

import type { EventStreamContainer, OpenCodeEvent, CleanupReason } from '../../domain/worker/opencode-event-ingestor.js';

export interface SessionExecutorConfig {
  /** Server base URL */
  baseUrl: string;
  /** Base directory for session artifacts */
  workDir?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Include raw events in artifacts */
  includeRawEvents?: boolean;
}

export interface SessionExecutionResult {
  success: boolean;
  sessionId?: string;
  reusedSession?: boolean;
  output?: string;
  error?: string;
  artifacts?: Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'json' | 'other';
    uri: string;
  }>;
  duration_ms: number;
  transcript?: string;
  eventStream?: EventStreamContainer;
  cleanupReason?: CleanupReason;
}

export interface SessionCreateResponse {
  id: string;
  status: string;
  created_at: string;
}

export interface SessionRunResponse {
  status: string;
  output?: string;
  error?: string;
  transcript?: string;
  events?: OpenCodeEvent[];
}