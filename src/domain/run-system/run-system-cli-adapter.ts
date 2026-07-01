import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { RunSystemPacket } from './run-system-packet.js';
import type { GatefieldVerdict, StateGateVerdict } from './run-system-gate.js';
import { getLogger } from '../../monitoring/index.js';

export type ExternalCliStatus = 'passed' | 'warned' | 'failed' | 'skipped';

export interface ExternalCliCommandResult {
  system: 'agent-protocols' | 'agent-taskstate' | 'agent-gatefield' | 'agent-state-gate';
  command: string;
  cwd: string;
  exit_code: number | null;
  status: ExternalCliStatus;
  stdout: string;
  stderr: string;
  parsed_json?: unknown;
  summary: string;
}

export interface ExternalRunSystemCliReport {
  schema_version: '1.0';
  invoked: boolean;
  mode: RunSystemPacket['mode'];
  results: ExternalCliCommandResult[];
  gatefield_decision?: GatefieldVerdict;
  state_gate_verdict?: StateGateVerdict;
  blockers: string[];
  residual_risks: string[];
  artifact_path?: string;
}

export interface RunSystemCliAdapter {
  run(packet: RunSystemPacket): ExternalRunSystemCliReport;
}

export interface LocalRunSystemCliAdapterOptions {
  repoRoot?: string;
  timeoutMs?: number;
  artifactRoot?: string;
  runner?: SyncCommandRunner;
}

export interface SyncCommandRunner {
  run(command: string, args: string[], options: { cwd: string; timeoutMs: number }): SpawnSyncLike;
}

export interface SpawnSyncLike {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class LocalRunSystemCliAdapter implements RunSystemCliAdapter {
  private readonly repoRoot: string;
  private readonly timeoutMs: number;
  private readonly artifactRoot: string;
  private readonly runner: SyncCommandRunner;

  constructor(options: LocalRunSystemCliAdapterOptions = {}) {
    this.repoRoot = options.repoRoot ?? resolve(process.cwd(), '..');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.artifactRoot = options.artifactRoot ?? join(process.cwd(), 'artifacts', 'run-system-cli');
    this.runner = options.runner ?? new SpawnSyncCommandRunner();
  }

  run(packet: RunSystemPacket): ExternalRunSystemCliReport {
    const results = [
      this.runAgentProtocols(),
      this.runAgentTaskstate(),
      this.runAgentGatefield(packet),
      this.runAgentStateGate(packet),
    ];
    const blockers = results
      .filter(result => result.status === 'failed')
      .map(result => `${result.system}: ${result.summary}`);
    const residualRisks = results
      .filter(result => result.status === 'warned' || result.status === 'skipped')
      .map(result => `${result.system}: ${result.summary}`);
    const report: ExternalRunSystemCliReport = {
      schema_version: '1.0',
      invoked: true,
      mode: packet.mode,
      results,
      gatefield_decision: readGatefieldDecision(results),
      state_gate_verdict: readStateGateVerdict(results),
      blockers,
      residual_risks: residualRisks,
    };
    const artifactPath = this.writeReport(packet, report);
    return { ...report, artifact_path: artifactPath };
  }

  private runAgentProtocols(): ExternalCliCommandResult {
    const cwd = join(this.repoRoot, 'agent-protocols');
    if (!existsSync(cwd)) {
      return skipped('agent-protocols', 'repo not found', cwd, 'npm run validate');
    }
    return this.runCommand('agent-protocols', 'npm', ['run', 'validate', '--', '--run', '--reporter=dot'], cwd, {
      successExitCodes: [0],
    });
  }

  private runAgentTaskstate(): ExternalCliCommandResult {
    const cwd = join(this.repoRoot, 'agent-taskstate');
    if (!existsSync(cwd)) {
      return skipped('agent-taskstate', 'repo not found', cwd, 'uv run --offline --no-sync python -m src.cli --help');
    }
    return this.runCommand('agent-taskstate', 'uv', ['run', '--offline', '--no-sync', 'python', '-m', 'src.cli', '--help'], cwd, {
      successExitCodes: [0],
    });
  }

  private runAgentGatefield(packet: RunSystemPacket): ExternalCliCommandResult {
    const cwd = join(this.repoRoot, 'agent-gatefield');
    if (!existsSync(cwd)) {
      return skipped('agent-gatefield', 'repo not found', cwd, 'uv run --offline --no-sync python -m cli.gate_cli dry-run --json');
    }
    const result = this.runCommand(
      'agent-gatefield',
      'uv',
      ['run', '--offline', '--no-sync', 'python', '-m', 'cli.gate_cli', 'dry-run', '--run-id', packet.run.job_id, '--json'],
      cwd,
      { successExitCodes: [0, 1], jsonStdout: true },
    );
    const decision = readDecision(result.parsed_json);
    if (decision === 'block') {
      return { ...result, status: 'failed', summary: 'agent-gatefield returned block' };
    }
    if (decision === 'hold') {
      return { ...result, status: 'warned', summary: 'agent-gatefield returned hold' };
    }
    return result;
  }

  private runAgentStateGate(packet: RunSystemPacket): ExternalCliCommandResult {
    const cwd = join(this.repoRoot, 'agent-state-gate');
    if (!existsSync(cwd)) {
      return skipped('agent-state-gate', 'repo not found', cwd, 'uv run --offline --no-sync agent-state-gate gate evaluate --output json');
    }
    return this.runCommand(
      'agent-state-gate',
      'uv',
      ['run', '--offline', '--no-sync', 'agent-state-gate', 'gate', 'evaluate', '--task', packet.run.task_id, '--run', packet.run.job_id, '--output', 'json'],
      cwd,
      { successExitCodes: [0], jsonStdout: true },
    );
  }

  private runCommand(
    system: ExternalCliCommandResult['system'],
    command: string,
    args: string[],
    cwd: string,
    options: { successExitCodes: number[]; jsonStdout?: boolean },
  ): ExternalCliCommandResult {
    const commandText = [command, ...args].join(' ');
    const raw = this.runner.run(command, args, { cwd, timeoutMs: this.timeoutMs });
    const stdout = stringifyOutput(raw.stdout);
    const stderr = stringifyOutput(raw.stderr);
    const exitCode = raw.status;
    const parsedJsonResult = options.jsonStdout ? parseJson(stdout, system) : { value: undefined, error: undefined };
    const parsedJson = parsedJsonResult.value;
    const errorSummary = raw.error ? raw.error.message : undefined;
    const ok = exitCode !== null && options.successExitCodes.includes(exitCode);
    const jsonParseFailed = options.jsonStdout === true && ok && parsedJsonResult.error !== undefined;

    return {
      system,
      command: commandText,
      cwd,
      exit_code: exitCode,
      status: ok && !jsonParseFailed ? 'passed' : 'failed',
      stdout,
      stderr,
      parsed_json: parsedJson,
      summary: errorSummary ?? parsedJsonResult.error ?? (ok ? 'command completed' : `command exited ${exitCode ?? 'null'}`),
    };
  }

  private writeReport(packet: RunSystemPacket, report: ExternalRunSystemCliReport): string {
    const artifactPath = join(this.artifactRoot, packet.run.job_id, 'external-cli-report.json');
    mkdirp(dirname(artifactPath));
    writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return artifactPath;
  }
}

class SpawnSyncCommandRunner implements SyncCommandRunner {
  run(command: string, args: string[], options: { cwd: string; timeoutMs: number }): SpawnSyncReturns<Buffer> {
    const resolved = resolveCommand(command, args);
    return spawnSync(resolved.command, resolved.args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      encoding: 'buffer',
      shell: resolved.shell,
      windowsHide: true,
    });
  }
}

interface ResolvedCommand {
  command: string;
  args: string[];
  shell: boolean;
}

function resolveCommand(command: string, args: string[]): ResolvedCommand {
  if (process.platform !== 'win32') {
    return { command, args, shell: false };
  }
  if ((command === 'npm' || command === 'npx') && process.env.npm_execpath) {
    const npmArgs = command === 'npx' ? ['exec', '--', ...args] : args;
    return { command: process.execPath, args: [process.env.npm_execpath, ...npmArgs], shell: false };
  }
  if (command === 'npm') {
    return { command: 'npm.cmd', args, shell: false };
  }
  if (command === 'npx') {
    return { command: 'npx.cmd', args, shell: false };
  }
  return { command, args, shell: false };
}

function skipped(
  system: ExternalCliCommandResult['system'],
  summary: string,
  cwd: string,
  command: string,
): ExternalCliCommandResult {
  return {
    system,
    command,
    cwd,
    exit_code: null,
    status: 'skipped',
    stdout: '',
    stderr: '',
    summary,
  };
}

function readGatefieldDecision(results: ExternalCliCommandResult[]): GatefieldVerdict | undefined {
  const result = results.find(item => item.system === 'agent-gatefield');
  const decision = readDecision(result?.parsed_json);
  if (decision === 'pass' || decision === 'warn' || decision === 'hold' || decision === 'block') {
    return decision;
  }
  return undefined;
}

function readStateGateVerdict(results: ExternalCliCommandResult[]): StateGateVerdict | undefined {
  const result = results.find(item => item.system === 'agent-state-gate');
  if (!isJsonObject(result?.parsed_json)) {
    return undefined;
  }
  const verdict = result.parsed_json.verdict ?? result.parsed_json.status;
  if (
    verdict === 'allow' ||
    verdict === 'revise' ||
    verdict === 'needs_approval' ||
    verdict === 'require_human' ||
    verdict === 'stale_blocked' ||
    verdict === 'deny'
  ) {
    return verdict;
  }
  return undefined;
}

function readDecision(value: unknown): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const decision = value.decision;
  return typeof decision === 'string' ? decision : undefined;
}

function parseJson(value: string, system: ExternalCliCommandResult['system']): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(value) };
  } catch (error) {
    const summary = `failed to parse ${system} JSON stdout`;
    getLogger().child({ component: 'LocalRunSystemCliAdapter', system }).warn(summary, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: summary };
  }
}

function stringifyOutput(value: string | Buffer | undefined): string {
  if (value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : value.toString('utf8');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mkdirp(path: string): void {
  mkdirSync(path, { recursive: true });
}
