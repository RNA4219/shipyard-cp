import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createIo() {
  return {
    out: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  };
}

describe('shipyard CLI', () => {
  it('prints usage without calling the API', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>();
    const code = await runCli(['help'], { io, fetchImpl, env: {} });

    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(io.out).toHaveBeenCalledWith(expect.stringContaining('shipyard run'));
  });

  it('creates and dispatches a task with generated typed_ref', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'task_1', state: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job_1', state: 'planning' }));

    const code = await runCli(['run', 'Implement', 'feature', '--repo', 'acme/repo', '--json'], {
      io,
      fetchImpl,
      env: {
        SHIPYARD_API_URL: 'http://shipyard.test',
        SHIPYARD_API_KEY: 'operator-key',
      },
    });

    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://shipyard.test/v1/tasks');
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'operator-key' });
    const body = JSON.parse(String(init?.body));
    expect(body.objective).toBe('Implement feature');
    expect(body.typed_ref).toMatch(/^agent-taskstate:task:local:/);
    expect(body.repo_ref).toMatchObject({ owner: 'acme', name: 'repo' });
    expect(JSON.parse(io.out.mock.calls[0][0])).toMatchObject({ ok: true, error: null });
  });

  it('maps the legacy glm_5 CLI worker alias to the claude_code logical worker', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'task_glm', state: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job_glm', state: 'planning' }));

    const code = await runCli([
      'run', 'Plan with GLM', '--repo', 'acme/repo', '--worker', 'glm_5',
    ], { io, fetchImpl, env: {} });

    expect(code).toBe(0);
    const [, dispatchInit] = fetchImpl.mock.calls[1];
    expect(JSON.parse(String(dispatchInit?.body))).toMatchObject({
      target_stage: 'plan',
      worker_selection: 'claude_code',
    });
  });

  it('rejects an unknown worker before creating a task', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>();

    const code = await runCli([
      'run', 'Plan with unknown worker', '--repo', 'acme/repo', '--worker', 'glm5',
    ], { io, fetchImpl, env: {} });

    expect(code).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('--worker must be'));
  });

  it('uses --api-url before the environment default', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const code = await runCli(['status', '--api-url', 'http://override.test'], {
      io,
      fetchImpl,
      env: { SHIPYARD_API_URL: 'http://env.test' },
    });

    expect(code).toBe(0);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://override.test/v1/tasks');
  });

  it('checks all required manual checklist items', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        task_id: 'task_1',
        manual_checklist: [
          { id: 'required-open', required: true, checked: false },
          { id: 'done', required: true, checked: true },
          { id: 'optional', required: false, checked: false },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ task_id: 'task_1', state: 'accepted' }));

    const code = await runCli(['accept', 'task_1', '--all', '--checked-by', 'qa-user', '--notes', 'verified'], {
      io,
      fetchImpl,
      env: { SHIPYARD_API_KEY: 'operator-key' },
    });

    expect(code).toBe(0);
    const [, init] = fetchImpl.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      checked_items: [{ id: 'required-open', checked_by: 'qa-user', notes: 'verified' }],
    });
  });

  it('uses the admin key for publish approval', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      task_id: 'task_1',
      state: 'publishing',
    }));

    const code = await runCli(['publish', 'approve', 'task_1', '--approval-token', 'approval_1'], {
      io,
      fetchImpl,
      env: {
        SHIPYARD_API_KEY: 'operator-key',
        SHIPYARD_ADMIN_API_KEY: 'admin-key',
      },
    });

    expect(code).toBe(0);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'admin-key' });
  });

  it('prints the publish start response and pauses when approval is required', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      task_id: 'task_1',
      state: 'publish_pending_approval',
    }));

    const code = await runCli(['publish', 'start', 'task_1', '--mode', 'apply', '--json'], {
      io,
      fetchImpl,
      env: { SHIPYARD_API_KEY: 'operator-key' },
    });

    expect(code).toBe(2);
    expect(JSON.parse(io.out.mock.calls[0][0])).toMatchObject({
      ok: true,
      data: { task_id: 'task_1', state: 'publish_pending_approval' },
      error: null,
    });
  });

  it('uses the public external ref wire shape when completing publish', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      task_id: 'task_1',
      state: 'published',
    }));

    const code = await runCli([
      'publish', 'complete', 'task_1',
      '--external-ref', 'v0.4.0',
      '--rollback-notes', 'revert release',
      '--json',
    ], {
      io,
      fetchImpl,
      env: { SHIPYARD_API_KEY: 'operator-key' },
    });

    expect(code).toBe(0);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      external_refs: [{ kind: 'release', value: 'v0.4.0' }],
      rollback_notes: 'revert release',
    });
  });

  it('pauses pipeline at explicit manual acceptance', async () => {
    const io = createIo();
    const responses = [
      { task_id: 'task_1', state: 'queued' },
      { job_id: 'plan_1' },
      { task_id: 'task_1', state: 'planned' },
      { job_id: 'dev_1' },
      { task_id: 'task_1', state: 'dev_completed' },
      { job_id: 'acceptance_1' },
      {
        task_id: 'task_1',
        state: 'accepting',
        last_verdict: { outcome: 'accept' },
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of responses) {
      fetchImpl.mockResolvedValueOnce(jsonResponse(response));
    }

    const code = await runCli([
      'pipeline',
      'Implement feature',
      '--repo', 'acme/repo',
      '--worker', 'glm_5',
      '--base-sha', 'abc123',
      '--poll-ms', '0',
    ], { io, fetchImpl, env: { SHIPYARD_API_KEY: 'operator-key' } });

    expect(code).toBe(2);
    expect(io.out).toHaveBeenCalledWith(expect.stringContaining('manual acceptance'));
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    for (const callIndex of [1, 3, 5]) {
      const [, dispatchInit] = fetchImpl.mock.calls[callIndex];
      expect(JSON.parse(String(dispatchInit?.body))).toMatchObject({ worker_selection: 'claude_code' });
    }
  });

  it('returns a JSON error envelope', async () => {
    const io = createIo();
    const code = await runCli(['run', 'missing repo', '--json'], { io, fetchImpl: vi.fn(), env: {} });

    expect(code).toBe(1);
    expect(JSON.parse(io.error.mock.calls[0][0])).toMatchObject({
      ok: false,
      data: null,
      error: { message: '--repo is required' },
    });
  });
});
