import type { IngestedEvents } from '../worker/opencode-event-ingestor.js';
import type { NormalizedToolResult } from './tool-result-normalizer.js';
import { ToolResultNormalizer } from './tool-result-normalizer.js';
import type { WorkerRuntimeTurn } from './worker-runtime.js';

export interface OpenCodeRuntimeEventBridgeResult {
  turns: WorkerRuntimeTurn[];
  tool_results: NormalizedToolResult[];
  permission_request_count: number;
  source_event_count: number;
  replay_cursor: string;
  stdout_tail: string;
  stderr_tail: string;
}

/**
 * Converts OpenCode's event-ingestor output into the runtime-neutral session
 * shape. This keeps OpenCode's mature stream parsing, while preventing the rest
 * of WorkerRuntime from depending on OpenCode-specific event types.
 */
export class OpenCodeRuntimeEventBridge {
  private readonly normalizer = new ToolResultNormalizer();

  fromIngestedEvents(events: IngestedEvents): OpenCodeRuntimeEventBridgeResult {
    const turns: WorkerRuntimeTurn[] = events.transcripts.map(message => ({
      role: message.role === 'assistant' ? 'worker' : message.role,
      content: message.content,
      created_at: new Date().toISOString(),
    }));

    for (const request of events.permissionRequests) {
      turns.push({
        role: 'system',
        content: `permission requested: ${request.kind} - ${request.reason}`,
        created_at: new Date().toISOString(),
      });
    }

    const toolResults = events.toolUses.map(tool => this.normalizer.normalize({
      request: {
        tool: tool.tool,
        args: tool.input ?? {},
      },
      exit_code: tool.status === 'success' ? 0 : tool.status === 'pending' ? null : 1,
      json: tool.output,
      error: tool.error,
      duration_ms: tool.duration_ms,
    }));

    return {
      turns,
      tool_results: toolResults,
      permission_request_count: events.permissionRequests.length,
      source_event_count: countSourceEvents(events),
      replay_cursor: buildReplayCursor(events),
      stdout_tail: tail(events.stdout.join('\n')),
      stderr_tail: tail(events.stderr.join('\n')),
    };
  }
}

function countSourceEvents(events: IngestedEvents): number {
  return events.transcripts.length
    + events.permissionRequests.length
    + events.toolUses.length
    + events.stdout.length
    + events.stderr.length;
}

function buildReplayCursor(events: IngestedEvents): string {
  return [
    `transcript:${events.transcripts.length}`,
    `permission:${events.permissionRequests.length}`,
    `tool:${events.toolUses.length}`,
    `stdout:${events.stdout.length}`,
    `stderr:${events.stderr.length}`,
  ].join('|');
}

function tail(value: string): string {
  return value.length > 16_384 ? value.slice(-16_384) : value;
}
