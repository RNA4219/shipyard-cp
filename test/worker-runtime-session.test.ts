import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkerRuntimePolicy,
  createDefaultRuntimeToolRegistry,
  InMemoryWorkerRuntimeSession,
  RestorePointManager,
  RuntimeToolRegistry,
  type WorkerRuntimePolicy,
} from '../src/domain/worker-runtime/index.js';
import type { WorkerJob } from '../src/types.js';

function policy(overrides: Partial<WorkerRuntimePolicy> = {}): WorkerRuntimePolicy {
  return {
    mode: 'interactive',
    allowed_paths: ['src', 'test'],
    max_turns: 3,
    max_tool_calls: 4,
    restricted_tools: true,
    allow_subagents: false,
    restore_points: 'snapshot',
    ...overrides,
  };
}

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_runtime_001',
    task_id: 'task_runtime_001',
    typed_ref: 'agent-taskstate:task:local:task_runtime_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'running',
    workspace_ref: {
      workspace_id: 'ws_runtime_001',
      kind: 'host_path',
      reusable: true,
    },
    input_prompt: 'test runtime session',
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

describe('worker runtime session control', () => {
  it('rejects restricted shell and disabled sub-agent tools', () => {
    const registry = createDefaultRuntimeToolRegistry();

    const shellDecision = registry.decideInvocation(policy(), { tool: 'bash', args: {} });
    expect(shellDecision.allowed).toBe(false);
    expect(shellDecision.violation_code).toBe('restricted_tool');

    const subagentDecision = registry.decideInvocation(
      policy({ restricted_tools: false, allow_subagents: false }),
      { tool: 'spawn_agent', args: {} },
    );
    expect(subagentDecision.allowed).toBe(false);
    expect(subagentDecision.violation_code).toBe('subagent_disabled');
  });

  it('derives a delegated workspace policy for normal dev jobs', () => {
    const derived = buildWorkerRuntimePolicy(job());
    const registry = createDefaultRuntimeToolRegistry();

    expect(derived.restricted_tools).toBe(false);
    expect(derived.allow_subagents).toBe(true);
    expect(registry.decideInvocation(derived, { tool: 'bash', args: {} }).allowed).toBe(true);
    expect(registry.decideInvocation(derived, { tool: 'spawn_agent', args: {} }).allowed).toBe(true);
  });

  it('keeps durable admitted inputs separate from promoted turns', () => {
    const session = new InMemoryWorkerRuntimeSession(
      'session_runtime_admission',
      policy({ max_turns: 5 }),
      createDefaultRuntimeToolRegistry(),
    );
    session.start(job({ job_id: 'job_runtime_admission' }));

    const first = session.admitInput({
      input_id: 'input_001',
      content: 'durable prompt',
      delivery: 'steer',
      resume: false,
    });
    expect(first.exact_retry).toBe(false);
    expect(first.scheduled).toBe(false);
    expect(session.collect().turn_count).toBe(0);
    expect(session.collect().admitted_input_count).toBe(1);

    const retry = session.admitInput({
      input_id: 'input_001',
      content: 'durable prompt',
      delivery: 'steer',
    });
    expect(retry.exact_retry).toBe(true);

    expect(() => session.admitInput({
      input_id: 'input_001',
      content: 'conflicting prompt',
      delivery: 'steer',
    })).toThrow(/input_id reuse conflicts/);

    const promoted = session.promoteAdmittedInputs();
    expect(promoted.turn_count).toBe(1);
    expect(promoted.events.map(event => event.event_type)).toContain('session.input_promoted');
  });

  it('replays runtime events after a durable cursor', () => {
    const session = new InMemoryWorkerRuntimeSession(
      'session_runtime_events',
      policy({ max_turns: 5 }),
      createDefaultRuntimeToolRegistry(),
    );
    session.start(job({ job_id: 'job_runtime_events' }));
    const cursor = session.collect().event_cursor;

    session.send({ role: 'user', content: 'hello' });

    const replay = session.collectEvents(cursor);
    expect(replay).toHaveLength(1);
    expect(replay[0].event_type).toBe('session.turn_recorded');
    expect(replay[0].sequence).toBeGreaterThan(cursor);
  });

  it('rejects absolute, parent, and disallowed write paths', () => {
    const registry = createDefaultRuntimeToolRegistry();

    expect(registry.decideInvocation(policy(), {
      tool: 'write_file',
      args: { path: 'C:/tmp/outside.txt' },
    }).violation_code).toBe('path_invalid');

    expect(registry.decideInvocation(policy(), {
      tool: 'write_file',
      args: { path: '../outside.txt' },
    }).violation_code).toBe('path_invalid');

    expect(registry.decideInvocation(policy(), {
      tool: 'write_file',
      args: { path: 'docs/outside.md' },
    }).violation_code).toBe('path_not_allowed');

    const allowed = registry.decideInvocation(policy(), {
      tool: 'write_file',
      args: { path: 'src/domain/example.ts' },
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.normalized_path).toBe('src/domain/example.ts');
  });

  it('rejects stale tool registrations after scoped replacement', () => {
    const registry = new RuntimeToolRegistry();
    const first = registry.register({
      name: 'write_file',
      kind: 'file',
      side_effect: 'write',
      requires_write: true,
      allowed_in_restricted: true,
      path_arg: 'path',
    });
    const second = registry.register({
      name: 'write_file',
      kind: 'file',
      side_effect: 'write',
      requires_write: true,
      allowed_in_restricted: true,
      path_arg: 'path',
    });

    const stale = registry.decideInvocation(policy(), {
      tool: 'write_file',
      registration_id: first.registration_id,
      args: { path: 'src/example.ts' },
    });
    expect(stale.allowed).toBe(false);
    expect(stale.violation_code).toBe('stale_tool_registration');

    expect(registry.closeRegistration(second.registration_id)).toBe(true);
    const revealed = registry.decideInvocation(policy(), {
      tool: 'write_file',
      registration_id: first.registration_id,
      args: { path: 'src/example.ts' },
    });
    expect(revealed.allowed).toBe(true);
  });

  it('fails the session when turn or tool call limits are exceeded', () => {
    const session = new InMemoryWorkerRuntimeSession('session_runtime_001', policy({ max_turns: 1 }), new RuntimeToolRegistry());
    session.start(job());
    expect(session.send({ role: 'user', content: 'first' }).state).toBe('running');

    const overLimit = session.send({ role: 'user', content: 'second' });
    expect(overLimit.state).toBe('failed');
    expect(overLimit.events.at(-1)?.message).toContain('max_turns exceeded');

    const registry = createDefaultRuntimeToolRegistry();
    const toolLimited = new InMemoryWorkerRuntimeSession(
      'session_runtime_002',
      policy({ max_tool_calls: 1 }),
      registry,
    );
    toolLimited.start(job({ job_id: 'job_runtime_002' }));
    const result = toolLimited.send({
      role: 'worker',
      content: 'tools',
      tool_calls: [
        { tool: 'read_file', args: { path: 'src/a.ts' } },
        { tool: 'read_file', args: { path: 'src/b.ts' } },
      ],
    });
    expect(result.state).toBe('failed');
    expect(result.events.at(-1)?.message).toContain('max_tool_calls exceeded');
  });

  it('creates and restores snapshot restore points', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipyard-runtime-'));
    const target = join(root, 'src', 'example.txt');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(target, 'before', 'utf8');

    const manager = new RestorePointManager(root);
    const restorePoint = manager.createRestorePoint({
      session_id: 'session_runtime_003',
      job_id: 'job_runtime_003',
      paths: ['src/example.txt'],
      mode: 'snapshot',
    });

    writeFileSync(target, 'after', 'utf8');
    manager.restore(restorePoint);

    expect(readFileSync(target, 'utf8')).toBe('before');
    expect(restorePoint.artifact_path).toContain('artifacts/jobs/job_runtime_003/');
  });

  it('tracks restore point artifacts on the session', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipyard-runtime-session-'));
    writeFileSync(join(root, 'README.md'), 'hello', 'utf8');
    const manager = new RestorePointManager(root);
    const session = new InMemoryWorkerRuntimeSession(
      'session_runtime_004',
      policy({ restore_points: 'snapshot', allowed_paths: ['README.md'] }),
      createDefaultRuntimeToolRegistry(),
      manager,
    );

    session.start(job({ job_id: 'job_runtime_004' }));
    session.createRestorePoint(['README.md']);
    const snapshot = session.collect();

    expect(snapshot.restore_point_refs).toHaveLength(1);
    expect(snapshot.artifact_refs[0]).toContain('artifacts/jobs/job_runtime_004/');
  });
});
