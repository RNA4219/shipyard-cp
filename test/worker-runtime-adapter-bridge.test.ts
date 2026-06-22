import { describe, expect, it, vi } from 'vitest';
import {
  OpenCodeRuntimeEventBridge,
  WorkerRuntimeAdapterBridge,
  type WorkerRuntimePolicy,
} from '../src/domain/worker-runtime/index.js';
import type {
  CancelResult,
  JobPollResult,
  JobSubmissionResult,
  WorkerAdapter,
  WorkerCapabilities,
} from '../src/domain/worker/worker-adapter.js';
import type { IngestedEvents } from '../src/domain/worker/opencode-event-ingestor.js';
import type { WorkerJob, WorkerType } from '../src/types.js';

function policy(): WorkerRuntimePolicy {
  return {
    mode: 'interactive',
    allowed_paths: ['src'],
    max_turns: 10,
    max_tool_calls: 10,
    restricted_tools: true,
    allow_subagents: false,
    restore_points: 'disabled',
  };
}

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_bridge_001',
    task_id: 'task_bridge_001',
    typed_ref: 'agent-taskstate:task:local:task_bridge_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'running',
    workspace_ref: {
      workspace_id: 'ws_bridge_001',
      kind: 'host_path',
      reusable: true,
    },
    input_prompt: 'bridge me',
    repo_ref: {
      provider: 'github',
      owner: 'local',
      name: 'shipyard-cp',
      default_branch: 'main',
    },
    capability_requirements: ['edit_repo'],
    risk_level: 'medium',
    approval_policy: {
      mode: 'ask',
      sandbox_profile: 'workspace_write',
    },
    ...overrides,
  };
}

describe('worker runtime adapter bridge', () => {
  it('connects submit and successful poll to runtime session lifecycle', async () => {
    const adapter = new FakeAdapter([
      {
        external_job_id: 'external_001',
        status: 'succeeded',
        progress: 100,
        result: {
          job_id: 'job_bridge_001',
          typed_ref: 'agent-taskstate:task:local:task_bridge_001',
          status: 'succeeded',
          summary: 'adapter completed',
          artifacts: [],
          test_results: [],
          requested_escalations: [],
          usage: { runtime_ms: 100 },
        },
      },
    ]);
    const bridge = new WorkerRuntimeAdapterBridge(adapter, policy());

    const started = await bridge.start(job());
    expect(started.submission.external_job_id).toBe('external_001');
    expect(started.session.state).toBe('running');
    expect(started.session.turn_count).toBe(2);

    const polled = await bridge.poll('job_bridge_001');
    expect(polled.poll.status).toBe('succeeded');
    expect(polled.session.state).toBe('completed');
    expect(polled.session.events.at(-1)?.message).toContain('adapter completed');
  });

  it('interrupts adapter jobs via cancelJob', async () => {
    const adapter = new FakeAdapter([{ external_job_id: 'external_002', status: 'running' }]);
    const bridge = new WorkerRuntimeAdapterBridge(adapter, policy());

    await bridge.start(job({ job_id: 'job_bridge_002' }));
    const interrupted = await bridge.interrupt('job_bridge_002', 'user stopped');

    expect(interrupted.state).toBe('interrupted');
    expect(adapter.cancelJob).toHaveBeenCalledWith('external_002');
  });
});

describe('opencode runtime event bridge', () => {
  it('converts ingested OpenCode events to runtime turns and normalized tool results', () => {
    const bridge = new OpenCodeRuntimeEventBridge();
    const converted = bridge.fromIngestedEvents({
      transcripts: [
        { role: 'assistant', content: 'I will inspect files', tokens: 7 },
        { role: 'user', content: 'please continue' },
      ],
      permissionRequests: [
        {
          kind: 'network_access',
          reason: 'web_fetch requested',
          raw: {
            type: 'permission_request',
            id: 'perm_001',
            tool: 'web_fetch',
            timestamp: 1,
            category: 'permission_request',
          },
        },
      ],
      toolUses: [
        {
          tool: 'read_file',
          status: 'success',
          input: { path: 'src/index.ts' },
          output: { lines: 10 },
          duration_ms: 5,
        },
        {
          tool: 'bash',
          status: 'error',
          input: { command: 'npm test' },
          error: 'test failed',
        },
      ],
      stdout: ['ok'],
      stderr: ['warn'],
      sessionLifecycle: [],
      eventCounts: {
        transcript_message: 2,
        tool_use: 2,
        permission_request: 1,
        stdout_chunk: 1,
        stderr_chunk: 1,
        session_lifecycle: 0,
        execution_completion: 0,
      },
      ingestionMeta: {
        startedAt: 1,
        completedAt: 2,
        totalEvents: 6,
        parseErrors: 0,
      },
    } satisfies IngestedEvents);

    expect(converted.turns.map(turn => turn.role)).toEqual(['worker', 'user', 'system']);
    expect(converted.permission_request_count).toBe(1);
    expect(converted.source_event_count).toBe(7);
    expect(converted.replay_cursor).toBe('transcript:2|permission:1|tool:2|stdout:1|stderr:1');
    expect(converted.tool_results.map(result => result.status)).toEqual(['succeeded', 'failed']);
    expect(converted.stdout_tail).toBe('ok');
    expect(converted.stderr_tail).toBe('warn');
  });
});

class FakeAdapter implements WorkerAdapter {
  readonly workerType: WorkerType = 'codex';
  private readonly externalJobId: string;
  private pollIndex = 0;

  cancelJob = vi.fn(async (): Promise<CancelResult> => ({ success: true, status: 'cancelled' }));

  constructor(private readonly polls: JobPollResult[]) {
    this.externalJobId = polls[0]?.external_job_id ?? 'external_fake';
  }

  async initialize(): Promise<void> {}
  async isReady(): Promise<boolean> { return true; }
  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: 'codex',
      capabilities: ['edit_repo'],
      max_concurrent_jobs: 1,
      supported_stages: ['dev'],
      version: 'test',
    };
  }
  async submitJob(): Promise<JobSubmissionResult> {
    return {
      success: true,
      external_job_id: this.externalJobId,
      status: 'queued',
    };
  }
  async pollJob(): Promise<JobPollResult> {
    const poll = this.polls[Math.min(this.pollIndex, this.polls.length - 1)];
    this.pollIndex += 1;
    return poll;
  }
  async collectArtifacts(): Promise<[]> { return []; }
  normalizeEscalation(): null { return null; }
  async shutdown(): Promise<void> {}
}
