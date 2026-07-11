import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TestResult, ToolPlanOutput, WorkerJob } from '../../types.js';

const execFileAsync = promisify(execFile);

export interface ToolPlanOperationResult {
  tool: string;
  status: 'applied' | 'planned' | 'skipped' | 'failed';
  path?: string;
  message?: string;
}

export type ToolPlanExecutionVerdict = 'executed' | 'applied' | 'skipped' | 'failed' | 'dry_run';

export interface ToolPlanExecutionResult {
  execution_verdict: ToolPlanExecutionVerdict;
  dry_run: boolean;
  applied: boolean;
  skipped: boolean;
  workspace_root?: string;
  operations: ToolPlanOperationResult[];
  test_results: TestResult[];
  errors: string[];
  artifact_paths: string[];
  test_failure_summaries: string[];
}

interface ToolPlanExecutionOptions {
  dryRun: boolean;
  allowedPaths?: string[];
  maxFiles: number;
  maxWriteBytesPerFile: number;
}

interface WriteArtifact {
  path: string;
  before: string | null;
  after: string;
}

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_WRITE_BYTES_PER_FILE = 200 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND_MAX_OUTPUT_CHARS = 32_000;

interface SafeCommandSpec {
  bin: string;
  args: string[];
  rendered: string;
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
}

export class ToolPlanExecutor {
  async execute(plan: ToolPlanOutput, job: WorkerJob): Promise<ToolPlanExecutionResult> {
    const workspaceRoot = this.resolveWorkspaceRoot(job);
    let options: ToolPlanExecutionOptions;
    try {
      options = this.resolveExecutionOptions(plan, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        execution_verdict: 'failed',
        dry_run: false,
        applied: false,
        skipped: false,
        operations: [
          {
            tool: 'tool_plan',
            status: 'failed',
            message,
          },
        ],
        test_results: [],
        errors: [message],
        artifact_paths: [],
        test_failure_summaries: [],
      };
    }
    const operations: ToolPlanOperationResult[] = [];
    const testResults: TestResult[] = [];
    const errors: string[] = [];
    const writeArtifacts: WriteArtifact[] = [];
    const testFailureSummaries: string[] = [];

    if (!this.canWrite(job)) {
      return {
        execution_verdict: 'skipped',
        dry_run: options.dryRun,
        applied: false,
        skipped: true,
        operations: [
          {
            tool: 'tool_plan',
            status: 'skipped',
            message: 'tool_plan execution requires non-deny policy and workspace_write or full_auto sandbox',
          },
        ],
        test_results: [],
        errors: [],
        artifact_paths: [],
        test_failure_summaries: [],
      };
    }

    if (!workspaceRoot) {
      return {
        execution_verdict: 'skipped',
        dry_run: options.dryRun,
        applied: false,
        skipped: true,
        operations: [
          {
            tool: 'tool_plan',
            status: 'skipped',
            message: 'workspace root could not be resolved',
          },
        ],
        test_results: [],
        errors: [],
        artifact_paths: [],
        test_failure_summaries: [],
      };
    }

    const limitError = this.validatePlanLimits(plan, workspaceRoot, options);
    if (limitError) {
      return {
        execution_verdict: 'failed',
        dry_run: options.dryRun,
        applied: false,
        skipped: false,
        workspace_root: workspaceRoot,
        operations: [{ tool: 'tool_plan', status: 'failed', message: limitError }],
        test_results: [],
        errors: [limitError],
        artifact_paths: [],
        test_failure_summaries: [],
      };
    }

    for (const call of plan.calls) {
      if (call.tool === 'read_file') {
        operations.push(await this.readFile(call.args, workspaceRoot));
      } else if (call.tool === 'write_file') {
        const result = await this.writeFile(call.args, workspaceRoot, options, writeArtifacts);
        operations.push(result);
        if (result.status === 'failed') {
          errors.push(result.message ?? 'write_file failed');
        }
      } else if (call.tool === 'apply_patch_intent') {
        const result = await this.applyPatchIntent(call.args, workspaceRoot, options, writeArtifacts);
        operations.push(result);
        if (result.status === 'failed') {
          errors.push(result.message ?? 'apply_patch_intent failed');
        }
      } else if (call.tool === 'run_test_suite') {
        const result = await this.runTestSuite(call.args, workspaceRoot);
        operations.push(result.operation);
        testResults.push(result.testResult);
        if (result.operation.status === 'failed') {
          errors.push(result.operation.message ?? 'run_test_suite failed');
          if (result.failureSummary) {
            testFailureSummaries.push(result.failureSummary);
          }
        }
      } else if (call.tool === 'run_command') {
        const result = await this.runCommand(call.args, workspaceRoot);
        operations.push(result.operation);
        if (result.operation.status === 'failed') {
          errors.push(result.operation.message ?? 'run_command failed');
          if (result.failureSummary) {
            testFailureSummaries.push(result.failureSummary);
          }
        }
      } else {
        operations.push({
          tool: call.tool,
          status: 'skipped',
          message: `tool '${call.tool}' is validated but has no local executor`,
        });
      }
    }

    const applied = operations.some(
      operation =>
        operation.status === 'applied' &&
        ['write_file', 'apply_patch_intent', 'run_test_suite', 'run_command'].includes(operation.tool),
    );
    const executionVerdict = this.resolveExecutionVerdict({
      dryRun: options.dryRun,
      errors,
      applied,
      skipped: false,
    });
    const artifactPaths = options.dryRun
      ? []
      : await this.writeExecutionArtifacts(plan, job, workspaceRoot, operations, writeArtifacts, {
        executionVerdict,
        testResults,
        errors,
        testFailureSummaries,
      });

    return {
      execution_verdict: executionVerdict,
      dry_run: options.dryRun,
      applied,
      skipped: false,
      workspace_root: workspaceRoot,
      operations,
      test_results: testResults,
      errors,
      artifact_paths: artifactPaths,
      test_failure_summaries: testFailureSummaries,
    };
  }

  private canWrite(job: WorkerJob): boolean {
    const sandbox = job.approval_policy?.sandbox_profile;
    return job.approval_policy?.mode !== 'deny' && (sandbox === 'workspace_write' || sandbox === 'full_auto');
  }

  private resolveWorkspaceRoot(job: WorkerJob): string | undefined {
    if (job.workspace_ref?.kind === 'host_path' && path.isAbsolute(job.workspace_ref.workspace_id)) {
      return existsSync(job.workspace_ref.workspace_id) ? job.workspace_ref.workspace_id : undefined;
    }

    const repoName = job.repo_ref.name;
    if (!this.isSafeRepoDirectoryName(repoName)) {
      return undefined;
    }

    const cwd = process.cwd();
    if (path.basename(cwd) === repoName) {
      return cwd;
    }

    if (job.repo_ref.owner === 'local' || job.repo_ref.provider === 'github') {
      const candidates = [
        path.resolve(cwd, '..', repoName),
        path.resolve(cwd, '..', '..', repoName),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }

  private isSafeRepoDirectoryName(repoName: string): boolean {
    return (
      repoName.length > 0 &&
      repoName !== '.' &&
      repoName !== '..' &&
      path.basename(repoName) === repoName
    );
  }

  private resolveRepoPath(workspaceRoot: string, pathText: unknown): string {
    if (typeof pathText !== 'string' || pathText.length === 0) {
      throw new Error('path must be a non-empty string');
    }
    if (path.isAbsolute(pathText) || pathText.split(/[\\/]/).includes('..')) {
      throw new Error(`path must be repo-relative and stay within workspace: ${pathText}`);
    }
    const resolved = path.resolve(workspaceRoot, pathText);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`path escapes workspace: ${pathText}`);
    }
    return resolved;
  }

  private resolveExecutionOptions(plan: ToolPlanOutput, job: WorkerJob): ToolPlanExecutionOptions {
    const metadata = job.metadata ?? {};
    const dryRun = plan.dry_run === true || metadata.tool_plan_dry_run === true;
    const allowedPaths = this.normalizeAllowedPaths(plan.allowed_paths ?? this.parseAllowedPaths(metadata.tool_plan_allowed_paths));
    const maxFiles = this.parsePositiveInteger(plan.limits?.max_files ?? metadata.tool_plan_max_files, DEFAULT_MAX_FILES);
    const maxWriteBytesPerFile = this.parsePositiveInteger(
      plan.limits?.max_write_bytes_per_file ?? metadata.tool_plan_max_write_bytes_per_file,
      DEFAULT_MAX_WRITE_BYTES_PER_FILE,
    );

    return { dryRun, allowedPaths, maxFiles, maxWriteBytesPerFile };
  }

  private parseAllowedPaths(value: string | number | boolean | null | undefined): string[] | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          return parsed;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`allowed_paths must be valid JSON array syntax when it starts with '[': ${message}`, { cause: error });
      }
    }
    return trimmed.split(',').map(item => item.trim()).filter(Boolean);
  }

  private parsePositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }
    return fallback;
  }

  private normalizeAllowedPaths(paths: string[] | undefined): string[] | undefined {
    if (!paths || paths.length === 0) {
      return undefined;
    }
    return paths.map(pathText => {
      if (path.isAbsolute(pathText) || pathText.split(/[\\/]/).includes('..')) {
        throw new Error(`allowed_paths must be repo-relative path prefixes: ${pathText}`);
      }
      return pathText.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
    });
  }

  private validatePlanLimits(
    plan: ToolPlanOutput,
    workspaceRoot: string,
    options: ToolPlanExecutionOptions,
  ): string | undefined {
    const writeCalls = plan.calls.filter(call => call.tool === 'write_file' || call.tool === 'apply_patch_intent');
    const writePaths = new Set<string>();

    for (const call of writeCalls) {
      try {
        const resolved = this.resolveRepoPath(workspaceRoot, call.args.path);
        writePaths.add(path.relative(workspaceRoot, resolved).replace(/\\/g, '/'));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    if (writePaths.size > options.maxFiles) {
      return `tool_plan changes ${writePaths.size} files; limit is ${options.maxFiles}`;
    }

    return undefined;
  }

  private assertAllowedWritePath(workspaceRoot: string, resolved: string, options: ToolPlanExecutionOptions): void {
    if (!options.allowedPaths) {
      return;
    }
    const repoPath = path.relative(workspaceRoot, resolved).replace(/\\/g, '/');
    const allowed = options.allowedPaths.some(prefix => repoPath === prefix || repoPath.startsWith(`${prefix}/`));
    if (!allowed) {
      throw new Error(`path is outside allowed_paths: ${repoPath}`);
    }
  }

  private assertWriteSize(content: string, options: ToolPlanExecutionOptions): void {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > options.maxWriteBytesPerFile) {
      throw new Error(`write size ${bytes} bytes exceeds limit ${options.maxWriteBytesPerFile}`);
    }
  }

  private async readFile(args: Record<string, unknown>, workspaceRoot: string): Promise<ToolPlanOperationResult> {
    try {
      const resolved = this.resolveRepoPath(workspaceRoot, args.path);
      await readFile(resolved, 'utf8');
      return { tool: 'read_file', status: 'applied', path: path.relative(workspaceRoot, resolved) };
    } catch (error) {
      return {
        tool: 'read_file',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async writeFile(
    args: Record<string, unknown>,
    workspaceRoot: string,
    options: ToolPlanExecutionOptions,
    writeArtifacts: WriteArtifact[],
  ): Promise<ToolPlanOperationResult> {
    try {
      if (typeof args.content !== 'string') {
        throw new Error('content must be a string');
      }
      const resolved = this.resolveRepoPath(workspaceRoot, args.path);
      this.assertAllowedWritePath(workspaceRoot, resolved, options);
      this.assertWriteSize(args.content, options);
      const before = existsSync(resolved) ? await readFile(resolved, 'utf8') : null;
      if (options.dryRun) {
        return { tool: 'write_file', status: 'planned', path: path.relative(workspaceRoot, resolved) };
      }
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, args.content, 'utf8');
      writeArtifacts.push({ path: path.relative(workspaceRoot, resolved).replace(/\\/g, '/'), before, after: args.content });
      return { tool: 'write_file', status: 'applied', path: path.relative(workspaceRoot, resolved) };
    } catch (error) {
      return {
        tool: 'write_file',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async applyPatchIntent(
    args: Record<string, unknown>,
    workspaceRoot: string,
    options: ToolPlanExecutionOptions,
    writeArtifacts: WriteArtifact[],
  ): Promise<ToolPlanOperationResult> {
    try {
      if (typeof args.locator !== 'string' || typeof args.replacement !== 'string') {
        throw new Error('locator and replacement must be strings');
      }
      const resolved = this.resolveRepoPath(workspaceRoot, args.path);
      this.assertAllowedWritePath(workspaceRoot, resolved, options);
      const original = await readFile(resolved, 'utf8');
      const firstMatch = original.indexOf(args.locator);
      const lastMatch = original.lastIndexOf(args.locator);
      if (firstMatch === -1 || firstMatch !== lastMatch) {
        throw new Error('locator was not found exactly once in target file');
      }
      const updated = original.replace(args.locator, args.replacement);
      this.assertWriteSize(updated, options);
      if (options.dryRun) {
        return { tool: 'apply_patch_intent', status: 'planned', path: path.relative(workspaceRoot, resolved) };
      }
      await writeFile(resolved, updated, 'utf8');
      writeArtifacts.push({ path: path.relative(workspaceRoot, resolved).replace(/\\/g, '/'), before: original, after: updated });
      return { tool: 'apply_patch_intent', status: 'applied', path: path.relative(workspaceRoot, resolved) };
    } catch (error) {
      return {
        tool: 'apply_patch_intent',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runTestSuite(
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<{ operation: ToolPlanOperationResult; testResult: TestResult; failureSummary?: string }> {
    const suite = typeof args.suite === 'string' ? args.suite : 'unit';
    const startedAt = Date.now();
    const command = this.resolveTestCommand(workspaceRoot);

    if (!command) {
      return {
        operation: {
          tool: 'run_test_suite',
          status: 'skipped',
          message: 'no supported test command found',
        },
        testResult: { suite, status: 'skipped', duration_ms: Date.now() - startedAt },
      };
    }

    try {
      await execFileAsync(command.bin, command.args, {
        cwd: workspaceRoot,
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
      });
      return {
        operation: {
          tool: 'run_test_suite',
          status: 'applied',
          message: `${command.bin} ${command.args.join(' ')}`.trim(),
        },
        testResult: { suite, status: 'passed', duration_ms: Date.now() - startedAt },
      };
    } catch (error) {
      const failureSummary = this.summarizeTestFailure(error);
      return {
        operation: {
          tool: 'run_test_suite',
          status: 'failed',
          message: failureSummary,
        },
        testResult: { suite, status: 'failed', duration_ms: Date.now() - startedAt },
        failureSummary,
      };
    }
  }

  private async runCommand(
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<{ operation: ToolPlanOperationResult; failureSummary?: string }> {
    const commandText = typeof args.command === 'string' ? args.command.trim() : '';
    const startedAt = Date.now();

    try {
      const command = this.resolveSafeCommand(commandText, args, workspaceRoot);
      const { stdout, stderr } = await execFileAsync(command.bin, command.args, {
        cwd: command.cwd,
        timeout: command.timeoutMs,
        maxBuffer: Math.max(command.maxOutputChars * 2, 1024 * 1024),
      });
      const output = this.truncateCommandOutput([stdout, stderr].filter(Boolean).join('\n'), command.maxOutputChars);
      const elapsed = Date.now() - startedAt;
      return {
        operation: {
          tool: 'run_command',
          status: 'applied',
          message: [`${command.rendered} passed in ${elapsed}ms`, output].filter(Boolean).join('\n'),
        },
      };
    } catch (error) {
      const failureSummary = this.summarizeTestFailure(error);
      return {
        operation: {
          tool: 'run_command',
          status: 'failed',
          message: failureSummary,
        },
        failureSummary,
      };
    }
  }

  private resolveSafeCommand(commandText: string, args: Record<string, unknown>, workspaceRoot: string): SafeCommandSpec {
    if (!commandText) {
      throw new Error('command must be a non-empty string');
    }
    const parsed = this.extractCommandAndCwd(commandText, args.cwd, workspaceRoot);
    const executableCommand = parsed.command;
    if (/[;&|<>`$]/.test(executableCommand)) {
      throw new Error(`command contains unsupported shell metacharacters: ${commandText}`);
    }
    if (/[ \t]{2,}/.test(executableCommand)) {
      throw new Error(`command must use single spaces between arguments: ${commandText}`);
    }

    const parts = executableCommand.split(' ');
    if (parts.some(part => part.length === 0 || part.includes('"') || part.includes("'"))) {
      throw new Error(`command must be unquoted simple tokens: ${commandText}`);
    }

    const timeoutMs = this.parseBoundedInteger(args.timeout_ms, DEFAULT_COMMAND_TIMEOUT_MS, 1000, 600000);
    const maxOutputChars = this.parseBoundedInteger(
      args.max_output_chars,
      DEFAULT_COMMAND_MAX_OUTPUT_CHARS,
      1000,
      200000,
    );

    const allowedPrefixes = [
      ['uv', 'run', 'python', 'tools/round_robin.py'],
      ['uv', 'run', 'python', 'tools/run_match.py'],
      ['uv', 'run', 'pytest'],
      ['uv', 'run', 'ruff', 'check'],
      ['uv', 'run', 'python', '-m', 'compileall'],
      ['git', 'diff', '--check'],
      ['git', 'diff', '--stat'],
      ['git', 'status', '--short'],
      ['npm', '--version'],
      ['node', '--version'],
    ];

    const matches = allowedPrefixes.some(prefix =>
      parts.length >= prefix.length && prefix.every((token, index) => parts[index] === token),
    );
    if (!matches) {
      throw new Error(`command is not in the safe allowlist: ${commandText}`);
    }

    const bin = this.normalizeCommandBin(parts[0]);
    return { bin, args: parts.slice(1), rendered: commandText, cwd: parsed.cwd, timeoutMs, maxOutputChars };
  }

  private extractCommandAndCwd(
    commandText: string,
    cwdArg: unknown,
    workspaceRoot: string,
  ): { command: string; cwd: string } {
    let command = commandText;
    let cwd = this.resolveCommandCwd(cwdArg, workspaceRoot);
    const cdMatch = commandText.match(/^cd\s+(.+?)\s+&&\s+(.+)$/);
    if (cdMatch) {
      cwd = this.resolveCommandCwd(cdMatch[1], workspaceRoot);
      command = cdMatch[2].trim();
    }
    return { command, cwd };
  }

  private resolveCommandCwd(cwdArg: unknown, workspaceRoot: string): string {
    if (cwdArg === undefined || cwdArg === null || cwdArg === '') {
      return workspaceRoot;
    }
    if (typeof cwdArg !== 'string') {
      throw new Error('cwd must be a string when provided');
    }
    if (cwdArg.includes('"') || cwdArg.includes("'") || /[;&|<>`$]/.test(cwdArg)) {
      throw new Error(`cwd contains unsupported shell syntax: ${cwdArg}`);
    }
    if (cwdArg.split(/[\\/]/).includes('..')) {
      throw new Error(`cwd must stay within workspace: ${cwdArg}`);
    }
    const resolved = path.isAbsolute(cwdArg)
      ? path.resolve(cwdArg)
      : path.resolve(workspaceRoot, cwdArg);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`cwd escapes workspace: ${cwdArg}`);
    }
    if (!existsSync(resolved)) {
      throw new Error(`cwd does not exist: ${cwdArg}`);
    }
    return resolved;
  }

  private normalizeCommandBin(bin: string): string {
    if (process.platform !== 'win32') {
      return bin;
    }
    if (bin === 'npm') {
      return 'npm.cmd';
    }
    if (bin === 'npx') {
      return 'npx.cmd';
    }
    return bin;
  }

  private parseBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' && Number.isInteger(value)
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private truncateCommandOutput(output: string, maxChars: number): string {
    if (output.length <= maxChars) {
      return output;
    }
    return `${output.slice(0, maxChars)}\n... truncated ${output.length - maxChars} chars`;
  }

  private summarizeTestFailure(error: unknown): string {
    const fallback = error instanceof Error ? error.message : String(error);
    const output = [
      this.readStringProperty(error, 'stdout'),
      this.readStringProperty(error, 'stderr'),
      fallback,
    ].filter(Boolean).join('\n');
    const lines = output.split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(line => line.length > 0);
    const interesting = lines.filter(line =>
      /fail|error|expected|received|assert|trace|not ok|✖|×|ERR!/i.test(line),
    );
    return (interesting.length > 0 ? interesting : lines).slice(0, 12).join('\n').slice(0, 2000) || fallback;
  }

  private readStringProperty(value: unknown, property: string): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const propertyValue = (value as Record<string, unknown>)[property];
    return typeof propertyValue === 'string' ? propertyValue : undefined;
  }

  private async writeExecutionArtifacts(
    plan: ToolPlanOutput,
    job: WorkerJob,
    workspaceRoot: string,
    operations: ToolPlanOperationResult[],
    writes: WriteArtifact[],
    result: {
      executionVerdict: ToolPlanExecutionVerdict;
      testResults: TestResult[];
      errors: string[];
      testFailureSummaries: string[];
    },
  ): Promise<string[]> {
    const artifactDir = path.join(workspaceRoot, 'artifacts', 'jobs', job.job_id);
    await mkdir(artifactDir, { recursive: true });

    const planPath = path.join(artifactDir, 'tool-plan.json');
    await writeFile(planPath, `${JSON.stringify({ plan, operations }, null, 2)}\n`, 'utf8');

    const verdictPath = path.join(artifactDir, 'execution-verdict.json');
    await writeFile(verdictPath, `${JSON.stringify({
      execution_verdict: result.executionVerdict,
      errors: result.errors,
      operations,
    }, null, 2)}\n`, 'utf8');

    const diffStatPath = path.join(artifactDir, 'diff-stat.txt');
    await writeFile(diffStatPath, this.renderDiffStatArtifact(writes), 'utf8');

    const diffPath = path.join(artifactDir, 'diff.patch');
    await writeFile(diffPath, this.renderDiffArtifact(writes), 'utf8');

    const testSummaryPath = path.join(artifactDir, 'test-summary.json');
    await writeFile(testSummaryPath, `${JSON.stringify({
      test_results: result.testResults,
      test_failure_summaries: result.testFailureSummaries,
    }, null, 2)}\n`, 'utf8');

    const artifactPaths = [planPath, verdictPath, diffStatPath, diffPath, testSummaryPath]
      .map(artifactPath => path.relative(workspaceRoot, artifactPath).replace(/\\/g, '/'));
    return artifactPaths;
  }

  private renderDiffStatArtifact(writes: WriteArtifact[]): string {
    if (writes.length === 0) {
      return 'No workspace file writes were applied by tool_plan.\n';
    }
    const lines = writes.map(write => {
      const beforeBytes = Buffer.byteLength(write.before ?? '', 'utf8');
      const afterBytes = Buffer.byteLength(write.after, 'utf8');
      const delta = afterBytes - beforeBytes;
      const sign = delta >= 0 ? '+' : '';
      return `${write.path} | ${sign}${delta} bytes`;
    });
    return [...lines, `${writes.length} file(s) changed`].join('\n') + '\n';
  }

  private renderDiffArtifact(writes: WriteArtifact[]): string {
    if (writes.length === 0) {
      return '# No workspace file writes were applied by tool_plan.\n';
    }
    return writes.map(write => {
      const before = write.before ?? '';
      return [
        `diff --shipyard a/${write.path} b/${write.path}`,
        `--- a/${write.path}`,
        `+++ b/${write.path}`,
        '@@',
        ...before.split(/\r?\n/).filter((line, index, array) => index < array.length - 1 || line !== '').map(line => `-${line}`),
        ...write.after.split(/\r?\n/).filter((line, index, array) => index < array.length - 1 || line !== '').map(line => `+${line}`),
        '',
      ].join('\n');
    }).join('\n');
  }

  private resolveExecutionVerdict(input: {
    dryRun: boolean;
    errors: string[];
    applied: boolean;
    skipped: boolean;
  }): ToolPlanExecutionVerdict {
    if (input.dryRun) {
      return 'dry_run';
    }
    if (input.skipped) {
      return 'skipped';
    }
    if (input.errors.length > 0) {
      return 'failed';
    }
    if (input.applied) {
      return 'applied';
    }
    return 'executed';
  }

  private resolveTestCommand(workspaceRoot: string): { bin: string; args: string[] } | undefined {
    if (existsSync(path.join(workspaceRoot, 'pyproject.toml'))) {
      return { bin: 'uv', args: ['run', 'pytest'] };
    }
    if (existsSync(path.join(workspaceRoot, 'package.json'))) {
      return { bin: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] };
    }
    return undefined;
  }
}

export function createToolPlanExecutor(): ToolPlanExecutor {
  return new ToolPlanExecutor();
}
