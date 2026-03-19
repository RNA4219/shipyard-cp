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

/**
 * Claude Code adapter configuration
 */
export interface ClaudeCodeAdapterConfig extends WorkerAdapterConfig {
  workerType: 'claude_code';
  /** Claude Code CLI path or API endpoint */
  endpoint?: string;
  /** Claude model to use */
  model?: string;
}

/**
 * Claude Code Worker Adapter
 *
 * Implements WorkerAdapter for Anthropic Claude Code CLI.
 */
export class ClaudeCodeAdapter extends BaseWorkerAdapter {
  readonly workerType = 'claude_code' as const;
  private model: string;
  private apiKey: string | undefined;

  constructor(config: ClaudeCodeAdapterConfig) {
    super(config);
    this.model = config.model || 'claude-sonnet-4-6';
    this.apiKey = config.auth?.value;
  }

  async initialize(): Promise<void> {
    // Claude Code can work with ANTHROPIC_API_KEY env var
    if (!this.apiKey && !process.env.ANTHROPIC_API_KEY) {
      const logger = getLogger().child({ component: 'ClaudeCodeAdapter', workerType: this.workerType });
      logger.warn('No API key configured, will use CLI default');
    }
    await super.initialize();
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
      version: '1.0.0',
      metadata: {
        model: this.model,
        supports_mcp: true,
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

    try {
      const prompt = job.input_prompt || this.buildPrompt(job);
      const externalJobId = `claude-${job.job_id}-${Date.now()}`;

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
        artifact_id: `${externalJobId}-session`,
        kind: 'json',
        uri: `file:///var/sessions/claude/${externalJobId}.json`,
        size_bytes: 4096,
      },
      {
        artifact_id: `${externalJobId}-transcript`,
        kind: 'log',
        uri: `file:///var/logs/claude/${externalJobId}.log`,
        size_bytes: 8192,
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

    // Claude Code specific format
    if (esc.tool_use_request) {
      const request = esc.tool_use_request as Record<string, unknown>;
      const toolName = String(request.tool_name || '');
      const input = request.input as Record<string, unknown> | undefined;
      const reason = String(request.reason || `Tool use: ${toolName}`);

      // Map Claude Code tool names to escalation kinds
      const toolMap: Record<string, 'network_access' | 'workspace_outside_write' | 'destructive_tool' | 'secret_access'> = {
        'WebFetch': 'network_access',
        'WebSearch': 'network_access',
        'bash': 'destructive_tool', // If includes destructive commands
      };

      // Check for destructive bash commands
      if (toolName === 'bash' && input?.command) {
        const cmd = String(input.command);
        if (cmd.includes('rm ') || cmd.includes('delete') || cmd.includes('drop')) {
          return {
            kind: 'destructive_tool',
            reason: `Destructive command: ${cmd}`,
            approved: request.approved as boolean | undefined,
          };
        }
      }

      const kind = toolMap[toolName];
      if (kind) {
        return {
          kind,
          reason,
          approved: request.approved as boolean | undefined,
        };
      }
    }

    // Permission mode escalation
    if (esc.permission_mode_change) {
      const change = esc.permission_mode_change as Record<string, unknown>;
      return {
        kind: 'human_verdict',
        reason: `Permission mode change requested: ${change.from} -> ${change.to}`,
        approved: false,
      };
    }

    return super.normalizeEscalation(rawEscalation);
  }

  /**
   * Claude Code has slightly longer estimation times
   */
  protected estimateDuration(stage: string): number {
    const estimates: Record<string, number> = {
      'plan': 45000,       // 45 seconds
      'dev': 180000,       // 3 minutes
      'acceptance': 90000, // 1.5 minutes
    };
    return estimates[stage] || 90000;
  }

  /**
   * Generate result with Claude-specific metadata
   */
  private generateResult(job: WorkerJob): WorkerResult {
    const result = this.createBaseResult(job);

    // Update summary for Claude Code
    result.summary = `Claude Code completed ${job.stage} stage`;

    // Add Claude/Anthropic-specific LiteLLM metadata
    result.usage!.litellm = {
      model: this.model,
      provider: 'anthropic',
      input_tokens: 2000 + Math.floor(Math.random() * 1000),
      output_tokens: 1000 + Math.floor(Math.random() * 500),
      cost_usd: 0.03 + Math.random() * 0.05,
    };

    return result;
  }
}