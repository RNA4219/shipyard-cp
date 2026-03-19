import type {
  Task,
  WorkerJob,
  DispatchRequest,
  WorkerStage,
  WorkerType,
  StateTransitionEvent,
} from '../../types.js';
import { createId, generateLoopFingerprint, DEFAULT_WORKER_CAPABILITIES } from '../../store/utils.js';
import type { CapabilityManager, Capability } from '../capability/index.js';
import type { ConcurrencyManager } from '../concurrency/index.js';
import type { LeaseManager } from '../lease/index.js';
import type { RetryManager } from '../retry/index.js';
import type { DoomLoopDetector } from '../doom-loop/index.js';
import type { StateMachine } from '../state-machine/index.js';
import { WorkerPolicy } from '../worker/index.js';

/**
 * Context for dispatch operations
 */
export interface DispatchContext {
  requireTask(taskId: string): Task;
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: { actor_type: StateTransitionEvent['actor_type']; actor_id: string; reason: string; job_id?: string },
  ): { event: StateTransitionEvent; task: Task };
}

/**
 * Dependencies for DispatchOrchestrator
 */
export interface DispatchDeps {
  capabilityManager: CapabilityManager;
  concurrencyManager: ConcurrencyManager;
  leaseManager: LeaseManager;
  retryManager: RetryManager;
  doomLoopDetector: DoomLoopDetector;
  stateMachine: StateMachine;
}

/**
 * Result of a dispatch operation
 */
export interface DispatchResult {
  job: WorkerJob;
  nextState: 'planning' | 'developing' | 'accepting';
}

/**
 * Orchestrates job dispatch workflow.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class DispatchOrchestrator {
  constructor(private readonly deps: DispatchDeps) {}

  /**
   * Dispatch a new job for a task.
   * Returns the created job and next state.
   */
  dispatch(
    task: Task,
    request: DispatchRequest,
    jobs: Map<string, WorkerJob>,
    retryTracker: Map<string, number>,
    _ctx: DispatchContext,
  ): DispatchResult {
    const allowedStage = this.deps.stateMachine.getAllowedDispatchStage(task.state);
    if (allowedStage !== request.target_stage) {
      throw new Error(`state ${task.state} cannot dispatch ${request.target_stage}`);
    }

    const workerType = request.worker_selection ?? WorkerPolicy.getDefaultWorker(request.target_stage);
    const riskLevel = request.override_risk_level ?? task.risk_level;

    // Capability check before dispatch
    const workerCapabilities = this.deps.capabilityManager.getWorkerCapabilities(workerType);
    const capabilityResult = this.deps.capabilityManager.validateCapabilities({
      stage: request.target_stage,
      worker_capabilities: workerCapabilities,
    });
    if (!capabilityResult.valid) {
      // Auto-register default capabilities for known worker types
      this.registerDefaultCapabilities(workerType);
    }

    // Concurrency check
    const concurrencyResult = this.deps.concurrencyManager.canAccept({
      worker_id: workerType,
      stage: request.target_stage,
    });
    if (!concurrencyResult.accepted) {
      throw new Error(`cannot dispatch: ${concurrencyResult.reason}`);
    }

    // Build context with resolver and tracker refs
    const context = {
      objective: task.objective,
      resolver_refs: task.resolver_refs ? {
        doc_refs: task.resolver_refs.doc_refs,
        chunk_refs: task.resolver_refs.chunk_refs,
        contract_refs: task.resolver_refs.contract_refs,
      } : undefined,
      tracker_refs: task.external_refs?.map(ref => ({
        kind: 'typed_ref' as const,
        value: ref.value,
      })),
    };

    // Generate loop fingerprint for this task+stage combination
    const loopFingerprint = generateLoopFingerprint(task.task_id, request.target_stage);

    // Get or initialize retry count
    const retryKey = `${task.task_id}:${request.target_stage}`;
    const retryCount = retryTracker.get(retryKey) ?? 0;

    // Get default retry policy for stage
    const maxRetries = this.deps.retryManager.getDefaultMaxRetries(request.target_stage);

    // Issue lease for the job
    const jobId = createId('job');
    const lease = this.deps.leaseManager.acquire(jobId, workerType);
    if (!lease) {
      throw new Error('Failed to acquire lease for job');
    }

    const job: WorkerJob = {
      job_id: jobId,
      task_id: task.task_id,
      typed_ref: task.typed_ref,
      stage: request.target_stage,
      worker_type: workerType,
      workspace_ref: task.workspace_ref ?? {
        workspace_id: `ws_${task.task_id}`,
        kind: 'container',
        reusable: true,
      },
      input_prompt: this.buildPrompt(task, request.target_stage),
      repo_ref: task.repo_ref,
      capability_requirements: WorkerPolicy.getCapabilityRequirements(request.target_stage),
      risk_level: riskLevel,
      approval_policy: WorkerPolicy.buildApprovalPolicy(request.target_stage, riskLevel),
      retry_policy: {
        max_retries: maxRetries,
        backoff_base_seconds: 2,
        max_backoff_seconds: 60,
        jitter_enabled: true,
      },
      retry_count: retryCount,
      loop_fingerprint: loopFingerprint,
      lease_owner: lease.lease_owner,
      lease_expires_at: lease.lease_expires_at,
      context,
      requested_outputs: WorkerPolicy.getRequestedOutputs(request.target_stage),
    };

    const nextState = this.deps.stateMachine.stageToActiveState(request.target_stage);
    jobs.set(job.job_id, job);

    // Record concurrency
    this.deps.concurrencyManager.recordStart({
      job_id: job.job_id,
      worker_id: workerType,
      stage: request.target_stage,
    });

    // Track transition for doom-loop detection
    this.deps.doomLoopDetector.trackTransition({
      job_id: job.job_id,
      from_state: task.state,
      to_state: nextState,
      stage: request.target_stage,
    });

    return { job, nextState };
  }

  private registerDefaultCapabilities(workerType: WorkerType): void {
    const caps: Capability[] = DEFAULT_WORKER_CAPABILITIES[workerType] ?? ['read' as Capability];
    this.deps.capabilityManager.registerWorkerCapabilities(workerType, caps);
  }

  private buildPrompt(task: Task, stage: WorkerStage): string {
    return `${stage.toUpperCase()} task: ${task.title}${task.description ? `\n\n${task.description}` : ''}`;
  }
}