import type {
  WorkerJob,
  WorkerResult,
  WorkerType,
  WorkerStage,
  RepoRef,
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