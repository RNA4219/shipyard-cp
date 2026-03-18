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
 * Antigravity adapter configuration
 */
export interface AntigravityAdapterConfig extends WorkerAdapterConfig {
  workerType: 'google_antigravity';
  /** Google Cloud Project ID */
  projectId?: string;
  /** Gemini model to use */
  model?: string;
  /** Google Cloud region */
  region?: string;
}

/**
 * Antigravity Worker Adapter
 *
 * Implements the WorkerAdapter interface for Google Antigravity / Gemini based workers.
 */
export class AntigravityAdapter extends BaseWorkerAdapter {
  readonly workerType = 'google_antigravity' as const;
  private projectId: string | undefined;
  private model: string;
  private region: string;
  private apiKey: string | undefined;

  constructor(config: AntigravityAdapterConfig) {
    super(config);
    this.projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT;
    this.model = config.model || 'gemini-2.0-flash';
    this.region = config.region || 'us-central1';
    this.apiKey = config.auth?.value || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  }

  async initialize(): Promise<void> {
    // Antigravity can work with ADC, API key, or service account
    const hasApiKey = this.apiKey;
    const hasAdc = process.env.GOOGLE_APPLICATION_CREDENTIALS || this.hasAdcCredentials();
    const hasProjectId = this.projectId;

    const logger = getLogger().child({ component: 'AntigravityAdapter', workerType: this.workerType });

    if (!hasApiKey && !hasAdc) {
      logger.warn('No API key or ADC configured', {
        hint: 'Set GOOGLE_API_KEY, GEMINI_API_KEY, or configure ADC',
      });
    }

    if (!hasProjectId && hasAdc) {
      logger.warn('GOOGLE_CLOUD_PROJECT not set');
    }

    await super.initialize();
  }

  /**
   * Check if ADC credentials are available
   */
  private hasAdcCredentials(): boolean {
    // Check for gcloud ADC file
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      // This is a simplified check - in production would use fs.access
      return false;
    }
    return false;
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: 'google_antigravity',
      capabilities: ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'],
      max_concurrent_jobs: 8,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0',
      metadata: {
        model: this.model,
        provider: 'google',
        ...(this.projectId ? { project_id: this.projectId } : {}),
        ...(this.region ? { region: this.region } : {}),
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

      // Generate external job ID
      const externalJobId = `antigravity-${job.job_id}-${Date.now()}`;

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
        uri: `file:///var/logs/antigravity/${externalJobId}.log`,
        size_bytes: 1024,
      },
      {
        artifact_id: `${externalJobId}-report`,
        kind: 'report',
        uri: `file:///var/reports/antigravity/${externalJobId}.json`,
        size_bytes: 2048,
      },
      {
        artifact_id: `${externalJobId}-trace`,
        kind: 'trace',
        uri: `file:///var/traces/antigravity/${externalJobId}.json`,
        size_bytes: 512,
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

    // Antigravity-specific escalation format
    if (esc.action_request) {
      const request = esc.action_request as Record<string, unknown>;
      const type = request.type as string;
      const reason = String(request.description || request.reason || '');

      const typeMap: Record<string, 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict'> = {
        'network': 'network_access',
        'file_write': 'workspace_outside_write',
        'protected_write': 'protected_path_write',
        'destructive': 'destructive_tool',
        'secret': 'secret_access',
        'approval': 'human_verdict',
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

    // Google Cloud specific escalation format
    if (esc.permission_request) {
      const request = esc.permission_request as Record<string, unknown>;
      const permission = String(request.permission || '');
      const reason = String(request.reason || '');

      // Map GCP permissions to escalation kinds
      if (permission.includes('secret') || permission.includes('SecretManager')) {
        return {
          kind: 'secret_access',
          reason: reason || `Secret access: ${permission}`,
          approved: request.approved as boolean | undefined,
        };
      }

      if (permission.includes('compute') || permission.includes('storage') || permission.includes('delete')) {
        return {
          kind: 'destructive_tool',
          reason: reason || `Destructive action: ${permission}`,
          approved: request.approved as boolean | undefined,
        };
      }

      if (permission.includes('network') || permission.includes('ingress')) {
        return {
          kind: 'network_access',
          reason: reason || `Network access: ${permission}`,
          approved: request.approved as boolean | undefined,
        };
      }
    }

    // Fall back to default normalization
    return super.normalizeEscalation(rawEscalation);
  }

  // --- Job storage (in production, use actual job queue) ---

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
      'plan': 35000,      // 35 seconds
      'dev': 150000,      // 2.5 minutes
      'acceptance': 75000, // 1.25 minutes
    };
    return estimates[stage] || 75000;
  }

  private generateResult(job: WorkerJob, _prompt: string): WorkerResult {
    const stage = job.stage;

    // Generate simulated result based on stage
    const baseResult: WorkerResult = {
      job_id: job.job_id,
      typed_ref: job.typed_ref,
      status: 'succeeded',
      summary: `Antigravity completed ${stage} stage successfully`,
      artifacts: [
        { artifact_id: `${job.job_id}-log`, kind: 'log', uri: `file:///logs/antigravity/${job.job_id}.log` },
      ],
      test_results: [],
      requested_escalations: [],
      usage: {
        runtime_ms: this.estimateDuration(stage),
        litellm: {
          model: this.model,
          provider: 'google',
          input_tokens: 1500 + Math.floor(Math.random() * 800),
          output_tokens: 800 + Math.floor(Math.random() * 400),
          cost_usd: 0.005 + Math.random() * 0.015,
        },
      },
    };

    // Add stage-specific results
    if (stage === 'plan') {
      baseResult.artifacts.push({
        artifact_id: `${job.job_id}-plan`,
        kind: 'json',
        uri: `file:///plans/antigravity/${job.job_id}.json`,
      });
    } else if (stage === 'dev') {
      baseResult.patch_ref = {
        format: 'unified_diff',
        content: '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,5 @@\n+// Antigravity modification\n existing code',
        base_sha: job.repo_ref.base_sha,
      };
      baseResult.test_results = [
        { suite: 'unit', status: 'passed', passed: 12, failed: 0, duration_ms: 600 },
        { suite: 'integration', status: 'passed', passed: 6, failed: 0, duration_ms: 1200 },
      ];
    } else if (stage === 'acceptance') {
      baseResult.verdict = {
        outcome: 'accept',
        reason: 'All acceptance criteria verified by Antigravity',
        checklist_completed: true,
      };
      baseResult.test_results = [
        { suite: 'acceptance', status: 'passed', passed: 8, failed: 0, duration_ms: 2500 },
      ];
    }

    return baseResult;
  }
}