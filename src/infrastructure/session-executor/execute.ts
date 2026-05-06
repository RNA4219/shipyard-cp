/**
 * Session Executor Execute
 *
 * Core execution logic extracted from OpenCodeSessionExecutor.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { WorkerJob } from '../../types.js';
import type { OpenCodeSessionRegistry, SessionSearchCriteria } from '../../domain/worker/session-registry/index.js';
import { generatePolicyFingerprint } from '../../domain/worker/session-registry/index.js';
import type { OpenCodeEventIngestor, EventStreamContainer, OpenCodeEvent } from '../../domain/worker/opencode-event-ingestor.js';
import type { SessionExecutorConfig, SessionCreateResponse, SessionRunResponse } from './types.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger().child({ component: 'SessionExecutorExecute' });

/**
 * Build criteria for session lookup.
 */
export function buildSessionSearchCriteria(job: WorkerJob): SessionSearchCriteria {
  return {
    taskId: job.task_id,
    workspaceRef: {
      kind: job.workspace_ref.kind,
      workspace_id: job.workspace_ref.workspace_id,
    },
    logicalWorker: job.worker_type,
    stageBucket: job.stage,
    policyFingerprint: generatePolicyFingerprint(job),
  };
}

/**
 * Resolve work path for a job.
 */
export function resolveWorkPath(job: WorkerJob, workDir: string): string {
  if (job.workspace_ref.kind === 'host_path' && path.isAbsolute(job.workspace_ref.workspace_id)) {
    return job.workspace_ref.workspace_id;
  }
  return path.join(workDir, job.job_id);
}

/**
 * Build prompt from job.
 */
export function buildPrompt(job: WorkerJob): string {
  const lines: string[] = [];
  lines.push(`Task ID: ${job.task_id}`);
  lines.push(`Stage: ${job.stage}`);
  lines.push('');
  lines.push(job.input_prompt);
  return lines.join('\n');
}

/**
 * Build project config for session.
 */
export function buildProjectConfig(job: WorkerJob): Record<string, unknown> {
  const permissions = buildPermissions(job);
  return {
    $schema: 'https://opencode.ai/config.json',
    permission: permissions,
  };
}

/**
 * Build permissions based on stage.
 */
export function buildPermissions(job: WorkerJob): Record<string, unknown> {
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
 * Create a new session on the server.
 */
export async function createSession(
  baseUrl: string,
  job: WorkerJob,
  workPath: string,
  _config: SessionExecutorConfig,
): Promise<string> {
  const response = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: job.task_id,
      job_id: job.job_id,
      stage: job.stage,
      worker_type: job.worker_type,
      workspace_path: workPath,
      config: buildProjectConfig(job),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create session: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as SessionCreateResponse;
  logger.info('Session created', { sessionId: data.id, jobId: job.job_id });
  return data.id;
}

/**
 * Run a prompt in an existing session.
 */
export async function runInSession(
  baseUrl: string,
  sessionId: string,
  prompt: string,
  workPath: string,
  timeout: number,
  eventIngestor: OpenCodeEventIngestor,
  eventStreamContainer?: EventStreamContainer,
): Promise<{ success: boolean; output?: string; error?: string; transcript?: string }> {
  try {
    const response = await fetch(`${baseUrl}/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `Session run failed: ${response.status} ${errorBody}`,
      };
    }

    const data = await response.json() as SessionRunResponse;
    const stdout = data.output || '';
    const transcript = data.transcript || '';

    // Validate file paths are within workPath
    const stdoutPath = path.resolve(path.join(workPath, 'stdout.log'));
    const transcriptPath = path.resolve(path.join(workPath, 'transcript.json'));
    if (!stdoutPath.startsWith(path.resolve(workPath)) || !transcriptPath.startsWith(path.resolve(workPath))) {
      throw new Error('Invalid file path detected');
    }

    await writeFile(stdoutPath, stdout, 'utf8');
    await writeFile(transcriptPath, transcript, 'utf8');

    // Parse and ingest transcript events
    if (transcript && eventStreamContainer) {
      const parsedEvents = eventIngestor.parseTranscriptJson(transcript, sessionId);
      for (const event of parsedEvents) {
        eventIngestor.addEvent(eventStreamContainer, event);
      }
    }

    // Ingest any events returned directly
    if (data.events && eventStreamContainer) {
      for (const event of data.events) {
        eventIngestor.addEvent(eventStreamContainer, event);
      }
    }

    // Poll for completion if status is 'running'
    if (data.status === 'running') {
      return await pollForCompletion(baseUrl, sessionId, workPath, timeout, eventIngestor, eventStreamContainer);
    }

    return {
      success: data.status === 'completed' || data.status === 'success',
      output: stdout,
      transcript,
      error: data.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Poll session until completion.
 */
export async function pollForCompletion(
  baseUrl: string,
  sessionId: string,
  workPath: string,
  timeout: number,
  eventIngestor: OpenCodeEventIngestor,
  eventStreamContainer?: EventStreamContainer,
): Promise<{ success: boolean; output?: string; error?: string; transcript?: string }> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeout) {
    const status = await getSessionStatus(baseUrl, sessionId);

    if (!status) {
      return { success: false, error: 'Session status unavailable' };
    }

    if (status.status === 'completed' || status.status === 'success') {
      const outputResponse = await fetch(`${baseUrl}/sessions/${sessionId}/output`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      let output = '';
      let transcript = '';

      if (outputResponse.ok) {
        const data = await outputResponse.json() as { output?: string; transcript?: string; events?: unknown[] };
        output = data.output || '';
        transcript = data.transcript || '';

        const stdoutPath = path.resolve(path.join(workPath, 'stdout.log'));
        const transcriptPath = path.resolve(path.join(workPath, 'transcript.json'));
        if (!stdoutPath.startsWith(path.resolve(workPath)) || !transcriptPath.startsWith(path.resolve(workPath))) {
          throw new Error('Invalid file path detected');
        }

        await writeFile(stdoutPath, output, 'utf8');
        await writeFile(transcriptPath, transcript, 'utf8');

        if (transcript && eventStreamContainer) {
          const parsedEvents = eventIngestor.parseTranscriptJson(transcript, sessionId);
          for (const event of parsedEvents) {
            eventIngestor.addEvent(eventStreamContainer, event);
          }
        }

        if (data.events && eventStreamContainer) {
          for (const event of data.events) {
            eventIngestor.addEvent(eventStreamContainer, event as OpenCodeEvent);
          }
        }
      }

      return { success: true, output, transcript };
    }

    if (status.status === 'failed' || status.status === 'error') {
      return { success: false, error: `Session failed with status: ${status.status}` };
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { success: false, error: 'Session execution timed out' };
}

/**
 * Get session status from server.
 */
export async function getSessionStatus(
  baseUrl: string,
  sessionId: string,
): Promise<{ status: string; state: string } | null> {
  try {
    const response = await fetch(`${baseUrl}/sessions/${sessionId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json() as { status?: string; state?: string };
    return { status: data.status || 'unknown', state: data.state || 'unknown' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('Session status fetch failed', { sessionId, error: message });
    return null;
  }
}

/**
 * Cancel a running session execution.
 */
export async function cancelSession(
  baseUrl: string,
  sessionId: string,
  jobId: string,
  registry: OpenCodeSessionRegistry,
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: `Job ${jobId} cancelled` }),
      signal: AbortSignal.timeout(10000),
    });

    const ok = response.ok;
    if (ok) {
      registry.markSessionDead(sessionId, 'Cancelled', 'task_cancelled');
      logger.info('Session cancelled', { sessionId, jobId, cleanupReason: 'task_cancelled' });
    }
    return ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to cancel session', { sessionId, error: message });
    registry.markSessionDead(sessionId, `Cancel failed: ${message}`, 'task_cancelled');
    return false;
  }
}

/**
 * Ensure work directory exists.
 */
export async function ensureWorkDir(workDir: string): Promise<void> {
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }
}