import type { WorkerResult } from '../../types.js';
import type { ToolInvocationDecision, ToolInvocationRequest } from './worker-runtime.js';

export type NormalizedToolResultStatus = 'succeeded' | 'failed' | 'skipped' | 'blocked';
export type NormalizedToolResultChannel = 'stdout' | 'stderr' | 'json' | 'event_stream' | 'file' | 'none';

export interface RawToolResult {
  request: ToolInvocationRequest;
  decision?: ToolInvocationDecision;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  json?: unknown;
  artifact_id?: string;
  duration_ms?: number;
  error?: string;
}

export interface NormalizedToolResult {
  tool: string;
  status: NormalizedToolResultStatus;
  side_effect: 'none' | 'read' | 'write' | 'process' | 'network' | 'unknown';
  channel: NormalizedToolResultChannel;
  artifact_id?: string;
  retained_artifact_id?: string;
  exit_code?: number | null;
  duration_ms?: number;
  summary: string;
  bounded: boolean;
  violation_code?: string;
}

type WorkerRawOutput = NonNullable<WorkerResult['raw_outputs']>[number];

export class ToolResultNormalizer {
  constructor(
    private readonly options: {
      max_model_output_chars?: number;
      retained_artifact_id?: string;
    } = {},
  ) {}

  normalize(input: RawToolResult): NormalizedToolResult {
    if (input.decision && !input.decision.allowed) {
      return {
        tool: input.request.tool,
        status: 'blocked',
        side_effect: inferSideEffect(input.request.tool),
        channel: 'none',
        artifact_id: input.artifact_id,
        exit_code: input.exit_code,
        duration_ms: input.duration_ms,
        summary: input.decision.reason,
        bounded: false,
        violation_code: input.decision.violation_code,
      };
    }

    const failed = Boolean(input.error) || (typeof input.exit_code === 'number' && input.exit_code !== 0);
    const channel = resolveChannel(input);
    const bounded = boundSummary(summarize(input, failed), this.options.max_model_output_chars);
    return {
      tool: input.request.tool,
      status: failed ? 'failed' : 'succeeded',
      side_effect: inferSideEffect(input.request.tool),
      channel,
      artifact_id: input.artifact_id,
      retained_artifact_id: bounded.bounded ? this.options.retained_artifact_id ?? input.artifact_id : undefined,
      exit_code: input.exit_code,
      duration_ms: input.duration_ms,
      summary: bounded.summary,
      bounded: bounded.bounded,
    };
  }

  toWorkerRawOutput(result: NormalizedToolResult): WorkerRawOutput | undefined {
    if (!result.artifact_id || result.channel === 'none' || result.channel === 'file') {
      return undefined;
    }
    const channel = result.channel === 'json' || result.channel === 'event_stream' ? result.channel : result.channel;
    return {
      channel,
      artifact_id: result.artifact_id,
    };
  }
}

function resolveChannel(input: RawToolResult): NormalizedToolResultChannel {
  if (input.json !== undefined) {
    return 'json';
  }
  if (input.stdout) {
    return 'stdout';
  }
  if (input.stderr) {
    return 'stderr';
  }
  if (input.artifact_id) {
    return 'file';
  }
  return 'none';
}

function summarize(input: RawToolResult, failed: boolean): string {
  if (input.error) {
    return input.error;
  }
  if (failed) {
    return `${input.request.tool} exited ${input.exit_code ?? 'null'}`;
  }
  const output = input.stdout || input.stderr || (input.json !== undefined ? JSON.stringify(input.json) : '');
  return output.replace(/\s+/g, ' ').trim().slice(0, 300) || `${input.request.tool} completed`;
}

function boundSummary(summary: string, maxChars?: number): { summary: string; bounded: boolean } {
  if (!maxChars || summary.length <= maxChars) {
    return { summary, bounded: false };
  }
  return {
    summary: `${summary.slice(0, Math.max(0, maxChars - 24))}... [output bounded]`,
    bounded: true,
  };
}

function inferSideEffect(tool: string): NormalizedToolResult['side_effect'] {
  if (tool === 'read_file' || tool === 'grep' || tool === 'glob') {
    return 'read';
  }
  if (tool === 'write_file' || tool === 'apply_patch_intent') {
    return 'write';
  }
  if (tool === 'bash' || tool === 'bash_background' || tool === 'spawn_agent') {
    return 'process';
  }
  if (tool === 'web_fetch' || tool === 'web_search') {
    return 'network';
  }
  return 'unknown';
}
