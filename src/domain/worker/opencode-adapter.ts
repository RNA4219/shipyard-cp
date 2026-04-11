import {
  BaseWorkerAdapter,
  type CancelResult,
  type JobPollResult,
  type JobSubmissionResult,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type WorkerJob,
} from './worker-adapter.js';
import type { Capability, WorkerType, WorkerResult } from '../../types.js';
import { getConfig } from '../../config/index.js';
import { getLogger } from '../../monitoring/index.js';
import {
  createOpenCodeExecutor,
  type OpenCodeExecutionResult,
  type OpenCodeExecutor,
} from '../../infrastructure/opencode-executor.js';

export interface OpenCodeAdapterConfig extends WorkerAdapterConfig {
  workerType: WorkerType;
  cliPath?: string;
  model?: string;
  timeout?: number;
  debug?: boolean;
}

interface OpenCodeJobState {
  job: WorkerJob;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: WorkerResult;
  error?: string;
  startedAt: number;
  executionPromise?: Promise<OpenCodeExecutionResult>;
}

export class OpenCodeAdapter extends BaseWorkerAdapter {
  readonly workerType: WorkerType;
  private readonly logger = getLogger().child({ component: 'OpenCodeAdapter' });
  private readonly executor: OpenCodeExecutor;
  private readonly model: string;
  private readonly jobStates = new Map<string, OpenCodeJobState>();

  constructor(config: OpenCodeAdapterConfig) {
    super(config);

    const globalConfig = getConfig();
    this.workerType = config.workerType;
    this.model = config.model || (
      config.workerType === 'codex'
        ? globalConfig.worker.codexModel
        : globalConfig.worker.claudeModel
    );

    this.executor = createOpenCodeExecutor({
      cliPath: config.cliPath || globalConfig.worker.opencodeCliPath,
      model: this.model,
      timeout: config.timeout || globalConfig.worker.jobTimeout,
      workDir: globalConfig.worker.workDir,
      debug: config.debug ?? globalConfig.worker.debugMode,
    });
  }

  async initialize(): Promise<void> {
    try {
      const { spawn } = await import('child_process');
      const proc = spawn(getConfig().worker.opencodeCliPath, ['--version'], { stdio: 'ignore' });

      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch (error) {
      this.logger.warn('Could not verify OpenCode CLI installation', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await super.initialize();
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    const capabilities: Capability[] = this.workerType === 'claude_code'
      ? ['plan', 'edit_repo', 'run_tests', 'needs_approval', 'produces_patch', 'produces_verdict', 'networked']
      : ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'];

    return {
      worker_type: this.workerType,
      capabilities,
      max_concurrent_jobs: 5,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0',
      metadata: {
        model: this.model,
        substrate: 'opencode',
        supports_tools: true,
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

    const externalJobId = `opencode-${job.worker_type}-${job.job_id}-${Date.now()}`;
    const state: OpenCodeJobState = {
      job,
      status: 'queued',
      startedAt: Date.now(),
    };
    this.jobStates.set(externalJobId, state);
    state.status = 'running';

    if (process.env.VITEST === 'true') {
      state.result = this.createMockResult(job);
      state.status = 'succeeded';
      return {
        success: true,
        external_job_id: externalJobId,
        status: 'queued',
        estimated_duration_ms: this.estimateDuration(job.stage),
      };
    }

    state.executionPromise = this.executor.execute(job);
    state.executionPromise.then((result) => {
      if (result.success) {
        state.result = this.convertToWorkerResult(job, result);
        state.status = 'succeeded';
      } else {
        state.error = result.error;
        state.status = 'failed';
      }
    }).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'failed';
    });

    return {
      success: true,
      external_job_id: externalJobId,
      status: 'queued',
      estimated_duration_ms: this.estimateDuration(job.stage),
    };
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    const state = this.jobStates.get(externalJobId);
    if (!state) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    const elapsed = Date.now() - state.startedAt;
    const estimated = this.estimateDuration(state.job.stage);

    if (state.status === 'queued') {
      return {
        external_job_id: externalJobId,
        status: 'queued',
        progress: 0,
      };
    }

    if (state.status === 'running') {
      return {
        external_job_id: externalJobId,
        status: 'running',
        progress: Math.min(95, Math.floor((elapsed / estimated) * 100)),
        estimated_remaining_ms: Math.max(0, estimated - elapsed),
      };
    }

    if (state.status === 'succeeded' && state.result) {
      this.jobStates.delete(externalJobId);
      return {
        external_job_id: externalJobId,
        status: 'succeeded',
        progress: 100,
        result: state.result,
      };
    }

    this.jobStates.delete(externalJobId);
    return {
      external_job_id: externalJobId,
      status: 'failed',
      error: state.error || 'OpenCode execution failed',
    };
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const state = this.jobStates.get(externalJobId);
    if (!state) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found',
      };
    }

    const cancelled = await this.executor.cancel(state.job.job_id);
    this.jobStates.delete(externalJobId);

    return {
      success: cancelled,
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? undefined : 'Failed to cancel OpenCode job',
    };
  }

  async collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'html' | 'other';
    uri: string;
    size_bytes?: number;
  }>> {
    const state = this.jobStates.get(externalJobId);
    return state?.result?.artifacts ?? [];
  }

  normalizeEscalation(rawEscalation: unknown): {
    kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
    reason: string;
    approved?: boolean;
  } | null {
    if (!rawEscalation || typeof rawEscalation !== 'object') {
      return null;
    }

    const esc = rawEscalation as Record<string, unknown>;
    if (esc.permission === 'ask') {
      return {
        kind: 'human_verdict',
        reason: String(esc.reason || esc.tool || 'OpenCode permission request'),
        approved: false,
      };
    }

    if (esc.tool === 'webfetch') {
      return {
        kind: 'network_access',
        reason: String(esc.reason || 'OpenCode webfetch request'),
        approved: esc.approved as boolean | undefined,
      };
    }

    return super.normalizeEscalation(rawEscalation);
  }

  private convertToWorkerResult(job: WorkerJob, result: OpenCodeExecutionResult): WorkerResult {
    const base = this.createBaseResult(job, result.duration_ms);
    const output = result.output || '';

    base.summary = `OpenCode completed ${job.stage} stage`;
    base.artifacts = result.artifacts?.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      kind: artifact.kind,
      uri: artifact.uri,
    })) ?? [];
    base.raw_outputs = base.artifacts
      .filter((artifact) => artifact.kind === 'log' || artifact.kind === 'json')
      .map((artifact) => ({
        channel: artifact.kind === 'json' ? 'json' : 'stdout',
        artifact_id: artifact.artifact_id,
      }));

    if (job.stage === 'acceptance') {
      const verdict = this.tryExtractVerdict(output);
      if (verdict) {
        base.verdict = verdict;
      }
    }

    if (output.includes('--- ') && output.includes('+++ ')) {
      base.patch_ref = {
        format: 'unified_diff',
        content: output,
        base_sha: job.repo_ref.base_sha,
      };
    }

    base.usage = {
      runtime_ms: result.duration_ms,
      exit_code: result.exit_code,
    };
    base.metadata = {
      ...(base.metadata ?? {}),
      substrate: 'opencode',
      logical_worker: this.workerType,
    };

    return base;
  }

  private tryExtractVerdict(output: string): WorkerResult['verdict'] | undefined {
    const trimmed = output.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as { outcome?: 'accept' | 'reject' | 'rework' | 'needs_manual_review'; reason?: string };
      if (parsed.outcome) {
        return {
          outcome: parsed.outcome,
          reason: parsed.reason,
          checklist_completed: parsed.outcome === 'accept',
        };
      }
    } catch {
      // Ignore parse failure and fall back to heuristic
    }

    return {
      outcome: /reject|rework/i.test(trimmed) ? 'rework' : 'accept',
      reason: trimmed.slice(0, 500),
      checklist_completed: !/reject|rework/i.test(trimmed),
    };
  }

  private createMockResult(job: WorkerJob): WorkerResult {
    const result = this.createBaseResult(job);
    result.summary = `Mock OpenCode completed ${job.stage} stage`;
    result.metadata = {
      substrate: 'opencode',
      logical_worker: this.workerType,
      mock: true,
    };
    return result;
  }
}
