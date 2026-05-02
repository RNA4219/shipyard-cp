import type {
  Task,
  TaskState,
  WorkerJob,
  WorkerResult,
  DispatchRequest,
  JobHeartbeatRequest,
  JobHeartbeatResponse,
} from '../../types.js';
import { DispatchOrchestrator } from '../../domain/dispatch/index.js';
import { LeaseManager } from '../../domain/lease/index.js';
import { RetryManager } from '../../domain/retry/index.js';
import { ConcurrencyManager } from '../../domain/concurrency/index.js';
import { CapabilityManager } from '../../domain/capability/index.js';
import { DoomLoopDetector } from '../../domain/doom-loop/index.js';
import {
  WorkerExecutor,
  GLM5Adapter,
  CodexAdapter,
  ClaudeCodeAdapter,
  ProductionClaudeCodeAdapter,
  AntigravityAdapter,
  OpenCodeAdapter,
} from '../../domain/worker/index.js';
import { OpenCodeServeAdapter } from '../../domain/worker/opencode-serve-adapter.js';
import { OpenCodeSessionRegistry, createOpenCodeSessionRegistry } from '../../domain/worker/session-registry/index.js';
import { OpenCodeServerManager, createOpenCodeServerManager } from '../../infrastructure/opencode-server-manager.js';
import { createOpenCodeSessionExecutor } from '../../infrastructure/opencode-session-executor.js';
import { StateMachine } from '../../domain/state-machine/index.js';
import { getMetricsCollector } from '../../monitoring/metrics/index.js';
import { getLogger } from '../../monitoring/index.js';
import { getConfig } from '../../config/index.js';

const logger = getLogger().child({ component: 'JobService' });

/**
 * Context interface for job operations that require store coordination.
 */
export interface JobOperationContext {
  requireTask: (taskId: string) => Task;
  transitionTask: (task: Task, toState: TaskState, input: {
    actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine';
    actor_id: string;
    reason: string;
    job_id?: string;
    artifact_ids?: string[];
  }) => { event: import('../../types.js').StateTransitionEvent; task: Task };
  emitAuditEvent: (taskId: string, eventType: import('../../types.js').AuditEventType, payload: Record<string, unknown>, options?: {
    runId?: string;
    jobId?: string;
    actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
    actorId?: string;
  }) => import('../../types.js').AuditEvent;
  applyResult: (taskId: string, result: WorkerResult) => import('../../types.js').ResultApplyResponse;
  setTask: (taskId: string, task: Task) => void;
}

/**
 * Dependencies for JobService.
 */
export interface JobServiceDeps {
  leaseManager: LeaseManager;
  retryManager: RetryManager;
  concurrencyManager: ConcurrencyManager;
  capabilityManager: CapabilityManager;
  doomLoopDetector: DoomLoopDetector;
  stateMachine: StateMachine;
}

/**
 * Service for Job dispatch, heartbeat, and polling.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class JobService {
  private readonly jobs = new Map<string, WorkerJob>();
  private readonly results = new Map<string, WorkerResult>();
  private readonly retryTracker = new Map<string, number>();

  // Orchestrators and managers
  private readonly dispatchOrchestrator: DispatchOrchestrator;
  private readonly workerExecutor: WorkerExecutor;

  // OpenCode serve mode components (optional)
  private opencodeServerManager: OpenCodeServerManager | null = null;
  private opencodeSessionRegistry: OpenCodeSessionRegistry | null = null;

  // Worker initialization state
  private workerInitialized = false;

  constructor(private readonly deps: JobServiceDeps) {
    this.dispatchOrchestrator = new DispatchOrchestrator({
      capabilityManager: deps.capabilityManager,
      concurrencyManager: deps.concurrencyManager,
      leaseManager: deps.leaseManager,
      retryManager: deps.retryManager,
      doomLoopDetector: deps.doomLoopDetector,
      stateMachine: deps.stateMachine,
    });

    this.workerExecutor = new WorkerExecutor({
      pollIntervalMs: 5000,
      enableFailover: true,
    });
  }

  /**
   * Initialize worker adapters based on configured logical backends.
   */
  async initialize(): Promise<void> {
    if (this.workerInitialized) return;

    const config = getConfig();
    const opencodeMode = config.opencodeServe.mode;
    const sessionReuse = config.opencodeServe.sessionReuse;

    // Initialize serve mode components if configured
    if (opencodeMode === 'serve') {
      logger.info('Initializing OpenCode serve mode', {
        serveBaseUrl: config.opencodeServe.serveBaseUrl,
        sessionReuse,
      });

      this.opencodeServerManager = createOpenCodeServerManager(
        config.opencodeServe,
        config.worker.debugMode,
      );

      this.opencodeSessionRegistry = createOpenCodeSessionRegistry({
        sessionTtlMs: config.opencodeServe.sessionTtlMs,
        leaseTtlMs: config.opencodeServe.reuseLeaseTtlMs,
        debug: config.worker.debugMode,
      });

      // Try to start the server
      const serverReady = await this.opencodeServerManager.ensureServerReady();
      if (!serverReady) {
        logger.warn('OpenCode serve server failed to start, will use run fallback');
      }
    }

    // Register codex adapter
    if (config.worker.codexBackend === 'opencode') {
      if (opencodeMode === 'serve' && this.opencodeServerManager && this.opencodeSessionRegistry) {
        const sessionExecutor = createOpenCodeSessionExecutor(
          { baseUrl: config.opencodeServe.serveBaseUrl, timeout: config.worker.jobTimeout },
          this.opencodeSessionRegistry,
        );
        this.workerExecutor.registerAdapter(new OpenCodeServeAdapter({
          workerType: 'codex',
          serverManager: this.opencodeServerManager,
          sessionRegistry: this.opencodeSessionRegistry,
          sessionExecutor,
          model: config.worker.codexModel,
          debug: config.worker.debugMode,
        }));
        logger.info('Registered OpenCodeServeAdapter for codex');
      } else {
        this.workerExecutor.registerAdapter(new OpenCodeAdapter({
          workerType: 'codex',
          model: config.worker.codexModel,
        }));
        logger.info('Registered OpenCodeAdapter (run mode) for codex');
      }
    } else {
      this.workerExecutor.registerAdapter(new CodexAdapter({
        workerType: 'codex',
        model: config.worker.codexModel,
        auth: {
          type: 'api_key',
          value: config.apiKeys.openaiApiKey,
        },
      }));
    }

    // Register claude_code adapter based on backend
    switch (config.worker.claudeBackend) {
      case 'glm':
        this.workerExecutor.registerAdapter(new GLM5Adapter({
          workerType: 'claude_code',
          model: config.worker.glmModel,
        }));
        break;
      case 'claude_cli':
        this.workerExecutor.registerAdapter(new ProductionClaudeCodeAdapter({
          workerType: 'claude_code',
          model: config.worker.claudeModel,
        }));
        break;
      case 'simulation':
        this.workerExecutor.registerAdapter(new ClaudeCodeAdapter({
          workerType: 'claude_code',
          model: config.worker.claudeModel,
          auth: {
            type: 'api_key',
            value: config.apiKeys.anthropicApiKey,
          },
        }));
        break;
      case 'opencode':
      default:
        if (opencodeMode === 'serve' && this.opencodeServerManager && this.opencodeSessionRegistry) {
          const sessionExecutor = createOpenCodeSessionExecutor(
            { baseUrl: config.opencodeServe.serveBaseUrl, timeout: config.worker.jobTimeout },
            this.opencodeSessionRegistry,
          );
          this.workerExecutor.registerAdapter(new OpenCodeServeAdapter({
            workerType: 'claude_code',
            serverManager: this.opencodeServerManager,
            sessionRegistry: this.opencodeSessionRegistry,
            sessionExecutor,
            model: config.worker.claudeModel,
            debug: config.worker.debugMode,
          }));
          logger.info('Registered OpenCodeServeAdapter for claude_code');
        } else {
          this.workerExecutor.registerAdapter(new OpenCodeAdapter({
            workerType: 'claude_code',
            model: config.worker.claudeModel,
          }));
          logger.info('Registered OpenCodeAdapter (run mode) for claude_code');
        }
        break;
    }

    this.workerExecutor.registerAdapter(new AntigravityAdapter({
      workerType: 'google_antigravity',
      model: config.worker.antigravityModel,
      auth: {
        type: 'api_key',
        value: config.apiKeys.googleApiKey || config.apiKeys.geminiApiKey,
      },
    }));

    await this.workerExecutor.initialize();
    this.workerInitialized = true;
  }

  /**
   * Dispatch a job for a task.
   */
  async dispatch(
    taskId: string,
    request: DispatchRequest,
    ctx: JobOperationContext,
  ): Promise<WorkerJob> {
    // Ensure worker is initialized
    await this.initialize();

    const task = ctx.requireTask(taskId);
    const dispatchResult = this.dispatchOrchestrator.dispatch(
      task,
      request,
      this.jobs,
      this.retryTracker,
      {
        requireTask: (id) => ctx.requireTask(id),
        transitionTask: (t, toState, input) => ctx.transitionTask(t, toState, input),
        emitAuditEvent: (tid, eventType, payload, options) => ctx.emitAuditEvent(tid, eventType, payload, options),
      },
    );

    // Handle blocked dispatch (capability mismatch)
    if (!dispatchResult.success) {
      // Transition task to blocked state with capability missing info
      const blockedTask: Task = {
        ...task,
        blocked_context: {
          resume_state: dispatchResult.resume_state,
          reason: 'insufficient_capability',
          capability_missing: dispatchResult.missing_capabilities,
          waiting_on: 'worker',
        },
      };
      ctx.transitionTask(blockedTask, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: `capability mismatch for ${request.target_stage}: missing [${dispatchResult.missing_capabilities.join(', ')}]`,
      });

      // Record capability mismatch metrics
      const metrics = getMetricsCollector();
      for (const capability of dispatchResult.missing_capabilities) {
        metrics.recordCapabilityMismatch(request.target_stage, capability);
      }

      throw new Error(`cannot dispatch: missing capabilities [${dispatchResult.missing_capabilities.join(', ')}]`);
    }

    const { job, nextState } = dispatchResult;

    // Submit job using the worker selected during dispatch.
    const submissionResult = await this.workerExecutor.submitJob(job, job.worker_type);

    if (!submissionResult.success) {
      throw new Error(`Failed to submit job: ${submissionResult.error}`);
    }

    // Start polling for job completion in background (skip in test environment)
    // In tests, results are submitted manually via the results endpoint
    if (process.env.VITEST !== 'true') {
      this.pollJobCompletion(job.job_id, ctx);
    }

    // Create updated task with dispatch info - use explicit property assignment to prevent injection
    const latestJobIds: Record<string, string> = { ...(task.latest_job_ids ?? {}) };
    // Explicitly set the job_id for the validated stage (TypeScript ensures only these values)
    if (request.target_stage === 'plan') {
      latestJobIds['plan'] = job.job_id;
    } else if (request.target_stage === 'dev') {
      latestJobIds['dev'] = job.job_id;
    } else if (request.target_stage === 'acceptance') {
      latestJobIds['acceptance'] = job.job_id;
    }
    const updatedTask: Task = {
      ...task,
      active_job_id: job.job_id,
      latest_job_ids: latestJobIds,
      workspace_ref: job.workspace_ref,
    };

    ctx.transitionTask(updatedTask, nextState, {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: `dispatched ${request.target_stage} job`,
      job_id: job.job_id,
    });
    return job;
  }

  /**
   * Poll for job completion and apply results.
   */
  private async pollJobCompletion(jobId: string, ctx: JobOperationContext): Promise<void> {
    try {
      const result = await this.workerExecutor.waitForJob(jobId, 600000);
      // Apply result when job completes
      ctx.applyResult(this.jobs.get(jobId)?.task_id || '', result);
    } catch (error) {
      logger.error(error as Error, 'Job failed', { jobId });
    }
  }

  /**
   * Process a heartbeat for a job.
   */
  heartbeat(jobId: string, request: JobHeartbeatRequest): JobHeartbeatResponse {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`job not found: ${jobId}`);
    }

    const response = this.deps.leaseManager.heartbeat(jobId, request.worker_id, {
      stage: request.stage,
      progress: request.progress,
      observed_at: request.observed_at,
    });

    if (!response) {
      throw new Error('heartbeat rejected: not lease owner or job orphaned');
    }

    return {
      job_id: jobId,
      lease_expires_at: response.lease_expires_at,
      next_heartbeat_due_at: response.next_heartbeat_due_at,
      last_heartbeat_at: response.last_heartbeat_at,
    };
  }

  /**
   * Get a job by ID with its latest result.
   */
  getJob(jobId: string): { job?: WorkerJob; latest_result?: WorkerResult } {
    return {
      job: this.jobs.get(jobId),
      latest_result: this.results.get(jobId),
    };
  }

  /**
   * Get all jobs for a task.
   */
  getJobsForTask(taskId: string): WorkerJob[] {
    return Array.from(this.jobs.values()).filter(j => j.task_id === taskId);
  }

  /**
   * Store a job.
   */
  setJob(jobId: string, job: WorkerJob): void {
    this.jobs.set(jobId, job);
  }

  /**
   * Store a result.
   */
  setResult(jobId: string, result: WorkerResult): void {
    this.results.set(jobId, result);
  }

  /**
   * Get a result by job ID.
   */
  getResult(jobId: string): WorkerResult | undefined {
    return this.results.get(jobId);
  }

  /**
   * Get the jobs map for use by DispatchOrchestrator.
   */
  getJobsMap(): Map<string, WorkerJob> {
    return this.jobs;
  }

  /**
   * Get the retry tracker for use by DispatchOrchestrator.
   */
  getRetryTracker(): Map<string, number> {
    return this.retryTracker;
  }

  /**
   * Get the lease manager.
   */
  getLeaseManager(): LeaseManager {
    return this.deps.leaseManager;
  }

  /**
   * Check if a job can be dispatched with a valid lease.
   */
  canDispatchWithLease(taskId: string, targetStage: 'plan' | 'dev' | 'acceptance', getTask: (id: string) => Task | undefined): boolean {
    const task = getTask(taskId);
    if (!task) return false;

    // For developing stage, ensure lease is acquired first
    if (targetStage === 'dev' && task.state === 'planned') {
      const jobId = task.active_job_id;
      if (!jobId) return false;

      const lease = this.deps.leaseManager.getLease(jobId);
      if (!lease || this.deps.leaseManager.isExpired(jobId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clear all jobs and results (useful for testing).
   */
  clear(): void {
    this.jobs.clear();
    this.results.clear();
    this.retryTracker.clear();
  }
}
