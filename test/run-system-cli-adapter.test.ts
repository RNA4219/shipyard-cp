import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRunSystemPacket,
  LocalRunSystemCliAdapter,
  type SyncCommandRunner,
} from '../src/domain/run-system/index.js';
import type { Task, WorkerJob, WorkerResult } from '../src/types.js';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function makeRepoRoot(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'shipyard-run-system-cli-'));
  for (const repo of ['agent-protocols', 'agent-taskstate', 'agent-gatefield', 'agent-state-gate']) {
    mkdirSync(join(tempRoot, repo), { recursive: true });
  }
  return tempRoot;
}

function packet() {
  const task: Task = {
    task_id: 'task_cli_001',
    title: 'CLI adapter',
    objective: 'Call external OSS gates',
    typed_ref: 'agent-taskstate:task:local:task_cli_001',
    state: 'developing',
    version: 1,
    risk_level: 'medium',
    repo_ref: {
      provider: 'github',
      owner: 'local',
      name: 'shipyard-cp',
      default_branch: 'main',
    },
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
  };
  const job: WorkerJob = {
    job_id: 'job_cli_001',
    task_id: 'task_cli_001',
    typed_ref: 'agent-taskstate:task:local:task_cli_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'completed',
    input_prompt: 'test',
    capability_requirements: [],
    risk_level: 'medium',
    approval_policy: { mode: 'ask', sandbox_profile: 'workspace_write' },
  };
  const result: WorkerResult = {
    job_id: 'job_cli_001',
    typed_ref: 'agent-taskstate:task:local:task_cli_001',
    status: 'succeeded',
    summary: 'ok',
    artifacts: [],
    test_results: [],
    requested_escalations: [],
    usage: { runtime_ms: 1, exit_code: 0 },
  };
  return buildRunSystemPacket(task, job, result);
}

describe('LocalRunSystemCliAdapter', () => {
  it('invokes all four external OSS commands and parses gate decisions', () => {
    const repoRoot = makeRepoRoot();
    const commands: string[] = [];
    const runner: SyncCommandRunner = {
      run(command, args) {
        const text = [command, ...args].join(' ');
        commands.push(text);
        if (text.includes('cli.gate_cli')) {
          return {
            status: 1,
            stdout: JSON.stringify({ decision: 'hold' }),
            stderr: '',
          };
        }
        if (text.includes('agent-state-gate')) {
          return {
            status: 0,
            stdout: JSON.stringify({ verdict: 'needs_approval' }),
            stderr: '',
          };
        }
        return { status: 0, stdout: 'ok', stderr: '' };
      },
    };

    const adapter = new LocalRunSystemCliAdapter({
      repoRoot,
      artifactRoot: join(repoRoot, 'artifacts'),
      runner,
    });

    const report = adapter.run(packet());

    expect(commands).toHaveLength(4);
    expect(commands.some(command => command.includes('npm run validate'))).toBe(true);
    expect(commands.some(command => command.includes('python -m src.cli --help'))).toBe(true);
    expect(commands.some(command => command.includes('cli.gate_cli dry-run'))).toBe(true);
    expect(commands.some(command => command.includes('agent-state-gate gate evaluate'))).toBe(true);
    expect(report.gatefield_decision).toBe('hold');
    expect(report.state_gate_verdict).toBe('needs_approval');
    expect(report.residual_risks).toContain('agent-gatefield: agent-gatefield returned hold');
    expect(report.artifact_path).toContain('external-cli-report.json');
  });

  it('marks missing external repos as skipped residual risks', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'shipyard-run-system-cli-missing-'));
    const adapter = new LocalRunSystemCliAdapter({
      repoRoot: tempRoot,
      artifactRoot: join(tempRoot, 'artifacts'),
      runner: {
        run() {
          throw new Error('should not run missing repos');
        },
      },
    });

    const report = adapter.run(packet());

    expect(report.results.every(result => result.status === 'skipped')).toBe(true);
    expect(report.residual_risks).toHaveLength(4);
    expect(report.blockers).toEqual([]);
  });
});
