import {
  BaseWorkerAdapter,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
  type WorkerJob,
} from './worker-adapter.js';
import type { WorkerResult } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';
import { getConfig } from '../../config/index.js';
import {
  ClaudeCodeExecutor,
  createClaudeCodeExecutor,
  type ExecutionResult,
} from '../../infrastructure/claude-code-executor.js';

/**
 * Production Claude Code adapter configuration
 * Extends base config with production-specific options
 */
export interface ProductionClaudeCodeAdapterConfig extends WorkerAdapterConfig {
  workerType: 'claude_code';
  /** Claude Code CLI path */
  cliPath?: string;
  /** Working directory for jobs */
  workDir?: string;
  /** Claude model to use */
  model?: string;
  /** API key (uses config or ANTHROPIC_API_KEY env if not set) */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Enable debug mode */
  debug?: boolean;
  /** Skip permission prompts */
  skipPermissions?: boolean;
}

/**
 * Job execution state
 */
interface JobState {
  job: WorkerJob;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: WorkerResult;
  error?: string;
  startedAt: number;
  executionPromise?: Promise<ExecutionResult>;
}

/**
 * Production Claude Code Worker Adapter
 *
 * Implements WorkerAdapter using actual Claude Code CLI execution.
 * Uses configuration from environment variables.
 */
export class ProductionClaudeCodeAdapter extends BaseWorkerAdapter {
  readonly workerType = 'claude_code' as const;
  private executor: ClaudeCodeExecutor;
  private model: string;
  private jobStates: Map<string, JobState> = new Map();
  private logger = getLogger().child({ component: 'ProductionClaudeCodeAdapter' });

  constructor(config: ProductionClaudeCodeAdapterConfig = { workerType: 'claude_code' }) {
    super(config);

    // Get global config for defaults
    const globalConfig = getConfig();

    this.model = config.model || globalConfig.worker.claudeModel;

    // Resolve API key: explicit config > global config > env var
    const apiKey = config.apiKey || config.auth?.value || globalConfig.apiKeys.anthropicApiKey;

    this.executor = createClaudeCodeExecutor({
      cliPath: config.cliPath || globalConfig.worker.claudeCliPath,
      workDir: config.workDir || globalConfig.worker.workDir,
      model: this.model,
      apiKey,
      timeout: config.timeout || globalConfig.worker.jobTimeout,
      debug: config.debug ?? globalConfig.worker.debugMode,
      skipPermissions: config.skipPermissions ?? globalConfig.worker.skipPermissions,
    });

    this.logger.info('ProductionClaudeCodeAdapter created', {
      model: this.model,
      cliPath: config.cliPath || globalConfig.worker.claudeCliPath,
      hasApiKey: !!apiKey,
    });
  }

  async initialize(): Promise<void> {
    // Verify CLI is available
    try {
      const { spawn } = await import('child_process');
      const proc = spawn('claude', ['--version'], { stdio: 'ignore' });

      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            this.logger.warn('Claude CLI version check returned non-zero, may not be installed');
            resolve(); // Don't fail init, just warn
          }
        });
        proc.on('error', () => {
          this.logger.warn('Claude CLI not found, jobs may fail');
          resolve(); // Don't fail init, just warn
        });
      });
    } catch {
      this.logger.warn('Could not verify Claude CLI installation');
    }

    await super.initialize();
    this.logger.info('ProductionClaudeCodeAdapter initialized', { model: this.model });
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: 'claude_code',
      capabilities: [
        'plan',
        'edit_repo',
        'run_tests',
        'needs_approval',
        'produces_patch',
        'produces_verdict',
      ],
      max_concurrent_jobs: 5,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '2.0.0', // Production version
      metadata: {
        model: this.model,
        supports_mcp: true,
        supports_tools: true,
        production_mode: true,
      },
    };
  }

  async submitJob(job: WorkerJob): Promise<JobSubmissionResult> {
    const validation = this.validateJob(job);
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        error: validation.errors.join(', '),
      };
    }

    try {
      const externalJobId = `claude-${job.job_id}-${Date.now()}`;

      // Initialize job state
      const jobState: JobState = {
        job,
        status: 'queued',
        startedAt: Date.now(),
      };

      this.jobStates.set(externalJobId, jobState);

      // Start execution in background
      jobState.executionPromise = this.executor.execute(job);
      jobState.status = 'running';

      // Handle execution completion
      jobState.executionPromise.then((result) => {
        jobState.status = result.success ? 'succeeded' : 'failed';
        if (result.success) {
          jobState.result = this.convertToWorkerResult(job, result);
        } else {
          jobState.error = result.error;
        }
      }).catch((error) => {
        jobState.status = 'failed';
        jobState.error = error instanceof Error ? error.message : String(error);
      });

      this.logger.info('Job submitted for execution', {
        externalJobId,
        taskId: job.task_id,
        stage: job.stage,
      });

      return {
        success: true,
        external_job_id: externalJobId,
        status: 'queued',
        estimated_duration_ms: this.estimateDuration(job.stage),
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    const jobState = this.jobStates.get(externalJobId);

    if (!jobState) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    const elapsed = Date.now() - jobState.startedAt;
    const estimated = this.estimateDuration(jobState.job.stage);

    switch (jobState.status) {
      case 'queued':
        return {
          external_job_id: externalJobId,
          status: 'queued',
          progress: 0,
        };

      case 'running':
        const progress = Math.min(95, Math.floor((elapsed / estimated) * 100));
        return {
          external_job_id: externalJobId,
          status: 'running',
          progress,
          estimated_remaining_ms: Math.max(0, estimated - elapsed),
        };

      case 'succeeded':
        this.jobStates.delete(externalJobId);
        return {
          external_job_id: externalJobId,
          status: 'succeeded',
          progress: 100,
          result: jobState.result,
        };

      case 'failed':
        this.jobStates.delete(externalJobId);
        return {
          external_job_id: externalJobId,
          status: 'failed',
          error: jobState.error,
        };
    }
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const jobState = this.jobStates.get(externalJobId);

    if (!jobState) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found',
      };
    }

    if (jobState.status === 'succeeded' || jobState.status === 'failed') {
      return {
        success: false,
        status: 'already_completed',
      };
    }

    // Cancel via executor
    const cancelled = await this.executor.cancel(jobState.job.job_id);

    if (cancelled) {
      jobState.status = 'failed';
      jobState.error = 'Job cancelled by user';
      this.jobStates.delete(externalJobId);

      return {
        success: true,
        status: 'cancelled',
      };
    }

    return {
      success: false,
      status: 'failed',
      error: 'Could not cancel job',
    };
  }

  async collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'html' | 'other';
    uri: string;
    size_bytes?: number;
  }>> {
    const jobState = this.jobStates.get(externalJobId);

    if (!jobState || !jobState.result) {
      return [];
    }

    return jobState.result.artifacts || [];
  }

  /**
   * Convert execution result to WorkerResult
   */
  private convertToWorkerResult(job: WorkerJob, execResult: ExecutionResult): WorkerResult {
    const result = this.createBaseResult(job, execResult.duration_ms);

    result.summary = `Claude Code completed ${job.stage} stage`;

    if (execResult.artifacts) {
      result.artifacts = execResult.artifacts;
    }

    // Parse output for stage-specific results
    if (execResult.output) {
      const parsed = this.parseOutput(job.stage, execResult.output);
      Object.assign(result, parsed);
    }

    // Add LiteLLM metadata (placeholder - real data would come from CLI)
    result.usage = {
      ...result.usage,
      litellm: {
        model: this.model,
        provider: 'anthropic',
        input_tokens: 0, // Would be populated from real CLI output
        output_tokens: 0,
        cost_usd: 0,
      },
    };

    return result;
  }

  /**
   * Parse CLI output for stage-specific data
   */
  private parseOutput(stage: string, output: string): Partial<WorkerResult> {
    const result: Partial<WorkerResult> = {};

    try {
      // Try to parse as JSON
      const parsed = JSON.parse(output);

      // For plan stage, store plan output in artifacts
      if (stage === 'plan' && parsed.plan) {
        result.artifacts = result.artifacts || [];
        result.artifacts.push({
          artifact_id: `plan-${Date.now()}`,
          kind: 'json',
          uri: `data:application/json;base64,${Buffer.from(JSON.stringify(parsed.plan)).toString('base64')}`,
        });
      }

      if (stage === 'acceptance' && parsed.verdict) {
        result.verdict = {
          outcome: parsed.verdict.outcome || 'accept',
          reason: parsed.verdict.reason || '',
          manual_notes: parsed.verdict.notes,
        };
      }

      if (parsed.patch) {
        result.patch_ref = {
          format: 'unified_diff',
          content: parsed.patch,
        };
      }
    } catch {
      // Not JSON, use as raw output
      if (stage === 'dev') {
        // Check if output looks like a diff
        if (output.includes('--- ') && output.includes('+++ ')) {
          result.patch_ref = {
            format: 'unified_diff',
            content: output,
          };
        }
      }
    }

    return result;
  }

  /**
   * Override escalation normalization with production-specific logic
   */
  normalizeEscalation(rawEscalation: unknown): {
    kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
    reason: string;
    approved?: boolean;
  } | null {
    // Parse Claude Code specific escalation formats
    if (!rawEscalation || typeof rawEscalation !== 'object') {
      return null;
    }

    const esc = rawEscalation as Record<string, unknown>;

    // Tool use request format
    if (esc.tool_name || esc.tool_use_request) {
      const toolName = String(esc.tool_name || (esc.tool_use_request as Record<string, unknown>)?.tool_name || '');
      const input = (esc.input || (esc.tool_use_request as Record<string, unknown>)?.input) as Record<string, unknown> | undefined;

      // Network access tools
      if (['WebFetch', 'WebSearch', 'curl', 'http_request'].includes(toolName)) {
        return {
          kind: 'network_access',
          reason: `Network access requested: ${toolName}`,
          approved: esc.approved as boolean | undefined,
        };
      }

      // Destructive bash commands
      if (toolName === 'bash' && input?.command) {
        const cmd = String(input.command);
        const destructivePatterns = ['rm ', 'rmdir', 'delete', 'drop', 'truncate', 'format', 'mkfs'];
        if (destructivePatterns.some(p => cmd.includes(p))) {
          return {
            kind: 'destructive_tool',
            reason: `Destructive command: ${cmd}`,
            approved: esc.approved as boolean | undefined,
          };
        }
      }
    }

    // Permission escalation
    if (esc.permission_escalation || esc.permission_mode_change) {
      return {
        kind: 'human_verdict',
        reason: 'Permission escalation requested',
        approved: false,
      };
    }

    return super.normalizeEscalation(rawEscalation);
  }
}

/**
 * Create production Claude Code adapter
 */
export function createProductionClaudeCodeAdapter(
  config: ProductionClaudeCodeAdapterConfig
): ProductionClaudeCodeAdapter {
  return new ProductionClaudeCodeAdapter(config);
}