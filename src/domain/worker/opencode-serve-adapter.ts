/**
 * OpenCode Serve Adapter
 *
 * WorkerAdapter implementation using opencode serve with session reuse.
 * Falls back to run mode if serve fails.
 * Phase 2C: Agent-aware session reuse, warm pool, and transcript indexing.
 */

import {
  BaseWorkerAdapter,
  type CancelResult,
  type JobPollResult,
  type JobSubmissionResult,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type WorkerJob,
} from './worker-adapter.js';
import type { Capability, WorkerType, WorkerResult } from '../../types.js';
import { getConfig } from '../../config/index.js';
import { getLogger } from '../../monitoring/index.js';
import type { OpenCodeServerManager } from '../../infrastructure/opencode-server-manager.js';
import type { OpenCodeSessionExecutor, SessionExecutionResult } from '../../infrastructure/opencode-session-executor.js';
import type { OpenCodeSessionRegistry } from './session-registry/index.js';
import {
  createOpenCodeEventIngestor,
  OpenCodeEventIngestor,
  type EventStreamContainer,
  type FallbackReason,
  type IngestedEvents,
} from './opencode-event-ingestor.js';
import { CleanupReasons } from './session-registry/index.js';
import {
  createOpenCodeExecutor,
  type OpenCodeExecutor,
} from '../../infrastructure/opencode-executor.js';

export interface OpenCodeServeAdapterConfig extends WorkerAdapterConfig {
  workerType: WorkerType;
  serverManager: OpenCodeServerManager;
  sessionRegistry: OpenCodeSessionRegistry;
  sessionExecutor: OpenCodeSessionExecutor;
  fallbackExecutor?: OpenCodeExecutor;
  model?: string;
  timeout?: number;
  debug?: boolean;
}

interface ServeJobState {
  job: WorkerJob;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: WorkerResult;
  error?: string;
  sessionId?: string;
  reusedSession?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: FallbackReason;
  eventStream?: EventStreamContainer;
  startedAt: number;
  executionPromise?: Promise<ServeExecutionResult>;
}

interface ServeExecutionResult {
  success: boolean;
  sessionId?: string;
  reusedSession?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: FallbackReason;
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
  cleanupReason?: string;
}

/**
 * Audit event types for Phase 2C.
 */
export const ServeAuditEvents = {
  FALLBACK_TRIGGERED: 'opencode.run_fallback',
  EVENT_STREAM_INGESTION_STARTED: 'opencode.event_stream_ingestion_started',
  EVENT_STREAM_INGESTION_FAILED: 'opencode.event_stream_ingestion_failed',
  TRANSCRIPT_PERSISTED: 'opencode.transcript_persisted',
  SESSION_CREATED: 'opencode.session_created',
  SESSION_REUSED: 'opencode.session_reused',
  ORPHAN_DETECTED: 'opencode.orphan_detected',
  ORPHAN_CLEANED: 'opencode.orphan_cleaned',
  CLEANUP_REASON_CATEGORIZED: 'opencode.cleanup_reason_categorized',
};

export class OpenCodeServeAdapter extends BaseWorkerAdapter {
  readonly workerType: WorkerType;
  private readonly logger = getLogger().child({ component: 'OpenCodeServeAdapter' });
  private readonly serverManager: OpenCodeServerManager;
  private readonly sessionRegistry: OpenCodeSessionRegistry;
  private readonly sessionExecutor: OpenCodeSessionExecutor;
  private readonly fallbackExecutor: OpenCodeExecutor;
  private readonly eventIngestor: OpenCodeEventIngestor;
  private readonly model: string;
  private readonly jobStates = new Map<string, ServeJobState>();
  private readonly debug: boolean;

  // Statistics tracking
  private stats = {
    jobsSubmitted: 0,
    fallbacksUsed: 0,
    fallbacksByReason: {} as Record<FallbackReason, number>,
    sessionsReused: 0,
    eventStreamsIngested: 0,
    transcriptsPersisted: 0,
    // Phase 2C stats
    warmPoolHits: 0,
    agentProfileMatches: 0,
    agentProfileMismatches: 0,
  };

  constructor(config: OpenCodeServeAdapterConfig) {
    super(config);

    const globalConfig = getConfig();
    this.workerType = config.workerType;
    this.serverManager = config.serverManager;
    this.sessionRegistry = config.sessionRegistry;
    this.sessionExecutor = config.sessionExecutor;
    this.model = config.model || (
      config.workerType === 'codex'
        ? globalConfig.worker.codexModel
        : globalConfig.worker.claudeModel
    );
    this.debug = config.debug ?? globalConfig.worker.debugMode;

    // Fallback executor for when serve fails
    this.fallbackExecutor = config.fallbackExecutor || createOpenCodeExecutor({
      cliPath: globalConfig.worker.opencodeCliPath,
      model: this.model,
      timeout: config.timeout || globalConfig.worker.jobTimeout,
      workDir: globalConfig.worker.workDir,
      debug: this.debug,
    });

    this.eventIngestor = createOpenCodeEventIngestor({
      debug: this.debug,
      includeRawEvents: true,
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing OpenCode Serve adapter', {
      workerType: this.workerType,
      mode: 'serve',
    });

    // Try to start server
    const serverReady = await this.serverManager.ensureServerReady();

    if (!serverReady) {
      this.logger.warn('OpenCode serve not available, will use run fallback', {
        fallbackReason: 'server_start_failed',
      });
    }

    await super.initialize();
  }

  async isReady(): Promise<boolean> {
    // Always ready - can fallback to run mode
    return this.initialized;
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    const capabilities: Capability[] = this.workerType === 'claude_code'
      ? ['plan', 'edit_repo', 'run_tests', 'needs_approval', 'produces_patch', 'produces_verdict', 'networked']
      : ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'];

    return {
      worker_type: this.workerType,
      capabilities,
      max_concurrent_jobs: 5,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0-serve-phase2c',
      metadata: {
        model: this.model,
        substrate: 'opencode',
        execution_mode: 'serve',
        supports_tools: true,
        supports_session_reuse: true,
        supports_event_stream: true,
        phase: '2c',
      },
    };
  }

  async submitJob(job: WorkerJob): Promise<JobSubmissionResult> {
    const validation = this.validateJob(job);
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        error: validation.errors.join(', '),
      };
    }

    const externalJobId = `opencode-serve-${job.worker_type}-${job.job_id}-${Date.now()}`;
    const state: ServeJobState = {
      job,
      status: 'queued',
      startedAt: Date.now(),
    };
    this.jobStates.set(externalJobId, state);
    this.stats.jobsSubmitted++;

    // Check if server is ready
    const serverReady = await this.serverManager.ensureServerReady();

    if (!serverReady) {
      // Fallback to run mode with reason tracking
      state.fallbackUsed = true;
      state.fallbackReason = 'server_start_failed';
      this.recordFallback('server_start_failed');

      this.logger.warn('Using run fallback due to serve unavailable', {
        jobId: job.job_id,
        fallbackReason: 'server_start_failed',
        auditEvent: ServeAuditEvents.FALLBACK_TRIGGERED,
      });

      state.status = 'running';
      state.executionPromise = this.executeWithFallback(job, 'server_start_failed');
    } else {
      state.status = 'running';
      state.executionPromise = this.executeWithServe(job);
    }

    state.executionPromise.then((result) => {
      state.sessionId = result.sessionId;
      state.reusedSession = result.reusedSession;
      state.fallbackUsed = result.fallbackUsed;
      state.fallbackReason = result.fallbackReason;
      state.eventStream = result.eventStream;

      if (result.success) {
        state.result = this.convertToWorkerResult(job, result);
        state.status = 'succeeded';
      } else {
        state.error = result.error;
        state.status = 'failed';
      }

      // Audit: fallback usage with reason
      if (result.fallbackUsed && result.fallbackReason) {
        this.logger.info('Job executed via run fallback', {
          jobId: job.job_id,
          fallbackReason: result.fallbackReason,
          auditEvent: ServeAuditEvents.FALLBACK_TRIGGERED,
          duration_ms: result.duration_ms,
        });
      }

      // Audit: session reuse
      if (result.reusedSession) {
        this.stats.sessionsReused++;
        this.logger.info('Session reused', {
          jobId: job.job_id,
          sessionId: result.sessionId,
          stage: job.stage,
          auditEvent: ServeAuditEvents.SESSION_REUSED,
        });
      }

      // Audit: transcript persisted
      if (result.eventStream) {
        this.stats.eventStreamsIngested++;
        this.logger.info('Event stream ingested', {
          jobId: job.job_id,
          sessionId: result.sessionId,
          totalEvents: result.eventStream.events.length,
          auditEvent: ServeAuditEvents.EVENT_STREAM_INGESTION_STARTED,
        });
      }
    }).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'failed';

      this.logger.error('Job execution failed', {
        jobId: job.job_id,
        error: state.error,
        fallbackUsed: state.fallbackUsed,
        fallbackReason: state.fallbackReason,
      });
    });

    return {
      success: true,
      external_job_id: externalJobId,
      status: 'queued',
      estimated_duration_ms: this.estimateDuration(job.stage),
    };
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    const state = this.jobStates.get(externalJobId);
    if (!state) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    const elapsed = Date.now() - state.startedAt;
    const estimated = this.estimateDuration(state.job.stage);

    if (state.status === 'queued') {
      return {
        external_job_id: externalJobId,
        status: 'queued',
        progress: 0,
      };
    }

    if (state.status === 'running') {
      return {
        external_job_id: externalJobId,
        status: 'running',
        progress: Math.min(95, Math.floor((elapsed / estimated) * 100)),
        estimated_remaining_ms: Math.max(0, estimated - elapsed),
      };
    }

    if (state.status === 'succeeded' && state.result) {
      this.jobStates.delete(externalJobId);
      return {
        external_job_id: externalJobId,
        status: 'succeeded',
        progress: 100,
        result: state.result,
      };
    }

    this.jobStates.delete(externalJobId);
    return {
      external_job_id: externalJobId,
      status: 'failed',
      error: state.error || 'OpenCode serve execution failed',
    };
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const state = this.jobStates.get(externalJobId);
    if (!state) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found',
      };
    }

    // Cancel via session executor if serve mode
    if (state.sessionId && !state.fallbackUsed) {
      const cancelled = await this.sessionExecutor.cancel(state.sessionId, state.job.job_id);
      this.jobStates.delete(externalJobId);

      // Record cleanup reason
      this.logger.info('Session cancelled', {
        sessionId: state.sessionId,
        jobId: state.job.job_id,
        cleanupReason: CleanupReasons.TASK_CANCELLED,
        auditEvent: ServeAuditEvents.CLEANUP_REASON_CATEGORIZED,
      });

      return {
        success: cancelled,
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : 'Failed to cancel session',
      };
    }

    // Fallback mode: use executor cancel
    const cancelled = await this.fallbackExecutor.cancel(state.job.job_id);
    this.jobStates.delete(externalJobId);

    return {
      success: cancelled,
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? undefined : 'Failed to cancel fallback job',
    };
  }

  async collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'html' | 'other';
    uri: string;
    size_bytes?: number;
  }>> {
    const state = this.jobStates.get(externalJobId);
    return state?.result?.artifacts ?? [];
  }

  normalizeEscalation(rawEscalation: unknown): {
    kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
    reason: string;
    approved?: boolean;
  } | null {
    if (!rawEscalation || typeof rawEscalation !== 'object') {
      return null;
    }

    const esc = rawEscalation as Record<string, unknown>;

    // Permission request normalization - handle both explicit permission requests
    // and escalation objects that just have a tool field
    if (esc.permission === 'ask' || esc.type === 'permission_request' || esc.tool) {
      const tool = String(esc.tool || '');
      const reason = String(esc.reason || esc.action || 'Permission request');

      // Determine kind based on tool/action
      let kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict' = 'human_verdict';

      if (tool === 'webfetch' || tool.includes('fetch') || tool.includes('http')) {
        kind = 'network_access';
      } else if (tool === 'bash' && this.isDestructiveCommand(String(esc.action || ''))) {
        kind = 'destructive_tool';
      } else if (tool === 'write' || tool === 'edit') {
        const context = esc.context as Record<string, unknown> | undefined;
        const path = String(esc.path || context?.path || '');
        if (this.isProtectedPath(path)) {
          kind = 'protected_path_write';
        } else if (path && !this.isInWorkspace(path)) {
          kind = 'workspace_outside_write';
        }
      } else if (this.isSecretAccess(tool, esc)) {
        kind = 'secret_access';
      }

      return {
        kind,
        reason,
        approved: esc.approved as boolean | undefined,
      };
    }

    return super.normalizeEscalation(rawEscalation);
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down OpenCode Serve adapter', {
      stats: this.stats,
    });

    // Cancel all running jobs
    for (const [externalJobId, state] of this.jobStates.entries()) {
      if (state.status === 'running') {
        await this.cancelJob(externalJobId);
      }
    }

    this.jobStates.clear();
    await super.shutdown();
  }

  /**
   * Record fallback usage for statistics and audit.
   */
  private recordFallback(reason: FallbackReason): void {
    this.stats.fallbacksUsed++;
    this.stats.fallbacksByReason[reason] = (this.stats.fallbacksByReason[reason] || 0) + 1;
  }

  /**
   * Execute job using serve mode with session reuse.
   */
  private async executeWithServe(job: WorkerJob): Promise<ServeExecutionResult> {
    try {
      const result = await this.sessionExecutor.execute(job);

      // Check if serve execution indicated fallback was needed internally
      if (result.success === false && result.cleanupReason) {
        // Session executor may have already handled fallback
        const fallbackReason = this.determineFallbackReason(result);
        if (fallbackReason) {
          this.recordFallback(fallbackReason);
          return {
            ...result,
            fallbackUsed: true,
            fallbackReason,
          };
        }
      }

      return {
        success: result.success,
        sessionId: result.sessionId,
        reusedSession: result.reusedSession,
        fallbackUsed: false,
        output: result.output,
        error: result.error,
        artifacts: result.artifacts,
        duration_ms: result.duration_ms,
        transcript: result.transcript,
        eventStream: result.eventStream,
        cleanupReason: result.cleanupReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackReason = this.determineFallbackReasonFromError(message);

      this.logger.error('Serve execution failed, falling back to run', {
        jobId: job.job_id,
        error: message,
        fallbackReason,
        auditEvent: ServeAuditEvents.FALLBACK_TRIGGERED,
      });

      this.recordFallback(fallbackReason);

      // Fallback to run mode
      return await this.executeWithFallback(job, fallbackReason);
    }
  }

  /**
   * Execute job using run fallback mode.
   */
  private async executeWithFallback(job: WorkerJob, fallbackReason: FallbackReason): Promise<ServeExecutionResult> {
    this.logger.info('Executing with run fallback', {
      jobId: job.job_id,
      fallbackReason,
    });

    const fallbackResult = await this.fallbackExecutor.execute(job);

    // Create minimal event stream for fallback execution
    const eventStream = this.eventIngestor.createEventStreamContainer(job.job_id, `fallback-${Date.now()}`);

    this.eventIngestor.addEvent(eventStream, {
      type: 'session_lifecycle',
      id: `lifecycle-${Date.now()}`,
      lifecycle_event: 'created',
      timestamp: Date.now(),
      reason: 'fallback_execution',
      category: 'session_lifecycle',
    });

    this.eventIngestor.addEvent(eventStream, {
      type: 'execution_completion',
      id: `completion-${Date.now()}`,
      status: fallbackResult.success ? 'success' : 'failed',
      timestamp: Date.now(),
      exit_code: fallbackResult.exit_code,
      reason: fallbackResult.error || 'fallback_completed',
      category: 'execution_completion',
    });

    this.eventIngestor.finalizeContainer(eventStream);

    return {
      success: fallbackResult.success,
      fallbackUsed: true,
      fallbackReason,
      output: fallbackResult.output,
      error: fallbackResult.error,
      artifacts: fallbackResult.artifacts,
      duration_ms: fallbackResult.duration_ms,
      eventStream,
    };
  }

  /**
   * Determine fallback reason from execution result.
   */
  private determineFallbackReason(result: SessionExecutionResult): FallbackReason | undefined {
    if (!result.error) return undefined;

    if (result.error.includes('timeout') || result.error.includes('timed out')) {
      return 'session_timeout';
    }
    if (result.error.includes('crash') || result.error.includes('killed')) {
      return 'session_crash';
    }
    if (result.error.includes('connection') || result.error.includes('disconnect')) {
      return 'connection_lost';
    }
    if (result.error.includes('API') || result.error.includes('status')) {
      return 'api_error';
    }
    if (result.error.includes('create session')) {
      return 'session_create_failed';
    }
    if (result.error.includes('run') || result.error.includes('execute')) {
      return 'session_run_failed';
    }

    return 'session_run_failed';
  }

  /**
   * Determine fallback reason from error message.
   */
  private determineFallbackReasonFromError(message: string): FallbackReason {
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'session_timeout';
    }
    if (message.includes('crash') || message.includes('killed') || message.includes('ENOENT')) {
      return 'session_crash';
    }
    if (message.includes('connection') || message.includes('disconnect') || message.includes('ECONNREFUSED')) {
      return 'connection_lost';
    }
    if (message.includes('health') || message.includes('status')) {
      return 'server_health_check_failed';
    }
    if (message.includes('create session') || message.includes('Failed to create')) {
      return 'session_create_failed';
    }

    return 'session_run_failed';
  }

  /**
   * Convert execution result to WorkerResult with event stream integration.
   */
  private convertToWorkerResult(job: WorkerJob, result: ServeExecutionResult): WorkerResult {
    const base = this.createBaseResult(job, result.duration_ms);
    const output = result.output || '';

    base.summary = `OpenCode ${result.fallbackUsed ? 'run fallback' : 'serve'} completed ${job.stage} stage`;
    base.artifacts = result.artifacts?.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      kind: artifact.kind,
      uri: artifact.uri,
    })) ?? [];

  // Process event stream if available (Phase 2C)
    let ingestedEvents: IngestedEvents | undefined;
    if (result.eventStream) {
      ingestedEvents = result.eventStream.ingested;

      // Extract escalations from ingested events (never silent drop)
      base.requested_escalations = this.eventIngestor.extractEscalations(ingestedEvents);

      // Build raw outputs including event_stream
      base.raw_outputs = this.eventIngestor.buildRawOutputs(
        ingestedEvents,
        base.artifacts.map(a => ({ artifact_id: a.artifact_id, kind: a.kind })),
      );

      // Calculate usage statistics
      const usageStats = this.eventIngestor.calculateUsage(ingestedEvents);
      base.usage = {
        runtime_ms: result.duration_ms,
        ...usageStats,
      };

      // Log transcript persisted event
      this.stats.transcriptsPersisted++;
      this.logger.info('Transcript and event stream persisted', {
        jobId: job.job_id,
        sessionId: result.sessionId,
        eventCounts: ingestedEvents.eventCounts,
        escalationCount: base.requested_escalations?.length || 0,
        auditEvent: ServeAuditEvents.TRANSCRIPT_PERSISTED,
      });
    } else if (result.transcript) {
      // Legacy: parse transcript directly if no event stream
      const events = this.eventIngestor.parseTranscriptJson(result.transcript);
      ingestedEvents = this.eventIngestor.ingestEvents(events);

      base.requested_escalations = this.eventIngestor.extractEscalations(ingestedEvents);
      base.raw_outputs = this.eventIngestor.buildRawOutputs(
        ingestedEvents,
        base.artifacts.map(a => ({ artifact_id: a.artifact_id, kind: a.kind })),
      );

      const usageStats = this.eventIngestor.calculateUsage(ingestedEvents);
      base.usage = {
        runtime_ms: result.duration_ms,
        ...usageStats,
      };
    } else {
      // No transcript or event stream
      base.raw_outputs = base.artifacts
        .filter((artifact) => artifact.kind === 'log' || artifact.kind === 'json')
        .map((artifact) => ({
          channel: artifact.kind === 'json' ? 'json' : 'stdout',
          artifact_id: artifact.artifact_id,
        }));

      base.usage = {
        runtime_ms: result.duration_ms,
      };
    }

    // Extract verdict for acceptance stage
    if (job.stage === 'acceptance') {
      const verdict = this.tryExtractVerdict(output);
      if (verdict) {
        base.verdict = verdict;
      }
    }

    // Extract patch if present
    if (output.includes('--- ') && output.includes('+++ ')) {
      base.patch_ref = {
        format: 'unified_diff',
        content: output,
        base_sha: job.repo_ref.base_sha,
      };
    }

    // Metadata with full execution details
    base.metadata = {
      ...(base.metadata ?? {}),
      substrate: 'opencode',
      logical_worker: this.workerType,
      execution_mode: result.fallbackUsed ? 'run_fallback' : 'serve',
      session_id: result.sessionId ?? null,
      reused_session: result.reusedSession ?? false,
      fallback_reason: result.fallbackReason ?? null,
      event_stream_available: !!result.eventStream,
      total_events: result.eventStream?.events.length ?? 0,
      escalation_count: base.requested_escalations?.length ?? 0,
      phase: '2c',
    };

    return base;
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
    ];

    return destructivePatterns.some(pattern => pattern.test(command));
  }

  /**
   * Check if path is in workspace.
   */
  private isInWorkspace(filePath: string): boolean {
    if (filePath.startsWith('./') || filePath.startsWith('../') || !filePath.startsWith('/')) {
      return true;
    }
    return filePath.startsWith('/tmp/') || filePath.startsWith('/workspace/');
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
      /^\/root\//,
      /\.env$/i,
      /\.ssh\//,
      /credentials/i,
      /secrets/i,
    ];

    return protectedPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if operation involves secret access.
   */
  private isSecretAccess(tool: string, _context: Record<string, unknown>): boolean {
    const secretIndicators = ['secret', 'password', 'token', 'key', 'credential', 'api_key'];
    const toolLower = tool.toLowerCase();
    return secretIndicators.some(indicator => toolLower.includes(indicator));
  }

  private tryExtractVerdict(output: string): WorkerResult['verdict'] | undefined {
    const trimmed = output.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as { outcome?: 'accept' | 'reject' | 'rework' | 'needs_manual_review'; reason?: string };
      if (parsed.outcome) {
        return {
          outcome: parsed.outcome,
          reason: parsed.reason,
          checklist_completed: parsed.outcome === 'accept',
        };
      }
    } catch {
      // Ignore parse failure and fall back to heuristic
    }

    return {
      outcome: /reject|rework/i.test(trimmed) ? 'rework' : 'accept',
      reason: trimmed.slice(0, 500),
      checklist_completed: !/reject|rework/i.test(trimmed),
    };
  }

  /**
   * Get adapter statistics.
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
}

/**
 * Create an OpenCode Serve adapter with all dependencies.
 */
export function createOpenCodeServeAdapter(
  workerType: WorkerType,
  serverManager: OpenCodeServerManager,
  sessionRegistry: OpenCodeSessionRegistry,
  sessionExecutor: OpenCodeSessionExecutor,
  model?: string,
  debug?: boolean,
): OpenCodeServeAdapter {
  return new OpenCodeServeAdapter({
    workerType,
    serverManager,
    sessionRegistry,
    sessionExecutor,
    model,
    debug,
  });
}
