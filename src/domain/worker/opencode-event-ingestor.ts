/**
 * OpenCode Event Ingestor
 *
 * Normalizes permission requests, tool use events, and transcript data
 * from opencode serve session streams.
 *
 * Phase 2B: Enhanced event stream normalization with full event tracking.
 */

import type { WorkerResult, WorkerJob } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';

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

// ============================================================================
// Event Ingestor Class
// ============================================================================

export class OpenCodeEventIngestor {
  private readonly logger = getLogger().child({ component: 'OpenCodeEventIngestor' });
  private readonly config: Required<EventIngestorConfig>;

  constructor(config: EventIngestorConfig = {}) {
    this.config = {
      debug: config.debug || false,
      includeRawEvents: config.includeRawEvents ?? true,
    };
  }

  /**
   * Create a new event stream container for a job.
   */
  createEventStreamContainer(jobId: string, sessionId: string): EventStreamContainer {
    return {
      jobId,
      sessionId,
      events: [],
      ingested: this.createEmptyIngestedEvents(),
      startedAt: Date.now(),
    };
  }

  /**
   * Add an event to the container and ingest it.
   */
  addEvent(container: EventStreamContainer, event: OpenCodeEvent): void {
    container.events.push(event);
    this.ingestSingleEvent(container.ingested, event);
    container.ingested.eventCounts[event.category]++;

    if (this.config.debug) {
      this.logger.debug('Event added to stream', {
        jobId: container.jobId,
        sessionId: container.sessionId,
        eventType: event.type,
        category: event.category,
      });
    }
  }

  /**
   * Finalize the event stream container.
   */
  finalizeContainer(container: EventStreamContainer): void {
    container.completedAt = Date.now();
    container.ingested.ingestionMeta = {
      startedAt: container.startedAt,
      completedAt: container.completedAt!,
      totalEvents: container.events.length,
      parseErrors: 0,
    };

    if (this.config.includeRawEvents) {
      container.ingested.rawEvents = container.events;
    }

    this.logger.info('Event stream finalized', {
      jobId: container.jobId,
      sessionId: container.sessionId,
      totalEvents: container.events.length,
      categories: container.ingested.eventCounts,
    });
  }

  /**
   * Ingest raw events from session stream.
   */
  ingestEvents(rawEvents: OpenCodeEvent[]): IngestedEvents {
    const result = this.createEmptyIngestedEvents();
    result.ingestionMeta.startedAt = Date.now();

    for (const event of rawEvents) {
      this.ingestSingleEvent(result, event);
      result.eventCounts[event.category]++;
    }

    result.ingestionMeta.completedAt = Date.now();
    result.ingestionMeta.totalEvents = rawEvents.length;

    if (this.config.includeRawEvents) {
      result.rawEvents = rawEvents;
    }

    if (this.config.debug) {
      this.logger.debug('Events ingested', {
        permissionRequests: result.permissionRequests.length,
        toolUses: result.toolUses.length,
        transcripts: result.transcripts.length,
        stdoutLines: result.stdout.length,
        stderrLines: result.stderr.length,
        sessionLifecycle: result.sessionLifecycle.length,
        totalEvents: result.ingestionMeta.totalEvents,
      });
    }

    return result;
  }

  /**
   * Create empty ingested events structure.
   */
  private createEmptyIngestedEvents(): IngestedEvents {
    return {
      permissionRequests: [],
      toolUses: [],
      transcripts: [],
      stdout: [],
      stderr: [],
      sessionLifecycle: [],
      eventCounts: {
        transcript_message: 0,
        tool_use: 0,
        permission_request: 0,
        stdout_chunk: 0,
        stderr_chunk: 0,
        session_lifecycle: 0,
        execution_completion: 0,
      },
      ingestionMeta: {
        startedAt: 0,
        completedAt: 0,
        totalEvents: 0,
        parseErrors: 0,
      },
    };
  }

  /**
   * Ingest a single event into the result.
   */
  private ingestSingleEvent(result: IngestedEvents, event: OpenCodeEvent): void {
    switch (event.type) {
      case 'permission_request':
        const normalized = this.normalizePermissionRequest(event);
        if (normalized) {
          result.permissionRequests.push(normalized);
        }
        break;

      case 'tool_use':
        result.toolUses.push({
          tool: event.tool,
          status: event.status,
          duration_ms: event.duration_ms,
          error: event.error,
          input: event.input,
          output: event.output,
        });
        break;

      case 'transcript':
        result.transcripts.push({
          role: event.role,
          content: event.content,
          tokens: event.tokens,
        });
        break;

      case 'stdout':
        result.stdout.push(event.content);
        break;

      case 'stderr':
        result.stderr.push(event.content);
        break;

      case 'session_lifecycle':
        result.sessionLifecycle.push({
          event: event.lifecycle_event,
          timestamp: event.timestamp,
          sessionId: event.sessionId,
          reason: event.reason,
        });
        break;

      case 'execution_completion':
        result.executionCompletion = {
          status: event.status,
          exit_code: event.exit_code,
          reason: event.reason,
        };
        break;
    }
  }

  /**
   * Parse JSON transcript string into events.
   */
  parseTranscriptJson(transcriptJson: string, sessionId?: string): OpenCodeEvent[] {
    if (!transcriptJson || transcriptJson.trim() === '') {
      return [];
    }

    try {
      const parsed = JSON.parse(transcriptJson);

      // Handle array format
      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, unknown>) => this.parseTranscriptItem(item, sessionId));
      }

      // Handle object with events array
      if (parsed.events && Array.isArray(parsed.events)) {
        return parsed.events.map((item: Record<string, unknown>) => this.parseTranscriptItem(item, sessionId));
      }

      // Handle single event object
      if (parsed.type) {
        return [this.parseTranscriptItem(parsed, sessionId)];
      }

      this.logger.warn('Unknown transcript format', { format: typeof parsed });
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Failed to parse transcript JSON', { error: message });

      // Fallback: treat as plain text stdout
      return [{
        type: 'stdout',
        id: `stdout-${Date.now()}`,
        content: transcriptJson,
        timestamp: Date.now(),
        category: 'stdout_chunk',
      }];
    }
  }

  /**
   * Parse a single transcript item.
   */
  private parseTranscriptItem(item: Record<string, unknown>, sessionId?: string): OpenCodeEvent {
    const type = String(item.type || 'unknown');

    // Common fields
    const id = String(item.id || `event-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const timestamp = Number(item.timestamp) || Date.now();

    if (type === 'permission_request' || type === 'permission') {
      return {
        type: 'permission_request',
        id,
        tool: String(item.tool || ''),
        action: String(item.action || ''),
        reason: String(item.reason || ''),
        timestamp,
        context: item.context as Record<string, unknown> | undefined,
        category: 'permission_request',
      };
    }

    if (type === 'tool_use' || type === 'tool') {
      return {
        type: 'tool_use',
        id,
        tool: String(item.tool || item.name || 'unknown'),
        input: item.input as Record<string, unknown> | undefined,
        output: item.output as Record<string, unknown> | undefined,
        status: String(item.status || 'pending') as ToolUseEvent['status'],
        timestamp,
        duration_ms: Number(item.duration_ms) || undefined,
        error: String(item.error || ''),
        category: 'tool_use',
      };
    }

    if (type === 'transcript' || type === 'message') {
      return {
        type: 'transcript',
        id,
        role: String(item.role || 'assistant') as TranscriptEvent['role'],
        content: String(item.content || ''),
        timestamp,
        tokens: Number(item.tokens) || undefined,
        category: 'transcript_message',
      };
    }

    if (type === 'session_lifecycle' || type === 'lifecycle') {
      return {
        type: 'session_lifecycle',
        id,
        lifecycle_event: String(item.event || item.lifecycle_event || 'unknown') as SessionLifecycleEvent['lifecycle_event'],
        timestamp,
        sessionId: sessionId || String(item.sessionId || ''),
        reason: String(item.reason || ''),
        category: 'session_lifecycle',
      };
    }

    if (type === 'execution_completion' || type === 'completion') {
      return {
        type: 'execution_completion',
        id,
        status: String(item.status || 'unknown') as ExecutionCompletionEvent['status'],
        timestamp,
        exit_code: Number(item.exit_code) || undefined,
        reason: String(item.reason || ''),
        category: 'execution_completion',
      };
    }

    if (type === 'stdout' || type === 'out') {
      return {
        type: 'stdout',
        id,
        content: String(item.content || ''),
        timestamp,
        category: 'stdout_chunk',
      };
    }

    if (type === 'stderr' || type === 'err') {
      return {
        type: 'stderr',
        id,
        content: String(item.content || ''),
        timestamp,
        category: 'stderr_chunk',
      };
    }

    // Default: treat as stdout
    return {
      type: 'stdout',
      id,
      content: JSON.stringify(item),
      timestamp,
      category: 'stdout_chunk',
    };
  }

  /**
   * Normalize permission request to WorkerResult escalation format.
   * IMPORTANT: Never silently drop permission requests (SR-B2).
   */
  private normalizePermissionRequest(event: PermissionRequestEvent): NormalizedEscalation | null {
    const tool = event.tool || '';

    // Webfetch / network -> network_access
    if (tool === 'webfetch' || tool.includes('fetch') || tool.includes('http') || tool.includes('network')) {
      return {
        kind: 'network_access',
        reason: event.reason || `Network access requested via ${tool}`,
        approved: event.context?.approved as boolean | undefined,
        raw: event,
      };
    }

    // Bash destructive commands -> destructive_tool
    if (tool === 'bash' && this.isDestructiveCommand(event.action || '')) {
      return {
        kind: 'destructive_tool',
        reason: event.reason || `Destructive command requested: ${event.action}`,
        approved: event.context?.approved as boolean | undefined,
        raw: event,
      };
    }

    // Read/write involving secrets -> secret_access
    if (this.isSecretAccess(tool, event.context)) {
      return {
        kind: 'secret_access',
        reason: event.reason || `Secret access requested via ${tool}`,
        approved: event.context?.approved as boolean | undefined,
        raw: event,
      };
    }

    // Write outside workspace -> workspace_outside_write
    if (tool === 'write' || tool === 'edit' || tool === 'create') {
      const filePath = String(event.context?.path || event.context?.file || '');
      if (filePath && !this.isInWorkspace(filePath)) {
        return {
          kind: 'workspace_outside_write',
          reason: event.reason || `Write outside workspace: ${filePath}`,
          approved: event.context?.approved as boolean | undefined,
          raw: event,
        };
      }
    }

    // Protected path write -> protected_path_write
    if (tool === 'write' || tool === 'edit' || tool === 'create') {
      const filePath = String(event.context?.path || event.context?.file || '');
      if (filePath && this.isProtectedPath(filePath)) {
        return {
          kind: 'protected_path_write',
          reason: event.reason || `Protected path write requested: ${filePath}`,
          approved: event.context?.approved as boolean | undefined,
          raw: event,
        };
      }
    }

    // Default: always return human_verdict (never silent drop)
    return {
      kind: 'human_verdict',
      reason: event.reason || `Permission request for ${tool}`,
      approved: event.context?.approved as boolean | undefined,
      raw: event,
    };
  }

  /**
   * Check if a bash command is destructive.
   */
  private isDestructiveCommand(command: string): boolean {
    const destructivePatterns = [
      /\brm\s+-rf\b/,
      /\brm\s+-r\b/,
      /\bdd\b/,
      /\bmkfs\b/,
      /\bformat\b/,
      /\bdelete\b/,
      /\btruncate\b/,
      /\bshred\b/,
      /\bwipe\b/,
      /\bsudo\s+rm\b/,
      /\bchmod\s+777\b/,
    ];

    return destructivePatterns.some(pattern => pattern.test(command));
  }

  /**
   * Check if the tool/context involves secret access.
   */
  private isSecretAccess(tool: string, context?: Record<string, unknown>): boolean {
    if (!context) return false;

    const secretIndicators = [
      'secret', 'password', 'token', 'key', 'credential',
      'api_key', 'apikey', 'auth', 'private', 'certificate',
    ];

    // Check tool name
    if (secretIndicators.some(indicator => tool.toLowerCase().includes(indicator))) {
      return true;
    }

    // Check context fields
    const contextStr = JSON.stringify(context).toLowerCase();
    if (secretIndicators.some(indicator => contextStr.includes(indicator))) {
      return true;
    }

    // Check specific paths
    const path = String(context.path || context.file || '');
    if (this.isSecretPath(path)) {
      return true;
    }

    return false;
  }

  /**
   * Check if path is in workspace.
   */
  private isInWorkspace(filePath: string): boolean {
    // Relative paths are in workspace
    if (filePath.startsWith('./') || filePath.startsWith('../') || !filePath.startsWith('/')) {
      return true;
    }

    // Common workspace directories
    const workspaceIndicators = [
      '/tmp/',
      '/workspace/',
      '/work/',
      '/project/',
      '/repo/',
      '/home/',
    ];

    return workspaceIndicators.some(indicator => filePath.startsWith(indicator));
  }

  /**
   * Check if path is protected.
   */
  private isProtectedPath(filePath: string): boolean {
    if (!filePath) return false;

    const protectedPatterns = [
      /^\/etc\//,
      /^\/usr\//,
      /^\/bin\//,
      /^\/sbin\//,
      /^\/root\//,
      /^\/var\/log\//,
      /^\/proc\//,
      /^\/sys\//,
      /\.env$/i,
      /\.env\./i,
      /^\.ssh\//,
      /^\.gnupg\//,
      /credentials/i,
      /secrets/i,
      /\.pem$/,
      /\.key$/,
      /\.p12$/,
      /\.pfx$/,
      /\.crt$/,
      /\.cer$/,
    ];

    return protectedPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if path is a secret file.
   */
  private isSecretPath(filePath: string): boolean {
    if (!filePath) return false;

    const secretPatterns = [
      /\.env$/i,
      /\.env\./i,
      /credentials/i,
      /secrets/i,
      /password/i,
      /\.htpasswd$/,
      /\.pgpass$/,
      /_secret/i,
      /api[_-]?key/i,
      /token/i,
    ];

    return secretPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Extract escalations for WorkerResult.
   */
  extractEscalations(events: IngestedEvents): WorkerResult['requested_escalations'] {
    return events.permissionRequests.map(req => ({
      kind: req.kind,
      reason: req.reason,
      approved: req.approved,
    }));
  }

  /**
   * Build raw_outputs from events, including event_stream.
   */
  buildRawOutputs(
    events: IngestedEvents,
    artifactIds: Array<{ artifact_id: string; kind: string }>,
  ): WorkerResult['raw_outputs'] {
    const outputs: WorkerResult['raw_outputs'] = [];

    // Add stdout if present
    const stdoutContent = events.stdout.join('\n');
    if (stdoutContent) {
      const stdoutArtifact = artifactIds.find(a => a.kind === 'log' && a.artifact_id.includes('stdout'));
      if (stdoutArtifact) {
        outputs.push({
          channel: 'stdout',
          artifact_id: stdoutArtifact.artifact_id,
        });
      }
    }

    // Add stderr if present
    const stderrContent = events.stderr.join('\n');
    if (stderrContent) {
      const stderrArtifact = artifactIds.find(a => a.kind === 'log' && a.artifact_id.includes('stderr'));
      if (stderrArtifact) {
        outputs.push({
          channel: 'stderr',
          artifact_id: stderrArtifact.artifact_id,
        });
      }
    }

    // Add transcript if present
    if (events.transcripts.length > 0) {
      const transcriptArtifact = artifactIds.find(a => a.kind === 'json' && a.artifact_id.includes('transcript'));
      if (transcriptArtifact) {
        outputs.push({
          channel: 'json',
          artifact_id: transcriptArtifact.artifact_id,
        });
      }
    }

    // Add event_stream raw output (Phase 2B: FR-B4)
    if (events.rawEvents && events.rawEvents.length > 0) {
      const eventStreamArtifact = artifactIds.find(a => a.kind === 'json' && a.artifact_id.includes('event-stream'));
      if (eventStreamArtifact) {
        outputs.push({
          channel: 'json',
          artifact_id: eventStreamArtifact.artifact_id,
        });
      }
    }

    return outputs;
  }

  /**
   * Calculate usage statistics from events.
   */
  calculateUsage(events: IngestedEvents): {
    total_tokens?: number;
    tool_calls: number;
    permission_requests: number;
    session_events: number;
  } {
    return {
      total_tokens: events.transcripts.reduce((sum, t) => sum + (t.tokens || 0), 0),
      tool_calls: events.toolUses.length,
      permission_requests: events.permissionRequests.length,
      session_events: events.sessionLifecycle.length,
    };
  }

  /**
   * Generate transcript summary for quick review.
   */
  generateTranscriptSummary(events: IngestedEvents): string {
    const lines: string[] = [];

    lines.push(`# Execution Summary`);
    lines.push('');
    lines.push(`## Statistics`);
    lines.push(`- Total events: ${events.ingestionMeta.totalEvents}`);
    lines.push(`- Permission requests: ${events.permissionRequests.length}`);
    lines.push(`- Tool calls: ${events.toolUses.length}`);
    lines.push(`- Transcript messages: ${events.transcripts.length}`);
    lines.push('');

    if (events.executionCompletion) {
      lines.push(`## Completion`);
      lines.push(`- Status: ${events.executionCompletion.status}`);
      if (events.executionCompletion.exit_code) {
        lines.push(`- Exit code: ${events.executionCompletion.exit_code}`);
      }
      if (events.executionCompletion.reason) {
        lines.push(`- Reason: ${events.executionCompletion.reason}`);
      }
      lines.push('');
    }

    if (events.permissionRequests.length > 0) {
      lines.push(`## Permission Requests`);
      for (const req of events.permissionRequests) {
        lines.push(`- ${req.kind}: ${req.reason}`);
      }
      lines.push('');
    }

    if (events.toolUses.length > 0) {
      lines.push(`## Tool Uses`);
      for (const tool of events.toolUses) {
        lines.push(`- ${tool.tool}: ${tool.status}`);
        if (tool.error) {
          lines.push(`  Error: ${tool.error}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * Create an event ingestor.
 */
export function createOpenCodeEventIngestor(config?: EventIngestorConfig): OpenCodeEventIngestor {
  return new OpenCodeEventIngestor(config);
}