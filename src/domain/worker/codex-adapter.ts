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
 * Codex job submission payload
 */
interface CodexJobPayload {
  job_id: string;
  task_id: string;
  prompt: string;
  repo: {
    owner: string;
    name: string;
    branch: string;
  };
  stage: string;
  workspace_id: string;
  capability_requirements: string[];
  risk_level: string;
  timeouts?: {
    queue_timeout_sec?: number;
    run_timeout_sec?: number;
  };
}

/**
 * Codex job status response
 */
interface CodexJobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;
  result?: {
    summary: string;
    patch?: string;
    branch?: string;
    artifacts: Array<{ id: string; kind: string; uri: string }>;
    test_results: Array<{ suite: string; status: string; passed: number; failed: number }>;
    verdict?: {
      outcome: string;
      reason?: string;
    };
    escalations: Array<{ kind: string; reason: string; approved?: boolean }>;
    usage: {
      runtime_ms: number;
      tokens?: {
        input: number;
        output: number;
      };
    };
  };
  error?: string;
  logs?: string[];
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
      // Build the prompt
      const prompt = job.input_prompt || this.buildPrompt(job);

      // For Codex, we simulate job submission
      // In a real implementation, this would call the Codex API
      const externalJobId = `codex-${job.job_id}-${Date.now()}`;

      // Store job for polling (simulated)
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

    // Simulate job progress
    const elapsed = Date.now() - jobData.startedAt;
    const estimated = jobData.estimatedDuration;
    const progress = Math.min(95, Math.floor((elapsed / estimated) * 100));

    // Check if job should complete
    if (elapsed >= estimated) {
      const result = this.generateResult(jobData.job, jobData.prompt);

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

    // Remove stored job
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

    // Return simulated artifacts
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

    // Fall back to default normalization
    return super.normalizeEscalation(rawEscalation);
  }

  // --- Simulated job storage (in production, use actual job queue) ---

  private jobStore: Map<string, {
    job: WorkerJob;
    prompt: string;
    startedAt: number;
    estimatedDuration: number;
  }> = new Map();

  private storeJob(externalJobId: string, job: WorkerJob, prompt: string): void {
    this.jobStore.set(externalJobId, {
      job,
      prompt,
      startedAt: Date.now(),
      estimatedDuration: this.estimateDuration(job.stage),
    });
  }

  private getStoredJob(externalJobId: string) {
    return this.jobStore.get(externalJobId);
  }

  private removeStoredJob(externalJobId: string): void {
    this.jobStore.delete(externalJobId);
  }

  private estimateDuration(stage: string): number {
    const estimates: Record<string, number> = {
      'plan': 30000,      // 30 seconds
      'dev': 120000,      // 2 minutes
      'acceptance': 60000, // 1 minute
    };
    return estimates[stage] || 60000;
  }

  private generateResult(job: WorkerJob, _prompt: string): WorkerResult {
    const stage = job.stage;

    // Generate simulated result based on stage
    const baseResult: WorkerResult = {
      job_id: job.job_id,
      typed_ref: job.typed_ref,
      status: 'succeeded',
      summary: `Completed ${stage} stage successfully`,
      artifacts: [
        { artifact_id: `${job.job_id}-log`, kind: 'log', uri: `file:///logs/${job.job_id}.log` },
      ],
      test_results: [],
      requested_escalations: [],
      usage: {
        runtime_ms: this.estimateDuration(stage),
        litellm: {
          model: this.model,
          provider: 'openai',
          input_tokens: 1000 + Math.floor(Math.random() * 500),
          output_tokens: 500 + Math.floor(Math.random() * 300),
          cost_usd: 0.01 + Math.random() * 0.02,
        },
      },
    };

    // Add stage-specific results
    if (stage === 'plan') {
      baseResult.artifacts.push({
        artifact_id: `${job.job_id}-plan`,
        kind: 'json',
        uri: `file:///plans/${job.job_id}.json`,
      });
    } else if (stage === 'dev') {
      baseResult.patch_ref = {
        format: 'unified_diff',
        content: '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,5 @@\n+// Added line\n existing code',
        base_sha: job.repo_ref.base_sha,
      };
      baseResult.test_results = [
        { suite: 'unit', status: 'passed', passed: 10, failed: 0, duration_ms: 500 },
      ];
    } else if (stage === 'acceptance') {
      baseResult.verdict = {
        outcome: 'accept',
        reason: 'All acceptance criteria met',
        checklist_completed: true,
      };
      baseResult.test_results = [
        { suite: 'acceptance', status: 'passed', passed: 5, failed: 0, duration_ms: 2000 },
      ];
    }

    return baseResult;
  }
}