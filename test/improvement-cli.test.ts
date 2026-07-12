import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createIo() {
  return {
    out: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  };
}

describe('improvement CLI', () => {
  it('exports observations with the requested window', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      schema_version: 'self-improvement/v1',
      gate_observations: [],
    }));
    const code = await runCli([
      'improve',
      'export',
      '--since',
      '2026-07-01T00:00:00Z',
      '--limit',
      '20',
      '--json',
    ], {
      io,
      fetchImpl,
      env: { SHIPYARD_API_URL: 'http://shipyard.test', SHIPYARD_API_KEY: 'operator-key' },
    });

    expect(code).toBe(0);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/v1/improvement/observations?');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('limit=20');
  });

  it('acknowledges Evidence explicitly', async () => {
    const io = createIo();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      acknowledgement_id: 'audit_1',
      evidence_id: 'EV-1',
    }));
    const code = await runCli([
      'evidence',
      'ack',
      'task_1',
      'EV-1',
      '--reviewed-by',
      'qa-user',
      '--purpose',
      'acceptance',
    ], { io, fetchImpl, env: { SHIPYARD_API_URL: 'http://shipyard.test' } });

    expect(code).toBe(0);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://shipyard.test/v1/tasks/task_1/evidence/EV-1/ack');
    expect(JSON.parse(String(init?.body))).toEqual({
      reviewed_by: 'qa-user',
      purpose: 'acceptance',
    });
  });
});
