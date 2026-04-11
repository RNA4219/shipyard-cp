/**
 * OpenCode CLI Executor
 *
 * Executes OpenCode CLI commands and manages per-job workspaces.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { WorkerJob } from '../types.js';
import { getLogger } from '../monitoring/index.js';

export interface OpenCodeExecutorConfig {
  /** OpenCode CLI path */
  cliPath?: string;
  /** Base directory for managed workspaces */
  workDir?: string;
  /** Optional model name exposed to OpenCode providers */
  model?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Keep artifacts and emit verbose logs */
  debug?: boolean;
}

interface RunningJob {
  process: ChildProcess;
  job: WorkerJob;
  workPath: string;
  startedAt: number;
  stdout: string[];
  stderr: string[];
  timeoutHandle?: NodeJS.Timeout;
  completed: boolean;
}

export interface OpenCodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts?: Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'json' | 'other';
    uri: string;
  }>;
  duration_ms: number;
  exit_code?: number;
}

export class OpenCodeExecutor {
  private readonly logger = getLogger().child({ component: 'OpenCodeExecutor' });
  private readonly runningJobs = new Map<string, RunningJob>();
  private readonly config: Required<OpenCodeExecutorConfig>;

  constructor(config: OpenCodeExecutorConfig = {}) {
    this.config = {
      cliPath: config.cliPath || 'opencode',
      workDir: config.workDir || '/tmp/shipyard-jobs',
      model: config.model || '',
      timeout: config.timeout || 600000,
      debug: config.debug || false,
    };

    void this.ensureWorkDir();
  }

  async execute(job: WorkerJob): Promise<OpenCodeExecutionResult> {
    const workPath = this.resolveWorkPath(job);

    try {
      await mkdir(workPath, { recursive: true });

      const prompt = job.input_prompt || this.buildPrompt(job);
      const promptFile = path.join(workPath, 'prompt.md');
      const configFile = path.join(workPath, 'opencode.json');

      await writeFile(promptFile, prompt, 'utf8');
      await writeFile(configFile, JSON.stringify(this.buildProjectConfig(job), null, 2), 'utf8');

      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }

      if (this.config.model) {
        env.OPENCODE_MODEL = this.config.model;
      }

      const startedAt = Date.now();
      const result = await this.runCli(workPath, ['run', prompt], env, job);
      const duration = Date.now() - startedAt;
      const artifacts = await this.collectArtifacts(workPath, job.job_id);

      if (!this.config.debug && job.workspace_ref.kind !== 'host_path') {
        await this.cleanup(workPath);
      }

      return {
        ...result,
        artifacts,
        duration_ms: duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('OpenCode execution failed', { jobId: job.job_id, error: message });
      return {
        success: false,
        error: message,
        duration_ms: 0,
      };
    }
  }

  async cancel(jobId: string): Promise<boolean> {
    const running = this.runningJobs.get(jobId);
    if (!running) {
      return false;
    }

    if (running.timeoutHandle) {
      clearTimeout(running.timeoutHandle);
    }

    running.completed = true;
    running.process.kill('SIGTERM');
    this.runningJobs.delete(jobId);
    return true;
  }

  private async ensureWorkDir(): Promise<void> {
    if (!existsSync(this.config.workDir)) {
      await mkdir(this.config.workDir, { recursive: true });
    }
  }

  private resolveWorkPath(job: WorkerJob): string {
    if (job.workspace_ref.kind === 'host_path' && path.isAbsolute(job.workspace_ref.workspace_id)) {
      return job.workspace_ref.workspace_id;
    }

    return path.join(this.config.workDir, job.job_id);
  }

  private buildProjectConfig(job: WorkerJob): Record<string, unknown> {
    const permissions = this.buildPermissions(job);
    return {
      $schema: 'https://opencode.ai/config.json',
      permission: permissions,
    };
  }

  private buildPermissions(job: WorkerJob): Record<string, unknown> {
    const allowNetwork = job.approval_policy.allowed_side_effect_categories?.includes('network_access') ?? false;

    if (job.stage === 'plan') {
      return {
        edit: 'deny',
        bash: 'deny',
        webfetch: 'deny',
      };
    }

    if (job.stage === 'acceptance') {
      return {
        edit: 'deny',
        bash: 'allow',
        webfetch: allowNetwork ? 'allow' : 'deny',
      };
    }

    return {
      edit: 'allow',
      bash: 'allow',
      webfetch: allowNetwork ? 'allow' : 'deny',
    };
  }

  private runCli(
    workPath: string,
    args: string[],
    env: Record<string, string>,
    job: WorkerJob,
  ): Promise<OpenCodeExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc = spawn(this.config.cliPath, args, {
        cwd: workPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const running: RunningJob = {
        process: proc,
        job,
        workPath,
        startedAt: Date.now(),
        stdout,
        stderr,
        completed: false,
      };

      this.runningJobs.set(job.job_id, running);

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout.push(text);
        if (this.config.debug) {
          this.logger.debug('OpenCode stdout', { jobId: job.job_id, data: text });
        }
      });

      proc.stderr?.on('data', (data) => {
        const text = data.toString();
        stderr.push(text);
        if (this.config.debug) {
          this.logger.debug('OpenCode stderr', { jobId: job.job_id, data: text });
        }
      });

      const timeoutHandle = setTimeout(() => {
        if (!running.completed) {
          proc.kill('SIGKILL');
          running.completed = true;
          resolve({
            success: false,
            error: `Job timed out after ${this.config.timeout}ms`,
            duration_ms: Date.now() - running.startedAt,
          });
        }
      }, this.config.timeout);

      running.timeoutHandle = timeoutHandle;

      proc.on('close', async (code) => {
        running.completed = true;
        clearTimeout(timeoutHandle);
        this.runningJobs.delete(job.job_id);

        const stdoutText = stdout.join('');
        const stderrText = stderr.join('');

        await writeFile(path.join(workPath, 'stdout.log'), stdoutText, 'utf8');
        await writeFile(path.join(workPath, 'stderr.log'), stderrText, 'utf8');

        resolve({
          success: code === 0,
          output: stdoutText,
          error: code === 0 ? undefined : (stderrText || stdoutText || `OpenCode exited with code ${code ?? 'unknown'}`),
          duration_ms: Date.now() - running.startedAt,
          exit_code: code === null ? undefined : code,
        });
      });

      proc.on('error', (error) => {
        running.completed = true;
        clearTimeout(timeoutHandle);
        this.runningJobs.delete(job.job_id);
        reject(error);
      });
    });
  }

  private async collectArtifacts(workPath: string, jobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'json' | 'other';
    uri: string;
  }>> {
    const artifacts: Array<{
      artifact_id: string;
      kind: 'log' | 'report' | 'json' | 'other';
      uri: string;
    }> = [];

    const candidates: Array<{ file: string; kind: 'log' | 'report' | 'json' | 'other' }> = [
      { file: 'stdout.log', kind: 'log' },
      { file: 'stderr.log', kind: 'log' },
      { file: 'prompt.md', kind: 'report' },
      { file: 'opencode.json', kind: 'json' },
    ];

    for (const candidate of candidates) {
      const absolute = path.join(workPath, candidate.file);
      if (existsSync(absolute)) {
        artifacts.push({
          artifact_id: `${jobId}-${candidate.file.replace(/[^a-zA-Z0-9]+/g, '-')}`,
          kind: candidate.kind,
          uri: absolute,
        });
      }
    }

    return artifacts;
  }

  private async cleanup(workPath: string): Promise<void> {
    if (existsSync(workPath)) {
      await rm(workPath, { recursive: true, force: true });
    }
  }

  private buildPrompt(job: WorkerJob): string {
    const lines: string[] = [];

    lines.push(`Task ID: ${job.task_id}`);
    lines.push(`Stage: ${job.stage}`);
    lines.push('');
    lines.push(job.input_prompt);

    return lines.join('\n');
  }

  async readArtifact(uri: string): Promise<string | null> {
    if (!path.isAbsolute(uri) || !existsSync(uri)) {
      return null;
    }

    return readFile(uri, 'utf8');
  }
}

export function createOpenCodeExecutor(config?: OpenCodeExecutorConfig): OpenCodeExecutor {
  return new OpenCodeExecutor(config);
}
