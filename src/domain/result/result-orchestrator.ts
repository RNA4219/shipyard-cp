import type {
  Task,
  WorkerJob,
  WorkerResult,
  WorkerStage,
  WorkerType,
  StateTransitionEvent,
  FailureClass,
  ResultApplyResponse,
  AuditEventType,
} from '../../types.js';
import { getArtifactIds } from '../../store/utils.js';
import type { RetryManager } from '../retry/index.js';
import type { DoomLoopDetector } from '../doom-loop/index.js';
import type { LeaseManager } from '../lease/index.js';
import type { ConcurrencyManager } from '../concurrency/index.js';
import type { SideEffectAnalyzer } from '../side-effect/index.js';
import { WorkerPolicy } from '../worker/worker-policy.js';
import { getLogger } from '../../monitoring/index.js';

/**
 * Context for result operations
 */
export interface ResultContext {
  requireTask(taskId: string): Task;
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): StateTransitionEvent;
  stageToActiveState(stage: WorkerStage): 'planning' | 'developing' | 'accepting';
  touchTask(task: Task): void;
  emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options?: { jobId?: string },
  ): void;
}

/**
 * Dependencies for ResultOrchestrator
 */
export interface ResultDeps {
  retryManager: RetryManager;
  doomLoopDetector: DoomLoopDetector;
  leaseManager: LeaseManager;
  concurrencyManager: ConcurrencyManager;
  sideEffectAnalyzer: SideEffectAnalyzer;
}

/**
 * Orchestrates result handling workflow.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class ResultOrchestrator {
  constructor(private readonly deps: ResultDeps) {}

  /**
   * Apply a worker result to update task state.
   * Entry point for result handling.
   */
  applyResult(
    taskId: string,
    result: WorkerResult,
    task: Task,
    job: WorkerJob,
    results: Map<string, WorkerResult>,
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponse {
    results.set(result.job_id, result);
    const emittedEvents: StateTransitionEvent[] = [];

    // Update task metadata from result
    this.updateTaskFromResult(task, result, job, ctx);

    // Handle by status
    switch (result.status) {
      case 'blocked':
        return this.handleBlockedResult(task, job, result, emittedEvents, ctx);
      case 'failed':
        return this.handleFailedResult(task, job, result, emittedEvents, retryTracker, ctx);
      default:
        return this.handleSucceededResultFinal(task, job, result, emittedEvents, ctx);
    }
  }

  /**
   * Update task with metadata from result.
   */
  private updateTaskFromResult(
    task: Task,
    result: WorkerResult,
    job: WorkerJob,
    ctx: ResultContext,
  ): void {
    // Merge artifacts
    task.artifacts = [
      ...(task.artifacts ?? []),
      ...result.artifacts.map((a) => ({
        artifact_id: a.artifact_id,
        kind: a.kind === 'html' ? 'other' as const : a.kind,
      })),
    ];

    // Merge resolver refs
    if (result.resolver_refs) {
      task.resolver_refs = { ...task.resolver_refs, ...result.resolver_refs };
    }

    // Merge external refs
    if (result.external_refs) {
      const existing = task.external_refs ?? [];
      const existingValues = new Set(existing.map(e => e.value));
      const uniqueNew = result.external_refs.filter(e => !existingValues.has(e.value));
      task.external_refs = [...existing, ...uniqueNew];
    }

    // Update other fields
    if (result.context_bundle_ref) {
      task.context_bundle_ref = result.context_bundle_ref;
    }
    if (result.rollback_notes) {
      task.rollback_notes = result.rollback_notes;
    }
    if (result.verdict) {
      task.last_verdict = {
        outcome: result.verdict.outcome,
        reason: result.verdict.reason,
        manual_notes: result.verdict.manual_notes,
      };
    }

    // Integration: retry_count - store in task
    if (result.retry_count !== undefined) {
      task.retry_counts = {
        ...task.retry_counts,
        [job.stage]: result.retry_count,
      };
    }

    // Integration: failure_class - store in task
    if (result.failure_class) {
      task.last_failure_class = result.failure_class;
    }

    // Integration: loop_fingerprint - validate and store
    if (result.loop_fingerprint) {
      // Verify fingerprint matches job's fingerprint
      if (job.loop_fingerprint && result.loop_fingerprint !== job.loop_fingerprint) {
        // Log warning but don't fail - fingerprint mismatch could indicate issue
        const logger = getLogger().child({ component: 'ResultOrchestrator', taskId: task.task_id, jobId: job.job_id });
        logger.warn('Loop fingerprint mismatch', {
          jobFingerprint: job.loop_fingerprint,
          resultFingerprint: result.loop_fingerprint,
        });
      }
      task.loop_fingerprint = result.loop_fingerprint;
    }

    // Integration: detected_side_effects - analyze and store
    if (result.detected_side_effects) {
      task.detected_side_effects = result.detected_side_effects;
    } else if (result.requested_escalations?.length > 0) {
      // Analyze escalations for side effects if not provided
      const sideEffectResult = this.deps.sideEffectAnalyzer.analyzeSideEffects({
        requested_outputs: job.requested_outputs ?? [],
        escalation_requests: result.requested_escalations.map(e => e.kind),
      });
      task.detected_side_effects = sideEffectResult.categories;
    }

    // Emit audit event for permission escalation requests
    if (result.requested_escalations?.length > 0) {
      ctx.emitAuditEvent(task.task_id, 'run.permissionEscalated', {
        escalations: result.requested_escalations.map(e => ({
          kind: e.kind,
          reason: e.reason,
          approved: e.approved,
        })),
        stage: job.stage,
      }, { jobId: job.job_id });
    }
  }

  /**
   * Handle blocked result.
   */
  private handleBlockedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    task.blocked_context = {
      resume_state: ctx.stageToActiveState(job.stage),
      reason: result.summary ?? 'worker blocked',
      waiting_on: 'human',
    };
    emittedEvents.push(ctx.transitionTask(task, 'blocked', {
      actor_type: 'worker',
      actor_id: job.worker_type,
      reason: result.summary ?? 'worker blocked',
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));
    return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
  }

  /**
   * Handle failed result with retry/failover logic.
   */
  private handleFailedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponse {
    const failureClass = result.failure_class ?? this.deps.retryManager.classifyFromResult(result);
    const retryKey = `${task.task_id}:${job.stage}`;
    const currentRetryCount = result.retry_count ?? retryTracker.get(retryKey) ?? 0;
    const maxRetries = job.retry_policy?.max_retries ?? this.deps.retryManager.getDefaultMaxRetries(job.stage);

    // Check for doom loop first
    const loopResult = this.deps.doomLoopDetector.detectLoop(job.job_id);
    if (loopResult) {
      return this.handleDoomLoop(task, job, result, loopResult, emittedEvents, ctx);
    }

    // Check if we should failover (Plan stage only)
    if (WorkerPolicy.canFailover(job.stage)) {
      const failoverWorker = WorkerPolicy.getFailoverWorker(job.stage, job.worker_type);
      if (failoverWorker) {
        return this.handleFailover(task, job, result, failoverWorker, emittedEvents, ctx);
      }
    }

    // Check if we should retry (same worker)
    if (this.deps.retryManager.shouldRetry({ failure_class: failureClass, retry_count: currentRetryCount, max_retries: maxRetries })) {
      return this.handleRetry(task, job, result, retryKey, currentRetryCount, maxRetries, failureClass, emittedEvents, retryTracker, ctx);
    }

    // Max retries reached or non-retryable failure
    return this.handleFinalFailure(task, job, result, retryKey, failureClass, emittedEvents, ctx);
  }

  /**
   * Handle doom loop detection.
   */
  private handleDoomLoop(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    loopResult: { loop_type: string },
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    task.blocked_context = {
      resume_state: ctx.stageToActiveState(job.stage),
      reason: `Doom loop detected: ${loopResult.loop_type}`,
      waiting_on: 'policy',
      loop_fingerprint: job.loop_fingerprint,
    };
    emittedEvents.push(ctx.transitionTask(task, 'blocked', {
      actor_type: 'policy_engine',
      actor_id: 'doom_loop_detector',
      reason: `doom loop detected: ${loopResult.loop_type}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));
    this.finalizeJob(task, job, false);
    return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
  }

  /**
   * Handle retry scenario.
   */
  private handleRetry(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    currentRetryCount: number,
    maxRetries: number,
    failureClass: FailureClass,
    emittedEvents: StateTransitionEvent[],
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponse {
    retryTracker.set(retryKey, currentRetryCount + 1);

    const nextState = ctx.stageToActiveState(job.stage);
    emittedEvents.push(ctx.transitionTask(task, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'retry_manager',
      reason: `retry ${currentRetryCount + 1}/${maxRetries} after ${failureClass}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    // Release lease but keep concurrency for retry
    this.deps.leaseManager.release(job.job_id, job.worker_type);
    task.active_job_id = undefined;
    ctx.touchTask(task);

    const backoffSeconds = this.deps.retryManager.calculateBackoff(
      currentRetryCount,
      job.retry_policy ?? { max_retries: maxRetries, backoff_base_seconds: 2, max_backoff_seconds: 60, jitter_enabled: true }
    );

    return {
      task,
      emitted_events: emittedEvents,
      next_action: 'retry',
      retry_scheduled_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
    };
  }

  /**
   * Handle failover to different worker.
   */
  private handleFailover(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    nextWorker: WorkerType,
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    // Emit failover audit event
    ctx.emitAuditEvent(task.task_id, 'run.workerFailover', {
      from_worker: job.worker_type,
      to_worker: nextWorker,
      stage: job.stage,
      reason: result.summary ?? 'worker failed',
    }, { jobId: job.job_id });

    // Finalize current job (release lease but keep concurrency for next dispatch)
    this.deps.leaseManager.release(job.job_id, job.worker_type);
    task.active_job_id = undefined;
    ctx.touchTask(task);

    const nextState = ctx.stageToActiveState(job.stage);
    emittedEvents.push(ctx.transitionTask(task, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'failover_manager',
      reason: `failover to ${nextWorker} after ${job.worker_type} failure`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    return {
      task,
      emitted_events: emittedEvents,
      next_action: 'failover',
      failover_worker: nextWorker,
    };
  }

  /**
   * Handle final failure after all retries exhausted.
   */
  private handleFinalFailure(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    failureClass: FailureClass,
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    emittedEvents.push(ctx.transitionTask(task, 'rework_required', {
      actor_type: 'worker',
      actor_id: job.worker_type,
      reason: result.summary ?? `failed (${failureClass}, retries exhausted)`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    }));

    this.finalizeJob(task, job, true);
    return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
  }

  /**
   * Handle succeeded result with finalization.
   */
  private handleSucceededResultFinal(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    const outcome = this.handleSucceededResult(task, job, result, emittedEvents, ctx);
    this.finalizeJob(task, job, true);
    return outcome;
  }

  /**
   * Handle succeeded result based on stage.
   */
  private handleSucceededResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    ctx: ResultContext,
  ): ResultApplyResponse {
    const artifactIds = getArtifactIds(result);

    switch (job.stage) {
      case 'plan':
        emittedEvents.push(ctx.transitionTask(task, 'planned', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'plan completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };

      case 'dev':
        emittedEvents.push(ctx.transitionTask(task, 'dev_completed', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'dev completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        }));
        return { task, emitted_events: emittedEvents, next_action: 'dispatch_acceptance' };

      case 'acceptance': {
        // Acceptance requires manual confirmation
        // Worker result provides recommendation, but human must complete checklist
        const verdict = result.verdict;

        // If worker rejected or requires rework, transition immediately
        if (verdict?.outcome === 'reject' || verdict?.outcome === 'rework') {
          emittedEvents.push(ctx.transitionTask(task, 'rework_required', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: verdict.reason ?? 'acceptance rejected by worker',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          }));
          return { task, emitted_events: emittedEvents, next_action: 'dispatch_dev' };
        }

        // For 'accept' or 'needs_manual_review', stay in 'accepting' state
        // and wait for manual checklist completion via completeAcceptance
        // Store the verdict for later use
        task.last_verdict = verdict ? {
          outcome: verdict.outcome,
          reason: verdict.reason,
          manual_notes: verdict.manual_notes,
        } : undefined;

        // Don't transition - wait for manual acceptance
        // The task stays in 'accepting' state until completeAcceptance is called
        return { task, emitted_events: emittedEvents, next_action: 'wait_manual' };
      }
    }
  }

  /**
   * Finalize a job by releasing resources.
   */
  private finalizeJob(task: Task, job: WorkerJob, releaseConcurrency: boolean): void {
    this.deps.leaseManager.release(job.job_id, job.worker_type);
    if (releaseConcurrency) {
      this.deps.concurrencyManager.recordComplete({
        job_id: job.job_id,
        worker_id: job.worker_type,
      });
    }
    task.active_job_id = undefined;
  }
}