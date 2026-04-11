/**
 * OpenCode Session Executor
 *
 * Executes jobs using opencode serve sessions instead of standalone run.
 * Phase 2B: Enhanced transcript and event stream collection.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { WorkerJob } from '../types.js';
import type { OpenCodeSessionRegistry, SessionSearchCriteria } from '../domain/worker/opencode-session-registry.js';
import {
  generatePolicyFingerprint,
  type TranscriptIndexMetadata,
} from '../domain/worker/opencode-session-registry.js';
import { getLogger } from '../monitoring/index.js';
import {
  createOpenCodeEventIngestor,
  OpenCodeEventIngestor,
  type EventStreamContainer,
  type OpenCodeEvent,
  type CleanupReason,
} from '../domain/worker/opencode-event-ingestor.js';

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

export class OpenCodeSessionExecutor {
  private readonly logger = getLogger().child({ component: 'OpenCodeSessionExecutor' });
  private readonly config: Required<SessionExecutorConfig>;
  private readonly registry: OpenCodeSessionRegistry;
  private readonly eventIngestor: OpenCodeEventIngestor;

  constructor(config: SessionExecutorConfig, registry: OpenCodeSessionRegistry) {
    this.config = {
      baseUrl: config.baseUrl,
      workDir: config.workDir || '/tmp/shipyard-session-jobs',
      timeout: config.timeout || 600000,
      debug: config.debug || false,
      includeRawEvents: config.includeRawEvents ?? true,
    };
    this.registry = registry;

    this.eventIngestor = createOpenCodeEventIngestor({
      debug: this.config.debug,
      includeRawEvents: this.config.includeRawEvents,
    });

    void this.ensureWorkDir();
  }

  /**
   * Execute a job using session-based approach.
   * Will reuse an existing session if eligible, or create a new one.
   */
  async execute(job: WorkerJob): Promise<SessionExecutionResult> {
    const workPath = this.resolveWorkPath(job);
    const startedAt = Date.now();
    let eventStreamContainer: EventStreamContainer | undefined;

    try {
      await mkdir(workPath, { recursive: true });

      // Build criteria for session lookup
      const criteria: SessionSearchCriteria = {
        taskId: job.task_id,
        workspaceRef: {
          kind: job.workspace_ref.kind,
          workspace_id: job.workspace_ref.workspace_id,
        },
        logicalWorker: job.worker_type,
        stageBucket: job.stage,
        policyFingerprint: generatePolicyFingerprint(job),
      };

      // Try to find reusable session
      let session = this.registry.findReusableSession(criteria);
      let reusedSession = false;

      if (session) {
        // Lease the session
        const leased = this.registry.leaseSession(session.sessionId, job.job_id);
        if (leased) {
          reusedSession = true;
          this.logger.info('Using reusable session', {
            sessionId: session.sessionId,
            jobId: job.job_id,
          });

          // Create event stream container for reused session
          eventStreamContainer = this.eventIngestor.createEventStreamContainer(job.job_id, session.sessionId);

          // Add session connected event
          this.eventIngestor.addEvent(eventStreamContainer, {
            type: 'session_lifecycle',
            id: `lifecycle-${Date.now()}`,
            lifecycle_event: 'connected',
            timestamp: Date.now(),
            sessionId: session.sessionId,
            reason: 'session_reused',
            category: 'session_lifecycle',
          });
        } else {
          // Lease failed, create new session
          session = null;
        }
      }

      // Create new session if no reusable one
      if (!session) {
        const newSessionId = await this.createSession(job, workPath);
        session = this.registry.createSessionRecord(
          newSessionId,
          criteria,
          this.config.baseUrl,
        );
        this.registry.leaseSession(newSessionId, job.job_id);
        this.registry.markSessionReady(newSessionId);

        // Create event stream container for new session
        eventStreamContainer = this.eventIngestor.createEventStreamContainer(job.job_id, newSessionId);

        // Add session created event
        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'session_lifecycle',
          id: `lifecycle-${Date.now()}`,
          lifecycle_event: 'created',
          timestamp: Date.now(),
          sessionId: newSessionId,
          reason: 'new_session',
          category: 'session_lifecycle',
        });

        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'session_lifecycle',
          id: `lifecycle-${Date.now() + 1}`,
          lifecycle_event: 'connected',
          timestamp: Date.now(),
          sessionId: newSessionId,
          reason: 'session_created',
          category: 'session_lifecycle',
        });
      }

      // Build prompt and config
      const prompt = job.input_prompt || this.buildPrompt(job);
      const configFile = path.join(workPath, 'opencode.json');
      await writeFile(configFile, JSON.stringify(this.buildProjectConfig(job), null, 2), 'utf8');
      await writeFile(path.join(workPath, 'prompt.md'), prompt, 'utf8');

      // Add execution started event
      if (eventStreamContainer) {
        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'session_lifecycle',
          id: `lifecycle-${Date.now()}`,
          lifecycle_event: 'started',
          timestamp: Date.now(),
          sessionId: session.sessionId,
          reason: `job_${job.job_id}_started`,
          category: 'session_lifecycle',
        });
      }

      // Run prompt in session
      const result = await this.runInSession(session.sessionId, prompt, workPath, job.job_id, eventStreamContainer);
      const duration = Date.now() - startedAt;

      // Add execution completion event
      if (eventStreamContainer) {
        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'execution_completion',
          id: `completion-${Date.now()}`,
          status: result.success ? 'success' : 'failed',
          timestamp: Date.now(),
          exit_code: result.success ? 0 : 1,
          reason: result.error || 'completed',
          category: 'execution_completion',
        });

        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'session_lifecycle',
          id: `lifecycle-${Date.now() + 1}`,
          lifecycle_event: result.success ? 'completed' : 'failed',
          timestamp: Date.now(),
          sessionId: session.sessionId,
          reason: result.error || 'execution_finished',
          category: 'session_lifecycle',
        });
      }

      // Release session lease
      this.registry.releaseSession(session.sessionId, job.job_id);

      // Collect artifacts including transcript and event stream
      const artifacts = await this.collectArtifacts(workPath, job.job_id, eventStreamContainer);

      // Mark session dead if execution failed
      let cleanupReason: CleanupReason | undefined;
      if (!result.success) {
        cleanupReason = 'task_failed';
        this.registry.markSessionDead(session.sessionId, result.error, cleanupReason);
      }

      // Finalize event stream
      if (eventStreamContainer) {
        this.eventIngestor.finalizeContainer(eventStreamContainer);

        // Set artifact URIs
        eventStreamContainer.transcriptArtifactUri = artifacts.find(a => a.artifact_id.includes('transcript'))?.uri;
        eventStreamContainer.eventStreamArtifactUri = artifacts.find(a => a.artifact_id.includes('event-stream'))?.uri;

        // Phase 2C: Update transcript index metadata (FR-C5)
        const transcriptIndex = this.buildTranscriptIndex(eventStreamContainer);
        this.registry.updateTranscriptIndex(session.sessionId, transcriptIndex);
      }

      return {
        success: result.success,
        sessionId: session.sessionId,
        reusedSession,
        output: result.output,
        error: result.error,
        artifacts,
        duration_ms: duration,
        transcript: result.transcript,
        eventStream: eventStreamContainer,
        cleanupReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Session execution failed', { jobId: job.job_id, error: message });

      // Add failure event if container exists
      if (eventStreamContainer) {
        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'execution_completion',
          id: `completion-${Date.now()}`,
          status: 'failed',
          timestamp: Date.now(),
          exit_code: 1,
          reason: message,
          category: 'execution_completion',
        });

        this.eventIngestor.addEvent(eventStreamContainer, {
          type: 'session_lifecycle',
          id: `lifecycle-${Date.now() + 1}`,
          lifecycle_event: 'failed',
          timestamp: Date.now(),
          reason: message,
          category: 'session_lifecycle',
        });

        this.eventIngestor.finalizeContainer(eventStreamContainer);
      }

      return {
        success: false,
        error: message,
        duration_ms: Date.now() - startedAt,
        eventStream: eventStreamContainer,
        cleanupReason: 'task_failed',
      };
    }
  }

  /**
   * Cancel a running session execution.
   */
  async cancel(sessionId: string, jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: `Job ${jobId} cancelled` }),
        signal: AbortSignal.timeout(10000),
      });

      const ok = response.ok;
      if (ok) {
        this.registry.markSessionDead(sessionId, 'Cancelled', 'task_cancelled');
        this.logger.info('Session cancelled', { sessionId, jobId, cleanupReason: 'task_cancelled' });
      }

      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Failed to cancel session', { sessionId, error: message });
      this.registry.markSessionDead(sessionId, `Cancel failed: ${message}`, 'task_cancelled');
      return false;
    }
  }

  /**
   * Get session status from server.
   */
  async getSessionStatus(sessionId: string): Promise<{ status: string; state: string } | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { status?: string; state?: string };
      return {
        status: data.status || 'unknown',
        state: data.state || 'unknown',
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a new session on the server.
   */
  private async createSession(job: WorkerJob, workPath: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: job.task_id,
        job_id: job.job_id,
        stage: job.stage,
        worker_type: job.worker_type,
        workspace_path: workPath,
        config: this.buildProjectConfig(job),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to create session: ${response.status} ${errorBody}`);
    }

    const data = await response.json() as SessionCreateResponse;
    this.logger.info('Session created', { sessionId: data.id, jobId: job.job_id });

    return data.id;
  }

  /**
   * Run a prompt in an existing session.
   */
  private async runInSession(
    sessionId: string,
    prompt: string,
    workPath: string,
    jobId: string,
    eventStreamContainer?: EventStreamContainer,
  ): Promise<{ success: boolean; output?: string; error?: string; transcript?: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Session run failed: ${response.status} ${errorBody}`,
        };
      }

      const data = await response.json() as SessionRunResponse;

      // Save outputs
      const stdout = data.output || '';
      const transcript = data.transcript || '';

      await writeFile(path.join(workPath, 'stdout.log'), stdout, 'utf8');
      await writeFile(path.join(workPath, 'transcript.json'), transcript, 'utf8');

      // Parse and ingest transcript events
      if (transcript && eventStreamContainer) {
        const parsedEvents = this.eventIngestor.parseTranscriptJson(transcript, sessionId);
        for (const event of parsedEvents) {
          this.eventIngestor.addEvent(eventStreamContainer, event);
        }
      }

      // Ingest any events returned directly
      if (data.events && eventStreamContainer) {
        for (const event of data.events) {
          this.eventIngestor.addEvent(eventStreamContainer, event);
        }
      }

      // Poll for completion if status is 'running'
      if (data.status === 'running') {
        const finalResult = await this.pollForCompletion(sessionId, workPath, eventStreamContainer);
        return finalResult;
      }

      return {
        success: data.status === 'completed' || data.status === 'success',
        output: stdout,
        transcript,
        error: data.error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Poll session until completion.
   */
  private async pollForCompletion(
    sessionId: string,
    workPath: string,
    eventStreamContainer?: EventStreamContainer,
  ): Promise<{ success: boolean; output?: string; error?: string; transcript?: string }> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < this.config.timeout) {
      const status = await this.getSessionStatus(sessionId);

      if (!status) {
        return {
          success: false,
          error: 'Session status unavailable',
        };
      }

      if (status.status === 'completed' || status.status === 'success') {
        // Fetch final output
        const outputResponse = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/output`, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        });

        let output = '';
        let transcript = '';

        if (outputResponse.ok) {
          const data = await outputResponse.json() as { output?: string; transcript?: string; events?: OpenCodeEvent[] };
          output = data.output || '';
          transcript = data.transcript || '';

          await writeFile(path.join(workPath, 'stdout.log'), output, 'utf8');
          await writeFile(path.join(workPath, 'transcript.json'), transcript, 'utf8');

          // Parse and ingest final transcript events
          if (transcript && eventStreamContainer) {
            const parsedEvents = this.eventIngestor.parseTranscriptJson(transcript, sessionId);
            for (const event of parsedEvents) {
              this.eventIngestor.addEvent(eventStreamContainer, event);
            }
          }

          // Ingest any events returned directly
          if (data.events && eventStreamContainer) {
            for (const event of data.events) {
              this.eventIngestor.addEvent(eventStreamContainer, event);
            }
          }
        }

        return {
          success: true,
          output,
          transcript,
        };
      }

      if (status.status === 'failed' || status.status === 'error') {
        return {
          success: false,
          error: `Session failed with status: ${status.status}`,
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    return {
      success: false,
      error: 'Session execution timed out',
    };
  }

  /**
   * Build project config for session.
   */
  private buildProjectConfig(job: WorkerJob): Record<string, unknown> {
    const permissions = this.buildPermissions(job);
    return {
      $schema: 'https://opencode.ai/config.json',
      permission: permissions,
    };
  }

  /**
   * Build permissions based on stage.
   */
  private buildPermissions(job: WorkerJob): Record<string, unknown> {
    const allowNetwork = job.approval_policy.allowed_side_effect_categories?.includes('network_access') ?? false;

    if (job.stage === 'plan') {
      return {
        edit: 'deny',
        bash: 'deny',
        webfetch: 'deny',
      };
    }

    if (job.stage === 'acceptance') {
      return {
        edit: 'deny',
        bash: 'allow',
        webfetch: allowNetwork ? 'allow' : 'deny',
      };
    }

    return {
      edit: 'allow',
      bash: 'allow',
      webfetch: allowNetwork ? 'allow' : 'deny',
    };
  }

  /**
   * Resolve work path for a job.
   */
  private resolveWorkPath(job: WorkerJob): string {
    if (job.workspace_ref.kind === 'host_path' && path.isAbsolute(job.workspace_ref.workspace_id)) {
      return job.workspace_ref.workspace_id;
    }

    return path.join(this.config.workDir, job.job_id);
  }

  /**
   * Build prompt from job.
   */
  private buildPrompt(job: WorkerJob): string {
    const lines: string[] = [];

    lines.push(`Task ID: ${job.task_id}`);
    lines.push(`Stage: ${job.stage}`);
    lines.push('');
    lines.push(job.input_prompt);

    return lines.join('\n');
  }

  /**
   * Collect artifacts from execution, including transcript and event stream.
   */
  private async collectArtifacts(
    workPath: string,
    jobId: string,
    eventStreamContainer?: EventStreamContainer,
  ): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'json' | 'other';
    uri: string;
  }>> {
    const artifacts: Array<{
      artifact_id: string;
      kind: 'log' | 'report' | 'json' | 'other';
      uri: string;
    }> = [];

    // Standard artifacts
    const candidates: Array<{ file: string; kind: 'log' | 'report' | 'json' | 'other' }> = [
      { file: 'stdout.log', kind: 'log' },
      { file: 'transcript.json', kind: 'json' },
      { file: 'prompt.md', kind: 'report' },
      { file: 'opencode.json', kind: 'json' },
    ];

    for (const candidate of candidates) {
      const absolute = path.join(workPath, candidate.file);
      if (existsSync(absolute)) {
        artifacts.push({
          artifact_id: `${jobId}-${candidate.file.replace(/[^a-zA-Z0-9]+/g, '-')}`,
          kind: candidate.kind,
          uri: absolute,
        });
      }
    }

    // Phase 2B: Save event stream as artifact
    if (eventStreamContainer && this.config.includeRawEvents) {
      const eventStreamPath = path.join(workPath, 'event-stream.json');
      const transcriptSummaryPath = path.join(workPath, 'transcript-summary.md');

      try {
        // Save raw event stream
        await writeFile(
          eventStreamPath,
          JSON.stringify({
            jobId: eventStreamContainer.jobId,
            sessionId: eventStreamContainer.sessionId,
            events: eventStreamContainer.events,
            eventCounts: eventStreamContainer.ingested.eventCounts,
            ingestionMeta: eventStreamContainer.ingested.ingestionMeta,
          }, null, 2),
          'utf8',
        );

        artifacts.push({
          artifact_id: `${jobId}-event-stream`,
          kind: 'json',
          uri: eventStreamPath,
        });

        // Save transcript summary
        const summary = this.eventIngestor.generateTranscriptSummary(eventStreamContainer.ingested);
        await writeFile(transcriptSummaryPath, summary, 'utf8');

        artifacts.push({
          artifact_id: `${jobId}-transcript-summary`,
          kind: 'report',
          uri: transcriptSummaryPath,
        });

        this.logger.info('Event stream artifacts saved', {
          jobId,
          sessionId: eventStreamContainer.sessionId,
          eventStreamPath,
          transcriptSummaryPath,
          totalEvents: eventStreamContainer.events.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn('Failed to save event stream artifacts', { jobId, error: message });
      }
    }

    return artifacts;
  }

  private async ensureWorkDir(): Promise<void> {
    if (!existsSync(this.config.workDir)) {
      await mkdir(this.config.workDir, { recursive: true });
    }
  }

  /**
   * Build transcript index metadata from event stream.
   * Phase 2C (FR-C5): Creates searchable metadata for transcripts.
   */
  private buildTranscriptIndex(eventStreamContainer: EventStreamContainer): TranscriptIndexMetadata {
    const events = eventStreamContainer.events;
    const ingested = eventStreamContainer.ingested;

    // Count messages and tools from event counts
    const messageCount = ingested.eventCounts?.transcript_message || 0;
    const toolCount = ingested.eventCounts?.tool_use || 0;
    const permissionRequestCount = ingested.eventCounts?.permission_request || 0;

    // Extract last tool names (up to 5)
    const lastToolNames: string[] = [];
    for (let i = events.length - 1; i >= 0 && lastToolNames.length < 5; i--) {
      const event = events[i];
      if (event.type === 'tool_use' && event.tool) {
        lastToolNames.push(event.tool);
      }
    }

    // Extract summary keywords from transcript messages (up to 10)
    const summaryKeywords: string[] = [];
    for (const event of events) {
      if (event.type === 'transcript' && 'content' in event) {
        // Extract keywords: capitalized words, technical terms
        const content = String(event.content || '');
        const keywords = this.extractKeywords(content);
        for (const keyword of keywords) {
          if (!summaryKeywords.includes(keyword) && summaryKeywords.length < 10) {
            summaryKeywords.push(keyword);
          }
        }
      }
    }

    // Calculate transcript size from event stream
    const transcriptSizeBytes = JSON.stringify(events).length;

    return {
      messageCount,
      toolCount,
      permissionRequestCount,
      summaryKeywords,
      lastToolNames,
      transcriptSizeBytes,
    };
  }

  /**
   * Extract keywords from transcript content.
   * Phase 2C helper for transcript indexing.
   */
  private extractKeywords(content: string): string[] {
    const keywords: string[] = [];

    // Look for common patterns: file paths, function names, error types
    const patterns = [
      // File paths
      /(?:src\/|lib\/|test\/|docs\/)([\w-]+\/[\w-]+\.(?:ts|js|py|go|md))/g,
      // Function/method names
      /\b([a-zA-Z][a-zA-Z0-9_]*(?:\s*\(|\s*\{))/g,
      // Error types
      /\b([A-Z][a-zA-Z]*Error|Exception|Failure)\b/g,
      // Config keys
      /\b([a-zA-Z_][a-zA-Z0-9_]*(?:=|:))/g,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Clean up the match
          const cleaned = match.replace(/[(){}=:]/g, '').trim();
          if (cleaned.length > 2 && cleaned.length < 50) {
            keywords.push(cleaned);
          }
        }
      }
    }

    return keywords;
  }

  async readArtifact(uri: string): Promise<string | null> {
    if (!path.isAbsolute(uri) || !existsSync(uri)) {
      return null;
    }

    return readFile(uri, 'utf8');
  }
}

/**
 * Create a session executor.
 */
export function createOpenCodeSessionExecutor(
  config: SessionExecutorConfig,
  registry: OpenCodeSessionRegistry,
): OpenCodeSessionExecutor {
  return new OpenCodeSessionExecutor(config, registry);
}