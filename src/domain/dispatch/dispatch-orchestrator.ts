import type {
  Task,
  WorkerJob,
  DispatchRequest,
  WorkerStage,
  WorkerType,
  StateTransitionEvent,
  AuditEventType,
  Capability,
} from '../../types.js';
import { createId, generateLoopFingerprint, DEFAULT_WORKER_CAPABILITIES } from '../../store/utils.js';
import type { CapabilityManager } from '../capability/index.js';
import type { ConcurrencyManager } from '../concurrency/index.js';
import type { LeaseManager } from '../lease/index.js';
import type { RetryManager } from '../retry/index.js';
import type { DoomLoopDetector } from '../doom-loop/index.js';
import type { StateMachine } from '../state-machine/index.js';
import { WorkerPolicy } from '../worker/index.js';
import type { CapabilityCheckResult } from '../capability/types.js';

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
  emitAuditEvent?(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options?: { jobId?: string },
  ): void;
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
 * Result of a successful dispatch operation
 */
export interface DispatchSuccessResult {
  success: true;
  job: WorkerJob;
  nextState: 'planning' | 'developing' | 'accepting';
}

/**
 * Result of a blocked dispatch operation (capability mismatch)
 */
export interface DispatchBlockedResult {
  success: false;
  blocked: true;
  reason: 'insufficient_capability';
  missing_capabilities: Capability[];
  resume_state: 'planning' | 'developing' | 'accepting';
}

/**
 * Result of a dispatch operation
 */
export type DispatchResult = DispatchSuccessResult | DispatchBlockedResult;

/**
 * Options for checking capabilities during dispatch
 */
export interface CapabilityCheckOptions {
  requires_network?: boolean;
  under_approval_flow?: boolean;
  produces_patch_artifact?: boolean;
}

/**
 * Orchestrates job dispatch workflow.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class DispatchOrchestrator {
  constructor(private readonly deps: DispatchDeps) {}

  /**
   * Dispatch a new job for a task.
   * Returns the created job and next state on success.
   * Returns blocked result if capability check fails.
   *
   * According to ADD_REQUIREMENTS.md section 4:
   * - Capability check is a required guard before stage transition
   * - If capabilities are missing, job is NOT dispatched
   * - Task should transition to 'blocked' with insufficient_capability reason
   */
  dispatch(
    task: Task,
    request: DispatchRequest,
    jobs: Map<string, WorkerJob>,
    retryTracker: Map<string, number>,
    ctx: DispatchContext,
    capabilityOptions?: CapabilityCheckOptions,
  ): DispatchResult {
    const allowedStage = this.deps.stateMachine.getAllowedDispatchStage(task.state);
    if (allowedStage !== request.target_stage) {
      throw new Error(`state ${task.state} cannot dispatch ${request.target_stage}`);
    }

    const workerType = request.worker_selection ?? WorkerPolicy.getDefaultWorker(request.target_stage);
    const riskLevel = request.override_risk_level ?? task.risk_level;

    // Capability check before dispatch (ADD_REQUIREMENTS.md section 4)
    const capabilityResult = this.checkWorkerCapabilities(
      workerType,
      request.target_stage,
      capabilityOptions,
    );

    if (!capabilityResult.passed) {
      // Emit capability_mismatch audit event
      if (ctx.emitAuditEvent) {
        ctx.emitAuditEvent(task.task_id, 'capability_mismatch', {
          stage: request.target_stage,
          worker_type: workerType,
          missing_capabilities: capabilityResult.missing,
          required_capabilities: capabilityResult.required,
          present_capabilities: capabilityResult.present,
        });
      }

      // Return blocked result - do NOT dispatch job
      const resumeState = this.deps.stateMachine.stageToActiveState(request.target_stage);
      return {
        success: false,
        blocked: true,
        reason: 'insufficient_capability',
        missing_capabilities: capabilityResult.missing,
        resume_state: resumeState,
      };
    }

    // Concurrency check
    const concurrencyResult = this.deps.concurrencyManager.canAccept({
      worker_id: workerType,
      stage: request.target_stage,
    });
    if (!concurrencyResult.accepted) {
      // Emit lock_conflict audit event if due to concurrency limits
      if (ctx.emitAuditEvent) {
        ctx.emitAuditEvent(task.task_id, 'lock_conflict', {
          stage: request.target_stage,
          worker_type: workerType,
          reason: concurrencyResult.reason,
        });
      }
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
      capability_requirements: capabilityResult.required,
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

    return { success: true, job, nextState };
  }

  /**
   * Check worker capabilities against required capabilities for a stage.
   * Includes conditional capabilities based on job requirements.
   */
  private checkWorkerCapabilities(
    workerType: WorkerType,
    stage: WorkerStage,
    options?: CapabilityCheckOptions,
  ): CapabilityCheckResult {
    // Get worker capabilities
    let workerCapabilities = this.deps.capabilityManager.getWorkerCapabilities(workerType);

    // If worker has no registered capabilities, try to register defaults
    if (workerCapabilities.length === 0) {
      const defaultCaps = DEFAULT_WORKER_CAPABILITIES[workerType];
      if (defaultCaps) {
        this.deps.capabilityManager.registerWorkerCapabilities(workerType, defaultCaps);
        workerCapabilities = this.deps.capabilityManager.getWorkerCapabilities(workerType);
      }
    }

    // Get all required capabilities including conditional ones
    const requiredCapabilities = this.deps.capabilityManager.getAllRequiredCapabilities({
      stage,
      worker_capabilities: workerCapabilities,
      requires_network: options?.requires_network,
      under_approval_flow: options?.under_approval_flow,
      produces_patch_artifact: options?.produces_patch_artifact,
    });

    return this.deps.capabilityManager.checkCapabilities(requiredCapabilities, workerCapabilities);
  }

  private buildPrompt(task: Task, stage: WorkerStage): string {
    return `${stage.toUpperCase()} task: ${task.title}${task.description ? `\n\n${task.description}` : ''}`;
  }
}