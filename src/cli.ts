#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { WorkerType } from './types.js';

type FetchLike = typeof fetch;

interface ChecklistItemResponse {
  id: string;
  required?: boolean;
  checked?: boolean;
}

interface TaskResponse {
  task_id: string;
  state: string;
  last_verdict?: unknown;
  manual_checklist?: ChecklistItemResponse[];
  [key: string]: unknown;
}
interface CliIo {
  out(message: string): void;
  error(message: string): void;
}

interface CliContext {
  env: NodeJS.ProcessEnv;
  io: CliIo;
  fetchImpl: FetchLike;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly adminApiKey: string | undefined,
    private readonly fetchImpl: FetchLike,
  ) {}

  async request<T = unknown>(path: string, options: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
    const key = options.admin ? this.adminApiKey : this.apiKey;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-API-Key'] = key;

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new CliError('API request failed: ' + String(error));
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : text || response.statusText;
      throw new CliError('API returned ' + response.status + ': ' + detail, response.status, data);
    }
    return data as T;
  }
}

interface ParsedCommand {
  command?: string;
  action?: string;
  positionals: string[];
  values: Record<string, string | boolean | string[] | undefined>;
}

const BOOLEAN_OPTIONS = new Set(['json', 'events', 'watch', 'all', 'resume']);
const REPEATABLE_OPTIONS = new Set(['check', 'external-ref']);
const LOGICAL_WORKER_TYPES = ['codex', 'claude_code', 'google_antigravity'] as const satisfies readonly WorkerType[];

function parseCommand(argv: string[]): ParsedCommand {
  const command = argv[0];
  let action: string | undefined;
  let offset = 1;
  if ((command === 'integrate' || command === 'publish') && argv[1] && !argv[1].startsWith('-')) {
    action = argv[1];
    offset = 2;
  }
  const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> = {};
  const names = [
    'api-url', 'repo', 'title', 'typed-ref', 'worker', 'stage', 'base-sha',
    'publish-mode', 'checked-by', 'notes', 'approval-token', 'mode',
    'idempotency-key', 'integration-head-sha', 'main-updated-sha',
    'checks-passed', 'rollback-notes', 'poll-ms', 'timeout-ms',
    'check', 'external-ref', 'json', 'events', 'watch', 'all', 'resume',
  ];
  for (const name of names) {
    options[name] = {
      type: BOOLEAN_OPTIONS.has(name) ? 'boolean' : 'string',
      multiple: REPEATABLE_OPTIONS.has(name),
    };
  }
  const parsed = parseArgs({
    args: argv.slice(offset),
    options,
    allowPositionals: true,
    strict: true,
  });
  return {
    command,
    action,
    positionals: parsed.positionals,
    values: parsed.values as ParsedCommand['values'],
  };
}

function stringValue(parsed: ParsedCommand, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === 'string' ? value : undefined;
}

function stringValues(parsed: ParsedCommand, name: string): string[] {
  const value = parsed.values[name];
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

function booleanValue(parsed: ParsedCommand, name: string): boolean {
  return parsed.values[name] === true;
}

function workerSelection(parsed: ParsedCommand): WorkerType | undefined {
  const value = stringValue(parsed, 'worker');
  if (!value) return undefined;
  if (value === 'glm_5') return 'claude_code';
  if ((LOGICAL_WORKER_TYPES as readonly string[]).includes(value)) return value as WorkerType;
  throw new CliError('--worker must be codex, claude_code, google_antigravity, or glm_5 (CLI alias for claude_code)');
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new CliError(label + ' is required');
  return value;
}

function parseRepo(value: string): { owner: string; name: string } {
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError('--repo must use owner/name format');
  }
  return { owner: parts[0], name: parts[1] };
}

function parseBoolean(value: string | undefined, label: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CliError(label + ' must be true or false');
}

function output(ctx: CliContext, asJson: boolean, data: unknown, message?: string): void {
  ctx.io.out(asJson ? JSON.stringify({ ok: true, data, error: null }) : message ?? JSON.stringify(data, null, 2));
}

function outputError(ctx: CliContext, asJson: boolean, error: unknown): void {
  const cliError = error instanceof CliError ? error : new CliError(String(error));
  ctx.io.error(asJson
    ? JSON.stringify({ ok: false, data: null, error: { message: cliError.message, status: cliError.status, details: cliError.details } })
    : cliError.message);
}

function createClient(parsed: ParsedCommand, ctx: CliContext): ApiClient {
  const apiUrl = (stringValue(parsed, 'api-url') ?? ctx.env.SHIPYARD_API_URL ?? 'http://localhost:3100').replace(/\/$/, '');
  return new ApiClient(apiUrl, ctx.env.SHIPYARD_API_KEY, ctx.env.SHIPYARD_ADMIN_API_KEY, ctx.fetchImpl);
}

function titleFromObjective(objective: string): string {
  return objective.length <= 80 ? objective : objective.slice(0, 77) + '...';
}

async function runCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const objective = required(parsed.positionals.join(' ').trim() || undefined, 'objective');
  const repo = parseRepo(required(stringValue(parsed, 'repo'), '--repo'));
  const stage = stringValue(parsed, 'stage') ?? 'plan';
  if (!['plan', 'dev', 'acceptance'].includes(stage)) throw new CliError('--stage must be plan, dev, or acceptance');
  const worker = workerSelection(parsed);
  const task = await client.request<TaskResponse>('/v1/tasks', {
    method: 'POST',
    body: {
      title: stringValue(parsed, 'title') ?? titleFromObjective(objective),
      objective,
      typed_ref: stringValue(parsed, 'typed-ref') ?? 'agent-taskstate:task:local:' + randomUUID(),
      repo_ref: { provider: 'github', owner: repo.owner, name: repo.name, default_branch: 'main' },
    },
  });
  const dispatch = await client.request('/v1/tasks/' + encodeURIComponent(task.task_id) + '/dispatch', {
    method: 'POST',
    body: { target_stage: stage, worker_selection: worker },
  });
  output(ctx, booleanValue(parsed, 'json'), { task, dispatch }, 'Created ' + task.task_id + ' and dispatched ' + stage);
  return 0;
}

async function statusCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const taskId = parsed.positionals[0];
  const asJson = booleanValue(parsed, 'json');
  if (!taskId) {
    output(ctx, asJson, await client.request('/v1/tasks'));
    return 0;
  }
  const path = '/v1/tasks/' + encodeURIComponent(taskId);
  if (booleanValue(parsed, 'watch')) {
    const pollMs = Number(stringValue(parsed, 'poll-ms') ?? 2000);
    const timeoutMs = Number(stringValue(parsed, 'timeout-ms') ?? 600000);
    const started = Date.now();
    let previousState: string | undefined;
    while (Date.now() - started <= timeoutMs) {
      const task = await client.request<TaskResponse>(path);
      if (task.state !== previousState) {
        output(ctx, asJson, task, task.task_id + ': ' + task.state);
        previousState = task.state;
      }
      if (['published', 'failed', 'cancelled', 'blocked', 'rework_required'].includes(task.state)) {
        return task.state === 'published' ? 0 : 2;
      }
      await delay(pollMs);
    }
    throw new CliError('status watch timed out');
  }
  const task = await client.request<TaskResponse>(path);
  if (booleanValue(parsed, 'events')) {
    output(ctx, asJson, { task, events: await client.request(path + '/events') });
  } else {
    output(ctx, asJson, task);
  }
  return 0;
}

async function acceptCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const taskId = required(parsed.positionals[0], 'task_id');
  const checkedBy = required(stringValue(parsed, 'checked-by'), '--checked-by');
  const all = booleanValue(parsed, 'all');
  const ids = stringValues(parsed, 'check');
  if (all === (ids.length > 0)) throw new CliError('provide exactly one of --all or --check');

  let selectedIds = ids;
  if (all) {
    const task = await client.request<TaskResponse>('/v1/tasks/' + encodeURIComponent(taskId));
    selectedIds = (task.manual_checklist ?? [])
      .filter((item: { required?: boolean; checked?: boolean }) => item.required !== false && !item.checked)
      .map((item: { id: string }) => item.id);
    if (selectedIds.length === 0) throw new CliError('task has no unchecked manual checklist items');
  }
  const result = await client.request('/v1/tasks/' + encodeURIComponent(taskId) + '/acceptance/complete', {
    method: 'POST',
    body: {
      checked_items: selectedIds.map(id => ({ id, checked_by: checkedBy, notes: stringValue(parsed, 'notes') })),
    },
  });
  output(ctx, booleanValue(parsed, 'json'), result, taskId + ' accepted by ' + checkedBy);
  return 0;
}

async function integrateCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const taskId = required(parsed.positionals[0], 'task_id');
  let result: unknown;
  if (parsed.action === 'start') {
    result = await client.request('/v1/tasks/' + encodeURIComponent(taskId) + '/integrate', {
      method: 'POST',
      body: { expected_state: 'accepted', base_sha: required(stringValue(parsed, 'base-sha'), '--base-sha') },
    });
  } else if (parsed.action === 'complete') {
    result = await client.request('/v1/tasks/' + encodeURIComponent(taskId) + '/integrate/complete', {
      method: 'POST',
      body: {
        checks_passed: parseBoolean(stringValue(parsed, 'checks-passed'), '--checks-passed'),
        integration_head_sha: stringValue(parsed, 'integration-head-sha'),
        main_updated_sha: stringValue(parsed, 'main-updated-sha'),
      },
    });
  } else {
    throw new CliError('integrate action must be start or complete');
  }
  output(ctx, booleanValue(parsed, 'json'), result);
  return 0;
}

async function publishCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const taskId = required(parsed.positionals[0], 'task_id');
  const path = '/v1/tasks/' + encodeURIComponent(taskId) + '/publish';
  let result: unknown;
  if (parsed.action === 'start') {
    const mode = stringValue(parsed, 'mode') ?? 'dry_run';
    if (!['no_op', 'dry_run', 'apply'].includes(mode)) throw new CliError('--mode must be no_op, dry_run, or apply');
    const startResult = await client.request<TaskResponse>(path, {
      method: 'POST',
      body: { mode, idempotency_key: stringValue(parsed, 'idempotency-key') ?? randomUUID() },
    });
    output(ctx, booleanValue(parsed, 'json'), startResult);
    return startResult.state === 'publish_pending_approval' ? 2 : 0;
  }
  if (parsed.action === 'approve') {
    result = await client.request(path + '/approve', {
      method: 'POST',
      admin: true,
      body: { approval_token: required(stringValue(parsed, 'approval-token'), '--approval-token') },
    });
  } else if (parsed.action === 'complete') {
    result = await client.request(path + '/complete', {
      method: 'POST',
      body: {
        external_refs: stringValues(parsed, 'external-ref').map(value => ({ kind: 'release', value })),
        rollback_notes: stringValue(parsed, 'rollback-notes'),
      },
    });
  } else {
    throw new CliError('publish action must be start, approve, or complete');
  }
  output(ctx, booleanValue(parsed, 'json'), result);
  return 0;
}

async function waitForTask(client: ApiClient, taskId: string, predicate: (task: TaskResponse) => boolean, pollMs: number, timeoutMs: number): Promise<TaskResponse> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const task = await client.request<TaskResponse>('/v1/tasks/' + encodeURIComponent(taskId));
    if (predicate(task)) return task;
    if (['failed', 'cancelled', 'blocked', 'rework_required'].includes(task.state)) {
      throw new CliError('pipeline stopped in state ' + task.state, undefined, task);
    }
    await delay(pollMs);
  }
  throw new CliError('pipeline timed out');
}

async function pipelineCommand(parsed: ParsedCommand, client: ApiClient, ctx: CliContext): Promise<number> {
  const asJson = booleanValue(parsed, 'json');
  const pollMs = Number(stringValue(parsed, 'poll-ms') ?? 2000);
  const timeoutMs = Number(stringValue(parsed, 'timeout-ms') ?? 600000);
  let taskId: string;

  if (booleanValue(parsed, 'resume')) {
    taskId = required(parsed.positionals[0], 'task_id for --resume');
  } else {
    const objective = required(parsed.positionals.join(' ').trim() || undefined, 'objective');
    const repo = parseRepo(required(stringValue(parsed, 'repo'), '--repo'));
    const worker = workerSelection(parsed);
    const task = await client.request<TaskResponse>('/v1/tasks', {
      method: 'POST',
      body: {
        title: stringValue(parsed, 'title') ?? titleFromObjective(objective),
        objective,
        typed_ref: stringValue(parsed, 'typed-ref') ?? 'agent-taskstate:task:local:' + randomUUID(),
        repo_ref: { provider: 'github', owner: repo.owner, name: repo.name, default_branch: 'main' },
      },
    });
    taskId = task.task_id;
    for (const stage of ['plan', 'dev', 'acceptance']) {
      await client.request('/v1/tasks/' + encodeURIComponent(taskId) + '/dispatch', {
        method: 'POST',
        body: { target_stage: stage, worker_selection: worker },
      });
      if (stage === 'plan') {
        await waitForTask(client, taskId, taskState => taskState.state === 'planned', pollMs, timeoutMs);
      } else if (stage === 'dev') {
        await waitForTask(client, taskId, taskState => taskState.state === 'dev_completed', pollMs, timeoutMs);
      } else {
        const taskAtGate = await waitForTask(client, taskId, taskState => taskState.state === 'accepting' && Boolean(taskState.last_verdict), pollMs, timeoutMs);
        output(ctx, asJson, { task: taskAtGate, next_command: 'shipyard accept ' + taskId + ' --all --checked-by <operator>' }, 'Pipeline paused for manual acceptance: ' + taskId);
        return 2;
      }
    }
  }

  const current = await client.request<TaskResponse>('/v1/tasks/' + encodeURIComponent(taskId));
  if (current.state === 'accepting') {
    output(ctx, asJson, { task: current, next_command: 'shipyard accept ' + taskId + ' --all --checked-by <operator>' }, 'Pipeline is waiting for manual acceptance: ' + taskId);
    return 2;
  }
  if (current.state === 'accepted') {
    await client.request('/v1/tasks/' + encodeURIComponent(taskId) + '/integrate', {
      method: 'POST',
      body: { expected_state: 'accepted', base_sha: required(stringValue(parsed, 'base-sha'), '--base-sha') },
    });
  }

  const integrated = await waitForTask(client, taskId, taskState => ['integrated', 'publish_pending_approval', 'publishing', 'published'].includes(taskState.state), pollMs, timeoutMs);
  if (integrated.state === 'integrated') {
    const mode = stringValue(parsed, 'publish-mode') ?? 'dry_run';
    const publishResult = await client.request<TaskResponse>('/v1/tasks/' + encodeURIComponent(taskId) + '/publish', {
      method: 'POST',
      body: { mode, idempotency_key: stringValue(parsed, 'idempotency-key') ?? randomUUID() },
    });
    if (publishResult.state === 'publish_pending_approval') {
      output(ctx, asJson, { task: publishResult, next_command: 'shipyard publish approve ' + taskId + ' --approval-token <token>' }, 'Pipeline paused for publish approval: ' + taskId);
      return 2;
    }
  }

  const completed = await waitForTask(client, taskId, taskState => taskState.state === 'published' || taskState.state === 'publish_pending_approval', pollMs, timeoutMs);
  output(ctx, asJson, completed, 'Pipeline completed: ' + taskId);
  return completed.state === 'published' ? 0 : 2;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function usage(): string {
  return [
    'shipyard run <objective> --repo owner/name [--worker codex|claude_code|google_antigravity|glm_5] [--stage]',
    'shipyard status [task-id] [--events] [--watch] [--json]',
    'shipyard pipeline <objective> --repo owner/name --base-sha <sha>',
    'shipyard pipeline --resume <task-id> --base-sha <sha>',
    'shipyard accept <task-id> (--check <id>... | --all) --checked-by <id>',
    'shipyard integrate start|complete <task-id> ...',
    'shipyard publish start|approve|complete <task-id> ...',
  ].join('\n');
}

export async function runCli(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const ctx: CliContext = {
    env: overrides.env ?? process.env,
    io: overrides.io ?? { out: message => console.log(message), error: message => console.error(message) },
    fetchImpl: overrides.fetchImpl ?? fetch,
  };
  let parsed: ParsedCommand | undefined;
  try {
    parsed = parseCommand(argv);
    if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
      ctx.io.out(usage());
      return 0;
    }
    const client = createClient(parsed, ctx);
    switch (parsed.command) {
      case 'run': return await runCommand(parsed, client, ctx);
      case 'status': return await statusCommand(parsed, client, ctx);
      case 'pipeline': return await pipelineCommand(parsed, client, ctx);
      case 'accept': return await acceptCommand(parsed, client, ctx);
      case 'integrate': return await integrateCommand(parsed, client, ctx);
      case 'publish': return await publishCommand(parsed, client, ctx);
      default: throw new CliError('unknown command: ' + parsed.command + '\n' + usage());
    }
  } catch (error) {
    outputError(ctx, parsed ? booleanValue(parsed, 'json') : false, error);
    return 1;
  }
}

const invokedAsScript = process.argv[1] && new URL(import.meta.url).pathname.toLowerCase().endsWith(process.argv[1].replace(/\\/g, '/').toLowerCase());
if (invokedAsScript) {
  runCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
