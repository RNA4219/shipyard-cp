import type {
  WorkerJob,
  WorkerResult,
  WorkerType,
  WorkerStage,
  Capability,
} from '../../types.js';

// Re-export WorkerJob for convenience
export type { WorkerJob } from '../../types.js';

/**
 * Worker adapter configuration
 */
export interface WorkerAdapterConfig {
  /** Worker type identifier */
  workerType: WorkerType;
  /** API endpoint or command path */
  endpoint?: string;
  /** Authentication credentials */
  auth?: {
    type: 'api_key' | 'oauth' | 'pat' | 'none';
    value?: string;
  };
  /** Timeouts */
  timeouts?: {
    submit_ms?: number;
    poll_ms?: number;
    cancel_ms?: number;
  };
  /** Retry configuration */
  retry?: {
    max_retries: number;
    backoff_ms: number;
  };
}

/**
 * Job submission result
 */
export interface JobSubmissionResult {
  success: boolean;
  external_job_id?: string;
  status: 'queued' | 'running' | 'failed' | 'rejected';
  error?: string;
  estimated_duration_ms?: number;
}

/**
 * Job status poll result
 */
export interface JobPollResult {
  external_job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked';
  progress?: number; // 0-100
  result?: WorkerResult;
  error?: string;
  logs?: string[];
  estimated_remaining_ms?: number;
}

/**
 * Cancel result
 */
export interface CancelResult {
  success: boolean;
  status: 'cancelled' | 'already_completed' | 'not_found' | 'failed';
  partial_result?: WorkerResult;
  error?: string;
}

/**
 * Worker capabilities
 */
export interface WorkerCapabilities {
  worker_type: WorkerType;
  capabilities: Capability[];
  max_concurrent_jobs: number;
  supported_stages: WorkerStage[];
  version: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Worker heartbeat
 */
export interface WorkerHeartbeat {
  external_job_id: string;
  timestamp: string;
  status: 'healthy' | 'stalled' | 'error';
  progress?: number;
  message?: string;
}

/**
 * Base Worker Adapter Interface
 *
 * Defines the contract for worker implementations
 */
export interface WorkerAdapter {
  /** Worker type identifier */
  readonly workerType: WorkerType;

  /**
   * Initialize the adapter
   */
  initialize(): Promise<void>;

  /**
   * Check if adapter is ready
   */
  isReady(): Promise<boolean>;

  /**
   * Get worker capabilities
   */
  getCapabilities(): Promise<WorkerCapabilities>;

  /**
   * Submit a job to the worker
   */
  submitJob(job: WorkerJob): Promise<JobSubmissionResult>;

  /**
   * Poll job status
   */
  pollJob(externalJobId: string): Promise<JobPollResult>;

  /**
   * Cancel a running job
   */
  cancelJob(externalJobId: string): Promise<CancelResult>;

  /**
   * Collect artifacts from completed job
   */
  collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
    uri: string;
    size_bytes?: number;
  }>>;

  /**
   * Normalize worker-specific escalation to standard format
   */
  normalizeEscalation(rawEscalation: unknown): {
    kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
    reason: string;
    approved?: boolean;
  } | null;

  /**
   * Shutdown the adapter
   */
  shutdown(): Promise<void>;
}

/**
 * Worker Adapter Base Class
 *
 * Provides common functionality for worker adapters
 */
export abstract class BaseWorkerAdapter implements WorkerAdapter {
  abstract readonly workerType: WorkerType;
  protected config: WorkerAdapterConfig;
  protected initialized: boolean = false;

  constructor(config: WorkerAdapterConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Override in subclass
    this.initialized = true;
  }

  async isReady(): Promise<boolean> {
    return this.initialized;
  }

  abstract getCapabilities(): Promise<WorkerCapabilities>;
  abstract submitJob(job: WorkerJob): Promise<JobSubmissionResult>;
  abstract pollJob(externalJobId: string): Promise<JobPollResult>;
  abstract cancelJob(externalJobId: string): Promise<CancelResult>;
  abstract collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'other';
    uri: string;
    size_bytes?: number;
  }>>;

  normalizeEscalation(rawEscalation: unknown): {
    kind: 'network_access' | 'workspace_outside_write' | 'protected_path_write' | 'destructive_tool' | 'secret_access' | 'human_verdict';
    reason: string;
    approved?: boolean;
  } | null {
    // Default implementation - override in subclass
    if (!rawEscalation || typeof rawEscalation !== 'object') {
      return null;
    }

    const esc = rawEscalation as Record<string, unknown>;
    const kind = esc.kind as string;

    if (typeof kind === 'string') {
      const validKinds = [
        'network_access', 'workspace_outside_write', 'protected_path_write',
        'destructive_tool', 'secret_access', 'human_verdict'
      ] as const;

      if (validKinds.includes(kind as typeof validKinds[number])) {
        return {
          kind: kind as typeof validKinds[number],
          reason: String(esc.reason || ''),
          approved: esc.approved as boolean | undefined,
        };
      }
    }

    return null;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.jobStore.clear();
  }

  // --- Shared job storage for simulation mode ---

  /**
   * Job storage for simulation mode
   * In production, use actual job queue (Redis, etc.)
   */
  protected jobStore: Map<string, {
    job: WorkerJob;
    prompt: string;
    startedAt: number;
    estimatedDuration: number;
  }> = new Map();

  /**
   * Store a job for later polling
   */
  protected storeJob(externalJobId: string, job: WorkerJob, prompt: string): void {
    this.jobStore.set(externalJobId, {
      job,
      prompt,
      startedAt: Date.now(),
      estimatedDuration: this.estimateDuration(job.stage),
    });
  }

  /**
   * Get stored job data
   */
  protected getStoredJob(externalJobId: string) {
    return this.jobStore.get(externalJobId);
  }

  /**
   * Remove stored job
   */
  protected removeStoredJob(externalJobId: string): void {
    this.jobStore.delete(externalJobId);
  }

  /**
   * Estimate job duration based on stage
   */
  protected estimateDuration(stage: string): number {
    const estimates: Record<string, number> = {
      'plan': 30000,       // 30 seconds
      'dev': 120000,       // 2 minutes
      'acceptance': 60000, // 1 minute
    };
    return estimates[stage] || 60000;
  }

  /**
   * Create base result structure (shared across adapters)
   * Override in subclass to add provider-specific fields
   */
  protected createBaseResult(job: WorkerJob, runtimeMs?: number): WorkerResult {
    const stage = job.stage;
    const duration = runtimeMs ?? this.estimateDuration(stage);

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
        runtime_ms: duration,
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

  /**
   * Build input prompt for the worker
   */
  protected buildPrompt(job: WorkerJob): string {
    const lines: string[] = [];

    lines.push(`# Task: ${job.task_id}`);
    lines.push(`## Stage: ${job.stage}`);
    lines.push('');

    if (job.context?.objective) {
      lines.push(`### Objective`);
      lines.push(job.context.objective);
      lines.push('');
    }

    if (job.context?.acceptance_criteria?.length) {
      lines.push(`### Acceptance Criteria`);
      job.context.acceptance_criteria.forEach((c, i) => {
        lines.push(`${i + 1}. ${c}`);
      });
      lines.push('');
    }

    if (job.context?.constraints?.length) {
      lines.push(`### Constraints`);
      job.context.constraints.forEach((c) => {
        lines.push(`- ${c}`);
      });
      lines.push('');
    }

    if (job.context?.references?.length) {
      lines.push(`### References`);
      job.context.references.forEach((ref) => {
        lines.push(`- [${ref.label || ref.kind}] ${ref.value}`);
      });
      lines.push('');
    }

    if (job.requested_outputs?.length) {
      lines.push(`### Expected Outputs`);
      lines.push(job.requested_outputs.map((o) => `- ${o}`).join('\n'));
    }

    return lines.join('\n');
  }

  /**
   * Validate job before submission
   */
  protected validateJob(job: WorkerJob): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!job.job_id) {
      errors.push('job_id is required');
    }

    if (!job.task_id) {
      errors.push('task_id is required');
    }

    if (!job.repo_ref?.owner || !job.repo_ref?.name) {
      errors.push('repo_ref with owner and name is required');
    }

    if (!job.input_prompt && !job.context) {
      errors.push('either input_prompt or context is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}