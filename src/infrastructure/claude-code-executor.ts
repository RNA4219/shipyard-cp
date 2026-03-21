/**
 * Claude Code CLI Executor
 *
 * Executes Claude Code CLI commands and manages job lifecycle.
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { WorkerJob } from '../types.js';
import { getLogger } from '../monitoring/index.js';

/**
 * Executor configuration
 */
export interface ClaudeCodeExecutorConfig {
  /** Claude Code CLI path (default: 'claude') */
  cliPath?: string;
  /** Working directory for jobs */
  workDir?: string;
  /** Model to use */
  model?: string;
  /** API key (optional, uses ANTHROPIC_API_KEY env if not set) */
  apiKey?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Use --dangerously-skip-permissions flag */
  skipPermissions?: boolean;
}

/**
 * Running job info
 */
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

/**
 * Job execution result
 */
export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts?: Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
    uri: string;
  }>;
  duration_ms: number;
}

/**
 * Claude Code CLI Executor
 *
 * Manages subprocess-based execution of Claude Code CLI.
 */
export class ClaudeCodeExecutor {
  private config: Required<Omit<ClaudeCodeExecutorConfig, 'apiKey'>> & { apiKey?: string };
  private runningJobs: Map<string, RunningJob> = new Map();
  private logger = getLogger().child({ component: 'ClaudeCodeExecutor' });

  constructor(config: ClaudeCodeExecutorConfig = {}) {
    this.config = {
      cliPath: config.cliPath || 'claude',
      workDir: config.workDir || '/tmp/shipyard-jobs',
      model: config.model || 'claude-sonnet-4-6',
      apiKey: config.apiKey,
      timeout: config.timeout || 600000, // 10 minutes default
      debug: config.debug || false,
      skipPermissions: config.skipPermissions || false,
    };

    // Ensure work directory exists
    this.ensureWorkDir();
  }

  private async ensureWorkDir(): Promise<void> {
    if (!existsSync(this.config.workDir)) {
      await mkdir(this.config.workDir, { recursive: true });
    }
  }

  /**
   * Execute a job using Claude Code CLI
   */
  async execute(job: WorkerJob): Promise<ExecutionResult> {
    const jobId = job.job_id;
    const workPath = path.join(this.config.workDir, jobId);

    try {
      // Create job workspace
      await mkdir(workPath, { recursive: true });

      // Write prompt to file
      const promptFile = path.join(workPath, 'prompt.md');
      await writeFile(promptFile, job.input_prompt || this.buildPrompt(job));

      // Prepare environment
      const env: Record<string, string> = {};

      // Copy existing env
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }

      if (this.config.apiKey) {
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      }

      // Build CLI arguments
      const args = this.buildCliArgs(job, promptFile);

      this.logger.info('Starting Claude Code execution', {
        jobId,
        stage: job.stage,
        model: this.config.model,
      });

      const startTime = Date.now();

      // Execute CLI
      const result = await this.runCli(workPath, args, env, job);

      const duration = Date.now() - startTime;

      // Collect artifacts
      const artifacts = await this.collectArtifacts(workPath, jobId);

      // Cleanup
      if (!this.config.debug) {
        await this.cleanup(workPath);
      }

      this.logger.info('Claude Code execution completed', {
        jobId,
        success: result.success,
        duration_ms: duration,
      });

      return {
        ...result,
        artifacts,
        duration_ms: duration,
      };
    } catch (error) {
      const duration = Date.now() - (this.runningJobs.get(jobId)?.startedAt || Date.now());

      this.logger.error('Claude Code execution failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: duration,
      });

      // Cleanup on error
      try {
        await this.cleanup(workPath);
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: duration,
      };
    }
  }

  /**
   * Cancel a running job
   */
  async cancel(jobId: string): Promise<boolean> {
    const running = this.runningJobs.get(jobId);
    if (!running) {
      return false;
    }

    this.logger.info('Cancelling job', { jobId });

    // Clear timeout
    if (running.timeoutHandle) {
      clearTimeout(running.timeoutHandle);
    }

    // Kill process
    running.process.kill('SIGTERM');
    running.completed = true;

    // Cleanup
    try {
      await this.cleanup(running.workPath);
    } catch {
      // Ignore cleanup errors
    }

    this.runningJobs.delete(jobId);
    return true;
  }

  /**
   * Build CLI arguments
   */
  private buildCliArgs(job: WorkerJob, promptFile: string): string[] {
    const args: string[] = [];

    // Model selection
    args.push('--model', this.config.model);

    // Skip permissions if configured
    if (this.config.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Output format
    args.push('--output-format', 'json');

    // Prompt file
    args.push('--prompt', promptFile);

    // Stage-specific instructions
    if (job.stage === 'plan') {
      args.push('--system-prompt', this.getPlanSystemPrompt());
    } else if (job.stage === 'dev') {
      args.push('--system-prompt', this.getDevSystemPrompt());
    } else if (job.stage === 'acceptance') {
      args.push('--system-prompt', this.getAcceptanceSystemPrompt());
    }

    return args;
  }

  /**
   * Run CLI process
   */
  private runCli(
    workPath: string,
    args: string[],
    env: Record<string, string>,
    job: WorkerJob
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc = spawn(this.config.cliPath, args, {
        cwd: workPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const jobInfo: RunningJob = {
        process: proc,
        job,
        workPath,
        startedAt: Date.now(),
        stdout,
        stderr,
        completed: false,
      };

      this.runningJobs.set(job.job_id, jobInfo);

      // Collect stdout
      proc.stdout?.on('data', (data) => {
        stdout.push(data.toString());
        if (this.config.debug) {
          this.logger.debug('CLI stdout', { jobId: job.job_id, data: data.toString() });
        }
      });

      // Collect stderr
      proc.stderr?.on('data', (data) => {
        stderr.push(data.toString());
        if (this.config.debug) {
          this.logger.debug('CLI stderr', { jobId: job.job_id, data: data.toString() });
        }
      });

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        if (!jobInfo.completed) {
          this.logger.warn('Job timeout, killing process', { jobId: job.job_id });
          proc.kill('SIGKILL');
          jobInfo.completed = true;
          resolve({
            success: false,
            error: `Job timed out after ${this.config.timeout}ms`,
            duration_ms: Date.now() - jobInfo.startedAt,
          });
        }
      }, this.config.timeout);

      jobInfo.timeoutHandle = timeoutHandle;

      // Handle completion
      proc.on('close', (code) => {
        jobInfo.completed = true;
        clearTimeout(timeoutHandle);
        this.runningJobs.delete(job.job_id);

        const output = stdout.join('');
        const error = stderr.join('');

        if (code === 0) {
          resolve({
            success: true,
            output,
            duration_ms: Date.now() - jobInfo.startedAt,
          });
        } else {
          resolve({
            success: false,
            output,
            error: error || `Process exited with code ${code}`,
            duration_ms: Date.now() - jobInfo.startedAt,
          });
        }
      });

      // Handle errors
      proc.on('error', (err) => {
        jobInfo.completed = true;
        clearTimeout(timeoutHandle);
        this.runningJobs.delete(job.job_id);
        reject(err);
      });
    });
  }

  /**
   * Collect artifacts from job workspace
   */
  private async collectArtifacts(workPath: string, jobId: string): Promise<ExecutionResult['artifacts']> {
    const artifacts: ExecutionResult['artifacts'] = [];

    // Add log artifact
    const logFile = path.join(workPath, 'claude.log');
    if (existsSync(logFile)) {
      artifacts.push({
        artifact_id: `${jobId}-log`,
        kind: 'log',
        uri: `file://${logFile}`,
      });
    }

    // Add session artifact
    const sessionFile = path.join(workPath, 'session.json');
    if (existsSync(sessionFile)) {
      artifacts.push({
        artifact_id: `${jobId}-session`,
        kind: 'json',
        uri: `file://${sessionFile}`,
      });
    }

    return artifacts;
  }

  /**
   * Cleanup job workspace
   */
  private async cleanup(workPath: string): Promise<void> {
    if (existsSync(workPath)) {
      await rm(workPath, { recursive: true, force: true });
    }
  }

  /**
   * Build prompt from job
   */
  private buildPrompt(job: WorkerJob): string {
    const lines: string[] = [];

    lines.push(`# Task: ${job.task_id}`);
    lines.push(`## Stage: ${job.stage}`);
    lines.push('');

    if (job.context?.objective) {
      lines.push(`### Objective`);
      lines.push(job.context.objective);
      lines.push('');
    }

    // Add repo info
    lines.push(`### Repository`);
    lines.push(`- Provider: ${job.repo_ref.provider}`);
    lines.push(`- Owner: ${job.repo_ref.owner}`);
    lines.push(`- Name: ${job.repo_ref.name}`);
    lines.push(`- Default Branch: ${job.repo_ref.default_branch}`);
    if (job.repo_ref.base_sha) {
      lines.push(`- Base SHA: ${job.repo_ref.base_sha}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * System prompts for different stages
   */
  private getPlanSystemPrompt(): string {
    return `You are a planning agent. Your job is to analyze the task and create a detailed implementation plan.
Output a structured plan in JSON format with the following structure:
{
  "plan": {
    "summary": "Brief summary of the approach",
    "steps": [
      { "description": "Step description", "files_to_modify": ["file1.ts"], "estimated_complexity": "low|medium|high" }
    ],
    "risks": ["potential risk 1"],
    "dependencies": ["external dependency 1"]
  }
}`;
  }

  private getDevSystemPrompt(): string {
    return `You are a development agent. Your job is to implement the planned changes.
Focus on writing clean, well-tested code that follows the project's conventions.
Output your changes as a unified diff format.`;
  }

  private getAcceptanceSystemPrompt(): string {
    return `You are an acceptance testing agent. Your job is to verify that the implementation meets the requirements.
Run tests and verify that all acceptance criteria are met.
Output a verdict in JSON format:
{
  "verdict": {
    "outcome": "accept|reject|rework",
    "reason": "Explanation of the verdict",
    "test_results": { "passed": 10, "failed": 0 },
    "checklist": [{ "item": "description", "passed": true }]
  }
}`;
  }
}

/**
 * Create default executor instance
 */
export function createClaudeCodeExecutor(config?: ClaudeCodeExecutorConfig): ClaudeCodeExecutor {
  return new ClaudeCodeExecutor(config);
}