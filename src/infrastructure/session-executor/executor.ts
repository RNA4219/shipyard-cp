/**
 * OpenCode Session Executor
 *
 * Executes jobs using opencode serve sessions instead of standalone run.
 * Phase 2B: Enhanced transcript and event stream collection.
 *
 * Note: Helper functions moved to session-executor/execute.ts and artifacts.ts.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import type { WorkerJob } from '../../types.js';
import type { OpenCodeSessionRegistry } from '../../domain/worker/session-registry/index.js';
import { getLogger } from '../../monitoring/index.js';
import {
  createOpenCodeEventIngestor,
  OpenCodeEventIngestor,
  type EventStreamContainer,
  type CleanupReason,
} from '../../domain/worker/opencode-event-ingestor.js';
import type { SessionExecutorConfig, SessionExecutionResult } from './types.js';
import {
  buildSessionSearchCriteria,
  resolveWorkPath,
  buildPrompt,
  buildProjectConfig,
  createSession,
  runInSession,
  getSessionStatus,
  cancelSession,
  ensureWorkDir,
} from './execute.js';
import {
  collectArtifacts,
  buildTranscriptIndex,
} from './artifacts.js';

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

    void ensureWorkDir(this.config.workDir);
  }

  /**
   * Execute a job using session-based approach.
   */
  async execute(job: WorkerJob): Promise<SessionExecutionResult> {
    const workPath = resolveWorkPath(job, this.config.workDir);
    const startedAt = Date.now();
    let eventStreamContainer: EventStreamContainer | undefined;

    try {
      const criteria = buildSessionSearchCriteria(job);

      // Try to find reusable session
      let session = this.registry.findReusableSession(criteria);
      let reusedSession = false;

      if (session) {
        const leased = this.registry.leaseSession(session.sessionId, job.job_id);
        if (leased) {
          reusedSession = true;
          this.logger.info('Using reusable session', { sessionId: session.sessionId, jobId: job.job_id });

          eventStreamContainer = this.eventIngestor.createEventStreamContainer(job.job_id, session.sessionId);
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
          session = null;
        }
      }

      // Create new session if no reusable one
      if (!session) {
        const newSessionId = await createSession(this.config.baseUrl, job, workPath, this.config);
        session = this.registry.createSessionRecord(newSessionId, criteria, this.config.baseUrl);
        this.registry.leaseSession(newSessionId, job.job_id);
        this.registry.markSessionReady(newSessionId);

        eventStreamContainer = this.eventIngestor.createEventStreamContainer(job.job_id, newSessionId);
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
      const prompt = job.input_prompt || buildPrompt(job);
      const configFile = path.join(workPath, 'opencode.json');
      await import('fs/promises').then(fs => fs.writeFile(configFile, JSON.stringify(buildProjectConfig(job), null, 2), 'utf8'));
      await import('fs/promises').then(fs => fs.writeFile(path.join(workPath, 'prompt.md'), prompt, 'utf8'));

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
      const result = await runInSession(
        this.config.baseUrl,
        session.sessionId,
        prompt,
        workPath,
        this.config.timeout,
        this.eventIngestor,
        eventStreamContainer,
      );
      const duration = Date.now() - startedAt;

      // Add completion events
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

      this.registry.releaseSession(session.sessionId, job.job_id);

      const artifacts = await collectArtifacts(workPath, job.job_id, this.eventIngestor, eventStreamContainer, this.config.includeRawEvents);

      let cleanupReason: CleanupReason | undefined;
      if (!result.success) {
        cleanupReason = 'task_failed';
        this.registry.markSessionDead(session.sessionId, result.error, cleanupReason);
      }

      if (eventStreamContainer) {
        this.eventIngestor.finalizeContainer(eventStreamContainer);
        eventStreamContainer.transcriptArtifactUri = artifacts.find(a => a.artifact_id.includes('transcript'))?.uri;
        eventStreamContainer.eventStreamArtifactUri = artifacts.find(a => a.artifact_id.includes('event-stream'))?.uri;
        const transcriptIndex = buildTranscriptIndex(eventStreamContainer);
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
    return cancelSession(this.config.baseUrl, sessionId, jobId, this.registry);
  }

  /**
   * Get session status from server.
   */
  async getSessionStatus(sessionId: string): Promise<{ status: string; state: string } | null> {
    return getSessionStatus(this.config.baseUrl, sessionId);
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