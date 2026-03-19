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

/**
 * Codex API configuration
 */
export interface CodexAdapterConfig extends WorkerAdapterConfig {
  workerType: 'codex';
  /** Codex API endpoint (default: OpenAI API) */
  endpoint?: string;
  /** Model to use */
  model?: string;
}

/**
 * Codex Worker Adapter
 *
 * Implements the WorkerAdapter interface for OpenAI Codex / GPT-4 based workers.
 */
export class CodexAdapter extends BaseWorkerAdapter {
  readonly workerType = 'codex' as const;
  private model: string;
  private apiKey: string | undefined;

  constructor(config: CodexAdapterConfig) {
    super(config);
    this.model = config.model || 'gpt-4o';
    this.apiKey = config.auth?.value;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Codex adapter requires API key');
    }
    await super.initialize();
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: 'codex',
      capabilities: ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'],
      max_concurrent_jobs: 10,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0',
      metadata: {
        model: this.model,
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
      const prompt = job.input_prompt || this.buildPrompt(job);
      const externalJobId = `codex-${job.job_id}-${Date.now()}`;

      this.storeJob(externalJobId, job, prompt);

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
    const jobData = this.getStoredJob(externalJobId);

    if (!jobData) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    const elapsed = Date.now() - jobData.startedAt;
    const estimated = jobData.estimatedDuration;
    const progress = Math.min(95, Math.floor((elapsed / estimated) * 100));

    if (elapsed >= estimated) {
      const result = this.generateResult(jobData.job);

      return {
        external_job_id: externalJobId,
        status: 'succeeded',
        progress: 100,
        result,
      };
    }

    return {
      external_job_id: externalJobId,
      status: 'running',
      progress,
      estimated_remaining_ms: estimated - elapsed,
    };
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const jobData = this.getStoredJob(externalJobId);

    if (!jobData) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found',
      };
    }

    this.removeStoredJob(externalJobId);

    return {
      success: true,
      status: 'cancelled',
    };
  }

  async collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
    uri: string;
    size_bytes?: number;
  }>> {
    const jobData = this.getStoredJob(externalJobId);

    if (!jobData) {
      return [];
    }

    return [
      {
        artifact_id: `${externalJobId}-log`,
        kind: 'log',
        uri: `file:///var/logs/codex/${externalJobId}.log`,
        size_bytes: 1024,
      },
      {
        artifact_id: `${externalJobId}-report`,
        kind: 'report',
        uri: `file:///var/reports/codex/${externalJobId}.json`,
        size_bytes: 2048,
      },
    ];
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

    // Codex-specific escalation format
    if (esc.permission_request) {
      const request = esc.permission_request as Record<string, unknown>;
      const type = request.type as string;
      const reason = String(request.reason || request.description || '');

      const typeMap: Record<string, 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict'> = {
        'network': 'network_access',
        'file_write': 'workspace_outside_write',
        'destructive': 'destructive_tool',
        'secret': 'secret_access',
        'human_review': 'human_verdict',
      };

      const kind = typeMap[type];
      if (kind) {
        return {
          kind,
          reason,
          approved: request.approved as boolean | undefined,
        };
      }
    }

    return super.normalizeEscalation(rawEscalation);
  }

  /**
   * Generate result with Codex-specific LiteLLM metadata
   */
  private generateResult(job: WorkerJob): WorkerResult {
    const result = this.createBaseResult(job);

    // Add Codex/OpenAI-specific LiteLLM metadata
    result.usage!.litellm = {
      model: this.model,
      provider: 'openai',
      input_tokens: 1000 + Math.floor(Math.random() * 500),
      output_tokens: 500 + Math.floor(Math.random() * 300),
      cost_usd: 0.01 + Math.random() * 0.02,
    };

    return result;
  }
}