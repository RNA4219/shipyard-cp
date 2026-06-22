import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import type { WorkerJob, WorkerStage, WorkerType } from '../../types.js';

export type WorkerRuntimeSessionState = 'created' | 'running' | 'interrupted' | 'completed' | 'failed' | 'closed';
export type WorkerRuntimeMode = 'interactive' | 'one_shot' | 'rework';
export type RestorePointMode = 'disabled' | 'manifest' | 'snapshot';

export interface WorkerRuntimePolicy {
  mode: WorkerRuntimeMode;
  allowed_paths?: string[];
  max_turns: number;
  max_tool_calls: number;
  restricted_tools: boolean;
  allow_subagents: boolean;
  restore_points: RestorePointMode;
}

export interface WorkerRuntimeSessionSnapshot {
  session_id: string;
  job_id: string;
  worker_type: WorkerType;
  stage: WorkerStage;
  state: WorkerRuntimeSessionState;
  turn_count: number;
  tool_call_count: number;
  admitted_input_count: number;
  artifact_refs: string[];
  restore_point_refs: string[];
  events: WorkerRuntimeEvent[];
  event_cursor: number;
}

export interface WorkerRuntimeEvent {
  event_id: string;
  sequence: number;
  event_type:
    | 'session.started'
    | 'session.input_admitted'
    | 'session.input_promoted'
    | 'session.turn_recorded'
    | 'session.tool_decision'
    | 'session.interrupted'
    | 'session.completed'
    | 'session.failed'
    | 'session.closed'
    | 'session.restore_point_created';
  message: string;
  created_at: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface WorkerRuntimeTurn {
  role: 'user' | 'worker' | 'system' | 'tool';
  content: string;
  created_at: string;
  tool_calls?: ToolInvocationRequest[];
}

export type WorkerRuntimeInputDelivery = 'steer' | 'queue';
export type WorkerRuntimeInputState = 'admitted' | 'promoted';

export interface WorkerRuntimeInput {
  input_id: string;
  session_id: string;
  content: string;
  delivery: WorkerRuntimeInputDelivery;
  state: WorkerRuntimeInputState;
  created_at: string;
  promoted_at?: string;
}

export interface WorkerRuntimeInputReceipt {
  input: WorkerRuntimeInput;
  exact_retry: boolean;
  scheduled: boolean;
}

export interface WorkerRuntimeSession {
  start(job: WorkerJob): WorkerRuntimeSessionSnapshot;
  send(turn: Omit<WorkerRuntimeTurn, 'created_at'>): WorkerRuntimeSessionSnapshot;
  interrupt(reason: string): WorkerRuntimeSessionSnapshot;
  complete(summary: string): WorkerRuntimeSessionSnapshot;
  fail(reason: string): WorkerRuntimeSessionSnapshot;
  close(): WorkerRuntimeSessionSnapshot;
  collect(): WorkerRuntimeSessionSnapshot;
}

export type RuntimeToolKind = 'file' | 'shell' | 'web' | 'todo' | 'memory' | 'agent' | 'llm' | 'other';

export interface RuntimeToolDefinition {
  name: string;
  kind: RuntimeToolKind;
  side_effect: 'none' | 'read' | 'write' | 'process' | 'network';
  requires_write: boolean;
  allowed_in_restricted: boolean;
  starts_subagent?: boolean;
  path_arg?: string;
}

export interface RuntimeToolRegistration {
  registration_id: string;
  tool: RuntimeToolDefinition;
  registered_at: string;
}

export interface ToolInvocationRequest {
  tool: string;
  args: Record<string, unknown>;
  registration_id?: string;
}

export interface ToolInvocationDecision {
  allowed: boolean;
  reason: string;
  violation_code?: 'unknown_tool' | 'restricted_tool' | 'subagent_disabled' | 'path_invalid' | 'path_not_allowed' | 'stale_tool_registration';
  normalized_path?: string;
  registration_id?: string;
}

export class RuntimeToolRegistry {
  private readonly tools = new Map<string, RuntimeToolRegistration[]>();
  private nextRegistration = 0;

  register(tool: RuntimeToolDefinition): RuntimeToolRegistration {
    const registration: RuntimeToolRegistration = {
      registration_id: `toolreg_${++this.nextRegistration}`,
      tool: { ...tool },
      registered_at: new Date().toISOString(),
    };
    this.tools.set(tool.name, [...(this.tools.get(tool.name) ?? []), registration]);
    return registration;
  }

  closeRegistration(registrationId: string): boolean {
    for (const [name, registrations] of this.tools.entries()) {
      const next = registrations.filter(registration => registration.registration_id !== registrationId);
      if (next.length === registrations.length) {
        continue;
      }
      if (next.length === 0) {
        this.tools.delete(name);
        return true;
      }
      this.tools.set(name, next);
      return true;
    }
    return false;
  }

  list(): RuntimeToolDefinition[] {
    return Array.from(this.tools.values()).flatMap(registrations => registrations.at(-1)?.tool ?? []);
  }

  decideInvocation(policy: WorkerRuntimePolicy, request: ToolInvocationRequest): ToolInvocationDecision {
    const registration = this.tools.get(request.tool)?.at(-1);
    if (!registration) {
      return { allowed: false, reason: `unknown tool: ${request.tool}`, violation_code: 'unknown_tool' };
    }
    if (request.registration_id && request.registration_id !== registration.registration_id) {
      return {
        allowed: false,
        reason: `stale tool registration: ${request.tool}`,
        violation_code: 'stale_tool_registration',
        registration_id: registration.registration_id,
      };
    }
    const tool = registration.tool;
    if (policy.restricted_tools && !tool.allowed_in_restricted) {
      return {
        allowed: false,
        reason: `tool is not allowed in restricted mode: ${tool.name}`,
        violation_code: 'restricted_tool',
        registration_id: registration.registration_id,
      };
    }
    if (!policy.allow_subagents && tool.starts_subagent) {
      return {
        allowed: false,
        reason: `sub-agent tool is disabled for this session: ${tool.name}`,
        violation_code: 'subagent_disabled',
        registration_id: registration.registration_id,
      };
    }
    if (!tool.path_arg) {
      return { allowed: true, reason: 'tool invocation allowed', registration_id: registration.registration_id };
    }

    const pathValue = request.args[tool.path_arg];
    const normalized = normalizeRepoPath(pathValue);
    if (!normalized.ok) {
      return {
        allowed: false,
        reason: normalized.error,
        violation_code: 'path_invalid',
        registration_id: registration.registration_id,
      };
    }
    if (tool.requires_write && policy.allowed_paths && !isAllowedPath(normalized.path, policy.allowed_paths)) {
      return {
        allowed: false,
        reason: `path is outside allowed_paths: ${normalized.path}`,
        violation_code: 'path_not_allowed',
        normalized_path: normalized.path,
        registration_id: registration.registration_id,
      };
    }

    return {
      allowed: true,
      reason: 'tool invocation allowed',
      normalized_path: normalized.path,
      registration_id: registration.registration_id,
    };
  }
}

export interface RestorePointFile {
  path: string;
  existed: boolean;
  content?: string;
}

export interface RestorePoint {
  restore_point_id: string;
  session_id: string;
  job_id: string;
  created_at: string;
  files: RestorePointFile[];
  artifact_path?: string;
}

export class RestorePointManager {
  constructor(
    private readonly workspaceRoot: string,
    private readonly artifactRoot = join(workspaceRoot, 'artifacts', 'jobs'),
  ) {}

  createRestorePoint(input: {
    session_id: string;
    job_id: string;
    paths: string[];
    mode: RestorePointMode;
  }): RestorePoint {
    const restorePoint: RestorePoint = {
      restore_point_id: `rp_${input.session_id}_${Date.now()}`,
      session_id: input.session_id,
      job_id: input.job_id,
      created_at: new Date().toISOString(),
      files: input.mode === 'disabled' ? [] : input.paths.map(pathText => this.snapshotFile(pathText, input.mode)),
    };
    if (input.mode !== 'disabled') {
      restorePoint.artifact_path = this.writeRestorePoint(input.job_id, restorePoint);
    }
    return restorePoint;
  }

  restore(restorePoint: RestorePoint): void {
    for (const file of restorePoint.files) {
      const resolved = resolveWorkspacePath(this.workspaceRoot, file.path);
      if (!file.existed) {
        if (existsSync(resolved)) {
          rmSync(resolved);
        }
        continue;
      }
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, file.content ?? '', 'utf8');
    }
  }

  private snapshotFile(pathText: string, mode: RestorePointMode): RestorePointFile {
    const normalized = normalizeRepoPath(pathText);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    const resolved = resolveWorkspacePath(this.workspaceRoot, normalized.path);
    const existed = existsSync(resolved);
    return {
      path: normalized.path,
      existed,
      content: mode === 'snapshot' && existed ? readFileSync(resolved, 'utf8') : undefined,
    };
  }

  private writeRestorePoint(jobId: string, restorePoint: RestorePoint): string {
    const artifactPath = join(this.artifactRoot, jobId, `${restorePoint.restore_point_id}.restore-point.json`);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(restorePoint, null, 2)}\n`, 'utf8');
    return relative(this.workspaceRoot, artifactPath).replace(/\\/g, '/');
  }
}

export class InMemoryWorkerRuntimeSession implements WorkerRuntimeSession {
  private job?: WorkerJob;
  private state: WorkerRuntimeSessionState = 'created';
  private readonly turns: WorkerRuntimeTurn[] = [];
  private readonly events: WorkerRuntimeEvent[] = [];
  private readonly admittedInputs = new Map<string, WorkerRuntimeInput>();
  private readonly artifactRefs: string[] = [];
  private readonly restorePointRefs: string[] = [];
  private toolCallCount = 0;
  private nextEventSequence = 0;

  constructor(
    private readonly sessionId: string,
    private readonly policy: WorkerRuntimePolicy,
    private readonly registry = new RuntimeToolRegistry(),
    private readonly restorePointManager?: RestorePointManager,
  ) {}

  start(job: WorkerJob): WorkerRuntimeSessionSnapshot {
    this.job = job;
    this.state = 'running';
    this.recordEvent('session.started', `session started for job ${job.job_id}`);
    return this.collect();
  }

  admitInput(input: {
    input_id: string;
    content: string;
    delivery?: WorkerRuntimeInputDelivery;
    resume?: boolean;
  }): WorkerRuntimeInputReceipt {
    this.assertRunning();
    const delivery = input.delivery ?? 'steer';
    const existing = this.admittedInputs.get(input.input_id);
    if (existing) {
      if (existing.content !== input.content || existing.delivery !== delivery) {
        throw new Error(`input_id reuse conflicts with admitted input: ${input.input_id}`);
      }
      return { input: { ...existing }, exact_retry: true, scheduled: input.resume !== false };
    }

    const admitted: WorkerRuntimeInput = {
      input_id: input.input_id,
      session_id: this.sessionId,
      content: input.content,
      delivery,
      state: 'admitted',
      created_at: new Date().toISOString(),
    };
    this.admittedInputs.set(input.input_id, admitted);
    this.recordEvent('session.input_admitted', `input admitted: ${input.input_id}`, {
      input_id: input.input_id,
      delivery,
      scheduled: input.resume !== false,
    });
    return { input: { ...admitted }, exact_retry: false, scheduled: input.resume !== false };
  }

  promoteAdmittedInputs(): WorkerRuntimeSessionSnapshot {
    this.assertRunning();
    for (const input of this.admittedInputs.values()) {
      if (input.state === 'promoted') {
        continue;
      }
      input.state = 'promoted';
      input.promoted_at = new Date().toISOString();
      this.turns.push({
        role: 'user',
        content: input.content,
        created_at: input.promoted_at,
      });
      this.recordEvent('session.input_promoted', `input promoted: ${input.input_id}`, {
        input_id: input.input_id,
        delivery: input.delivery,
      });
      if (input.delivery === 'queue') {
        break;
      }
    }
    return this.collect();
  }

  send(turn: Omit<WorkerRuntimeTurn, 'created_at'>): WorkerRuntimeSessionSnapshot {
    this.assertRunning();
    if (this.turns.length >= this.policy.max_turns) {
      return this.fail(`max_turns exceeded: ${this.policy.max_turns}`);
    }

    const toolCalls = turn.tool_calls ?? [];
    if (this.toolCallCount + toolCalls.length > this.policy.max_tool_calls) {
      return this.fail(`max_tool_calls exceeded: ${this.policy.max_tool_calls}`);
    }

    for (const call of toolCalls) {
      const decision = this.registry.decideInvocation(this.policy, call);
      this.recordEvent('session.tool_decision', decision.reason, {
        tool: call.tool,
        allowed: decision.allowed,
        violation_code: decision.violation_code ?? null,
      });
      if (!decision.allowed) {
        return this.fail(decision.reason);
      }
    }

    this.toolCallCount += toolCalls.length;
    this.turns.push({ ...turn, created_at: new Date().toISOString() });
    this.recordEvent('session.turn_recorded', `turn recorded: ${turn.role}`);
    return this.collect();
  }

  interrupt(reason: string): WorkerRuntimeSessionSnapshot {
    this.state = 'interrupted';
    this.recordEvent('session.interrupted', reason);
    return this.collect();
  }

  complete(summary: string): WorkerRuntimeSessionSnapshot {
    this.state = 'completed';
    this.recordEvent('session.completed', summary);
    return this.collect();
  }

  fail(reason: string): WorkerRuntimeSessionSnapshot {
    this.state = 'failed';
    this.recordEvent('session.failed', reason);
    return this.collect();
  }

  close(): WorkerRuntimeSessionSnapshot {
    this.state = 'closed';
    this.recordEvent('session.closed', 'session closed');
    return this.collect();
  }

  createRestorePoint(paths: string[]): RestorePoint | undefined {
    if (!this.job || !this.restorePointManager || this.policy.restore_points === 'disabled') {
      return undefined;
    }
    const restorePoint = this.restorePointManager.createRestorePoint({
      session_id: this.sessionId,
      job_id: this.job.job_id,
      paths,
      mode: this.policy.restore_points,
    });
    if (restorePoint.artifact_path) {
      this.artifactRefs.push(restorePoint.artifact_path);
      this.restorePointRefs.push(restorePoint.restore_point_id);
    }
    this.recordEvent('session.restore_point_created', `restore point created: ${restorePoint.restore_point_id}`);
    return restorePoint;
  }

  collect(): WorkerRuntimeSessionSnapshot {
    if (!this.job) {
      return {
        session_id: this.sessionId,
        job_id: '',
        worker_type: 'codex',
        stage: 'plan',
        state: this.state,
        turn_count: this.turns.length,
        tool_call_count: this.toolCallCount,
        admitted_input_count: this.admittedInputs.size,
        artifact_refs: [...this.artifactRefs],
        restore_point_refs: [...this.restorePointRefs],
        events: [...this.events],
        event_cursor: this.nextEventSequence,
      };
    }
    return {
      session_id: this.sessionId,
      job_id: this.job.job_id,
      worker_type: this.job.worker_type,
      stage: this.job.stage,
      state: this.state,
      turn_count: this.turns.length,
      tool_call_count: this.toolCallCount,
      admitted_input_count: this.admittedInputs.size,
      artifact_refs: [...this.artifactRefs],
      restore_point_refs: [...this.restorePointRefs],
      events: [...this.events],
      event_cursor: this.nextEventSequence,
    };
  }

  collectEvents(afterSequence = 0): WorkerRuntimeEvent[] {
    return this.events.filter(event => event.sequence > afterSequence);
  }

  private assertRunning(): void {
    if (this.state !== 'running') {
      throw new Error(`session is not running: ${this.state}`);
    }
  }

  private recordEvent(
    eventType: WorkerRuntimeEvent['event_type'],
    message: string,
    metadata?: WorkerRuntimeEvent['metadata'],
  ): void {
    const sequence = ++this.nextEventSequence;
    this.events.push({
      event_id: `evt_${this.sessionId}_${sequence}`,
      sequence,
      event_type: eventType,
      message,
      created_at: new Date().toISOString(),
      metadata,
    });
  }
}

export function createDefaultRuntimeToolRegistry(): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry();
  registry.register({ name: 'read_file', kind: 'file', side_effect: 'read', requires_write: false, allowed_in_restricted: true, path_arg: 'path' });
  registry.register({ name: 'write_file', kind: 'file', side_effect: 'write', requires_write: true, allowed_in_restricted: true, path_arg: 'path' });
  registry.register({ name: 'apply_patch_intent', kind: 'file', side_effect: 'write', requires_write: true, allowed_in_restricted: true, path_arg: 'path' });
  registry.register({ name: 'bash', kind: 'shell', side_effect: 'process', requires_write: false, allowed_in_restricted: false });
  registry.register({ name: 'web_fetch', kind: 'web', side_effect: 'network', requires_write: false, allowed_in_restricted: false });
  registry.register({ name: 'spawn_agent', kind: 'agent', side_effect: 'process', requires_write: false, allowed_in_restricted: false, starts_subagent: true });
  return registry;
}

function normalizeRepoPath(value: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: 'path must be a non-empty string' };
  }
  if (isAbsolute(value)) {
    return { ok: false, error: `path must be repo-relative: ${value}` };
  }
  const parts = value.split(/[\\/]/);
  if (parts.includes('..')) {
    return { ok: false, error: `path must not contain '..': ${value}` };
  }
  return { ok: true, path: value.replace(/\\/g, '/').replace(/^\.\/+/, '') };
}

function isAllowedPath(repoPath: string, allowedPaths: string[]): boolean {
  const normalizedAllowed = allowedPaths.map(pathText => pathText.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, ''));
  return normalizedAllowed.some(prefix => repoPath === prefix || repoPath.startsWith(`${prefix}/`));
}

function resolveWorkspacePath(workspaceRoot: string, repoPath: string): string {
  const resolved = resolve(workspaceRoot, repoPath);
  const relativePath = relative(workspaceRoot, resolved);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`path escapes workspace: ${repoPath}`);
  }
  return resolved;
}
