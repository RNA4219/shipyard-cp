import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BackgroundProcessManager,
  InMemoryConversationStore,
  ToolResultNormalizer,
  type ProcessHandle,
  type ProcessSpawner,
} from '../src/domain/worker-runtime/index.js';

describe('worker runtime conversation store', () => {
  it('stores turns, compacts older history, and saves conversation artifacts', () => {
    const store = new InMemoryConversationStore();
    store.upsert({ session_id: 'session_conv_001', job_id: 'job_conv_001', artifact_refs: ['artifact://a'] });
    store.appendTurn('session_conv_001', { role: 'user', content: 'first request', created_at: '2026-06-23T00:00:00.000Z' });
    store.appendTurn('session_conv_001', { role: 'worker', content: 'first answer', created_at: '2026-06-23T00:00:01.000Z' });
    store.appendTurn('session_conv_001', { role: 'tool', content: 'test failed', created_at: '2026-06-23T00:00:02.000Z' });

    const compacted = store.compact('session_conv_001', 1);
    expect(compacted.compacted_turns).toBe(2);
    expect(compacted.retained_turns).toBe(1);
    expect(compacted.summary).toContain('first request');

    const root = mkdtempSync(join(tmpdir(), 'shipyard-conversation-'));
    const artifactPath = store.save('session_conv_001', join(root, 'artifacts', 'jobs'));
    const saved = JSON.parse(readFileSync(artifactPath, 'utf8')) as { compacted_summary?: string; turns: unknown[] };
    expect(saved.compacted_summary).toContain('first answer');
    expect(saved.turns).toHaveLength(1);
  });
});

describe('worker runtime tool result normalizer', () => {
  it('normalizes blocked, failed, and json tool results', () => {
    const normalizer = new ToolResultNormalizer();

    const blocked = normalizer.normalize({
      request: { tool: 'write_file', args: { path: 'docs/x.md' } },
      decision: {
        allowed: false,
        reason: 'path is outside allowed_paths: docs/x.md',
        violation_code: 'path_not_allowed',
      },
      artifact_id: 'artifact_blocked',
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.side_effect).toBe('write');
    expect(blocked.violation_code).toBe('path_not_allowed');

    const failed = normalizer.normalize({
      request: { tool: 'bash', args: { command: 'npm test' } },
      exit_code: 1,
      stderr: 'expected true received false',
      artifact_id: 'artifact_stderr',
    });
    expect(failed.status).toBe('failed');
    expect(failed.channel).toBe('stderr');
    expect(normalizer.toWorkerRawOutput(failed)).toEqual({ channel: 'stderr', artifact_id: 'artifact_stderr' });

    const json = normalizer.normalize({
      request: { tool: 'web_fetch', args: { url: 'https://example.test' } },
      json: { ok: true },
      artifact_id: 'artifact_json',
    });
    expect(json.status).toBe('succeeded');
    expect(json.side_effect).toBe('network');
    expect(json.channel).toBe('json');
  });

  it('bounds model-facing tool summaries while retaining artifact references', () => {
    const normalizer = new ToolResultNormalizer({
      max_model_output_chars: 80,
      retained_artifact_id: 'artifact_full_output',
    });

    const result = normalizer.normalize({
      request: { tool: 'bash', args: { command: 'npm test' } },
      exit_code: 0,
      stdout: 'x'.repeat(500),
      artifact_id: 'artifact_preview',
    });

    expect(result.status).toBe('succeeded');
    expect(result.bounded).toBe(true);
    expect(result.summary).toContain('[output bounded]');
    expect(result.summary.length).toBeLessThanOrEqual(80);
    expect(result.retained_artifact_id).toBe('artifact_full_output');
  });
});

describe('worker runtime background process manager', () => {
  it('starts, tails, and stops background processes without spawning real commands', () => {
    const handle = new FakeProcessHandle(4242);
    const manager = new BackgroundProcessManager(new FakeSpawner(handle));

    const started = manager.start({
      process_id: 'proc_001',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: 'C:/workspace/project',
    });

    expect(started.state).toBe('running');
    expect(started.pid).toBe(4242);

    handle.emitStdout('server ready\n');
    handle.emitStderr('warn\n');
    expect(manager.get('proc_001')?.stdout_tail).toContain('server ready');
    expect(manager.get('proc_001')?.stderr_tail).toContain('warn');

    const stopped = manager.stop('proc_001');
    expect(stopped.state).toBe('stopped');
    expect(handle.killedWith).toBe('SIGTERM');
  });
});

class FakeSpawner implements ProcessSpawner {
  constructor(private readonly handle: FakeProcessHandle) {}

  spawn(): ProcessHandle {
    return this.handle;
  }
}

class FakeProcessHandle implements ProcessHandle {
  readonly stdout = new EventEmitter() as ProcessHandle['stdout'] & EventEmitter;
  readonly stderr = new EventEmitter() as ProcessHandle['stderr'] & EventEmitter;
  private readonly emitter = new EventEmitter();
  killedWith?: NodeJS.Signals;

  constructor(readonly pid?: number) {}

  on(event: 'close' | 'error', listener: (...args: never[]) => void): void {
    this.emitter.on(event, listener);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    this.emitter.emit('close', null, signal ?? null);
    return true;
  }

  emitStdout(value: string): void {
    this.stdout.emit('data', value);
  }

  emitStderr(value: string): void {
    this.stderr.emit('data', value);
  }
}
