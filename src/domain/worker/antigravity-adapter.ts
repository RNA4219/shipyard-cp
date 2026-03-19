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

  // Use inherited jobStore, storeJob, getStoredJob, removeStoredJob from BaseWorkerAdapter

  /**
   * Antigravity has slightly different estimation times
   */
  protected estimateDuration(stage: string): number {
    const estimates: Record<string, number> = {
      'plan': 35000,       // 35 seconds
      'dev': 150000,       // 2.5 minutes
      'acceptance': 75000, // 1.25 minutes
    };
    return estimates[stage] || 75000;
  }

  /**
   * Generate result with Google-specific metadata
   */
  private generateResult(job: WorkerJob): WorkerResult {
    const result = this.createBaseResult(job);

    // Update summary for Antigravity
    result.summary = `Antigravity completed ${job.stage} stage successfully`;

    // Add Google-specific LiteLLM metadata
    result.usage!.litellm = {
      model: this.model,
      provider: 'google',
      input_tokens: 1500 + Math.floor(Math.random() * 800),
      output_tokens: 800 + Math.floor(Math.random() * 400),
      cost_usd: 0.005 + Math.random() * 0.015,
    };

    return result;
  }
}