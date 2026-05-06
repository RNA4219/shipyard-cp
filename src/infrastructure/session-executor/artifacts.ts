/**
 * Session Executor Artifacts
 *
 * Artifact collection and transcript indexing logic.
 */

import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import type { OpenCodeEventIngestor, EventStreamContainer } from '../../domain/worker/opencode-event-ingestor.js';
import type { TranscriptIndexMetadata } from '../../domain/worker/session-registry/index.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger().child({ component: 'SessionExecutorArtifacts' });

/**
 * Collect artifacts from execution.
 */
export async function collectArtifacts(
  workPath: string,
  jobId: string,
  eventIngestor: OpenCodeEventIngestor,
  eventStreamContainer?: EventStreamContainer,
  includeRawEvents: boolean = true,
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

  // Save event stream as artifact
  if (eventStreamContainer && includeRawEvents) {
    const eventStreamPath = path.resolve(path.join(workPath, 'event-stream.json'));
    const transcriptSummaryPath = path.resolve(path.join(workPath, 'transcript-summary.md'));

    if (!eventStreamPath.startsWith(path.resolve(workPath)) || !transcriptSummaryPath.startsWith(path.resolve(workPath))) {
      throw new Error('Invalid artifact path detected');
    }

    try {
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

      const summary = eventIngestor.generateTranscriptSummary(eventStreamContainer.ingested);
      await writeFile(transcriptSummaryPath, summary, 'utf8');

      artifacts.push({
        artifact_id: `${jobId}-transcript-summary`,
        kind: 'report',
        uri: transcriptSummaryPath,
      });

      logger.info('Event stream artifacts saved', {
        jobId,
        sessionId: eventStreamContainer.sessionId,
        eventStreamPath,
        transcriptSummaryPath,
        totalEvents: eventStreamContainer.events.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to save event stream artifacts', { jobId, error: message });
    }
  }

  return artifacts;
}

/**
 * Build transcript index metadata from event stream.
 */
export function buildTranscriptIndex(eventStreamContainer: EventStreamContainer): TranscriptIndexMetadata {
  const events = eventStreamContainer.events;
  const ingested = eventStreamContainer.ingested;

  const messageCount = ingested.eventCounts?.transcript_message || 0;
  const toolCount = ingested.eventCounts?.tool_use || 0;
  const permissionRequestCount = ingested.eventCounts?.permission_request || 0;

  // Extract last tool names (up to 5)
  const lastToolNames: string[] = [];
  for (let i = events.length - 1; i >= 0 && lastToolNames.length < 5; i--) {
    const event = events[i];
    if (event.type === 'tool_use' && 'tool' in event && event.tool) {
      lastToolNames.push(event.tool);
    }
  }

  // Extract summary keywords from transcript messages (up to 10)
  const summaryKeywords: string[] = [];
  for (const event of events) {
    if (event.type === 'transcript' && 'content' in event) {
      const content = String(event.content || '');
      const keywords = extractKeywords(content);
      for (const keyword of keywords) {
        if (!summaryKeywords.includes(keyword) && summaryKeywords.length < 10) {
          summaryKeywords.push(keyword);
        }
      }
    }
  }

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
 */
export function extractKeywords(content: string): string[] {
  const keywords: string[] = [];

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
        const cleaned = match.replace(/[(){}=:]/g, '').trim();
        if (cleaned.length > 2 && cleaned.length < 50) {
          keywords.push(cleaned);
        }
      }
    }
  }

  return keywords;
}