import type {
  Task,
  WorkerJob,
  WorkerResult,
  WorkerType,
  StateTransitionEvent,
  FailureClass,
  ResultApplyResponse,
  AuditEventType,
  CompleteAcceptanceRequest,
} from '../../types.js';
import type { TaskUpdate } from '../task/index.js';
import { applyTaskUpdate, mergeTaskUpdates } from '../task/index.js';
import { getArtifactIds } from '../../store/utils.js';
import type { RetryManager } from '../retry/index.js';
import type { DoomLoopDetector } from '../doom-loop/index.js';
import type { LeaseManager } from '../lease/index.js';
import type { ConcurrencyManager } from '../concurrency/index.js';
import type { SideEffectAnalyzer } from '../side-effect/index.js';
import type { StateMachine } from '../state-machine/index.js';
import { WorkerPolicy } from '../worker/worker-policy.js';
import { getLogger } from '../../monitoring/index.js';

/**
 * Check if a result is from a LiteLLM failure.
 */
function isLiteLLMFailureResult(result: WorkerResult): boolean {
  return (
    result.status === 'blocked' &&
    result.metadata?.litellm_error_type !== undefined
  );
}

/**
 * Extended response with task updates
 */
export interface ResultApplyResponseWithUpdates extends ResultApplyResponse {
  taskUpdates: TaskUpdate;
}

/**
 * Context for result operations
 */
export interface ResultContext {
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): { event: StateTransitionEvent; task: Task };
  emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options?: { jobId?: string },
  ): void;
  setTask?(taskId: string, task: Task): void;
  completeAcceptance?(taskId: string, request: CompleteAcceptanceRequest): Task;
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
  stateMachine: StateMachine;
}

/**
 * Orchestrates result handling workflow.
 * Extracted from ControlPlaneStore to reduce complexity.
 * Returns TaskUpdate objects instead of mutating Task directly.
 */
export class ResultOrchestrator {
  constructor(private readonly deps: ResultDeps) {}

  /**
   * Apply a worker result to update task state.
   * Entry point for result handling.
   * Returns updates to be applied by the caller.
   */
  applyResult(
    result: WorkerResult,
    task: Task,
    job: WorkerJob,
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const emittedEvents: StateTransitionEvent[] = [];
    const taskUpdates = this.computeTaskUpdatesFromResult(task, result, job, ctx);

    // Handle by status
    switch (result.status) {
      case 'blocked':
        return this.handleBlockedResult(task, job, result, emittedEvents, taskUpdates, ctx);
      case 'failed':
        return this.handleFailedResult(task, job, result, emittedEvents, taskUpdates, retryTracker, ctx);
      default:
        return this.handleSucceededResultFinal(task, job, result, emittedEvents, taskUpdates, ctx);
    }
  }

  /**
   * Compute task updates from result without mutating.
   */
  private computeTaskUpdatesFromResult(
    task: Task,
    result: WorkerResult,
    job: WorkerJob,
    ctx: ResultContext,
  ): TaskUpdate {
    const updates: TaskUpdate[] = [];

    // Merge artifacts
    const newArtifacts = result.artifacts?.map((a) => ({
      artifact_id: a.artifact_id,
      kind: a.kind === 'html' ? 'other' as const : a.kind,
    })) ?? [];
    if (newArtifacts.length > 0) {
      updates.push({ mergeArtifacts: newArtifacts });
    }

    // Merge resolver refs
    if (result.resolver_refs) {
      updates.push({ mergeResolverRefs: result.resolver_refs });
    }

    // Merge external refs
    if (result.external_refs && result.external_refs.length > 0) {
      updates.push({ mergeExternalRefs: result.external_refs });
    }

    // Update other fields
    if (result.context_bundle_ref) {
      updates.push({ context_bundle_ref: result.context_bundle_ref });
    }
    if (result.rollback_notes) {
      updates.push({ rollback_notes: result.rollback_notes });
    }
    if (result.verdict) {
      updates.push({
        last_verdict: {
          outcome: result.verdict.outcome,
          reason: result.verdict.reason,
          manual_notes: result.verdict.manual_notes,
        },
      });
    }

    // Integration: retry_count - store in task
    if (result.retry_count !== undefined) {
      updates.push({ retry_counts: { [job.stage]: result.retry_count } });
    }

    // Integration: failure_class - store in task
    if (result.failure_class) {
      updates.push({ last_failure_class: result.failure_class });
    }

    // Integration: loop_fingerprint - validate and store
    if (result.loop_fingerprint) {
      // Verify fingerprint matches job's fingerprint
      if (job.loop_fingerprint && result.loop_fingerprint !== job.loop_fingerprint) {
        const logger = getLogger().child({ component: 'ResultOrchestrator', taskId: task.task_id, jobId: job.job_id });
        logger.warn('Loop fingerprint mismatch', {
          jobFingerprint: job.loop_fingerprint,
          resultFingerprint: result.loop_fingerprint,
        });
      }
      updates.push({ loop_fingerprint: result.loop_fingerprint });
    }

    // Integration: detected_side_effects - analyze and store
    if (result.detected_side_effects) {
      updates.push({ detected_side_effects: result.detected_side_effects });
    } else if (result.requested_escalations?.length > 0) {
      const sideEffectResult = this.deps.sideEffectAnalyzer.analyzeSideEffects({
        requested_outputs: job.requested_outputs ?? [],
        escalation_requests: result.requested_escalations.map(e => e.kind),
      });
      updates.push({ detected_side_effects: sideEffectResult.categories });
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

    return mergeTaskUpdates(...updates);
  }

  /**
   * Handle blocked result.
   */
  private handleBlockedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const blockedUpdate: TaskUpdate = {
      blocked_context: {
        resume_state: this.deps.stateMachine.stageToActiveState(job.stage),
        reason: result.summary ?? 'worker blocked',
        waiting_on: 'human',
      },
    };

    const updatedTask = applyTaskUpdate(task, mergeTaskUpdates(taskUpdates, blockedUpdate));
    const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'blocked', {
      actor_type: 'worker',
      actor_id: job.worker_type,
      reason: result.summary ?? 'worker blocked',
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    });
    emittedEvents.push(event);

    // Emit LiteLLM failure audit event if this was a LiteLLM failure
    if (isLiteLLMFailureResult(result) && result.metadata) {
      ctx.emitAuditEvent(task.task_id, 'run.litellmFailed', {
        error_type: result.metadata.litellm_error_type as string,
        error_message: result.metadata.litellm_error_message as string,
        retryable: result.metadata.litellm_retryable as boolean,
        model: result.usage?.litellm?.model,
        blocked: true,
        stage: job.stage,
      }, { jobId: job.job_id });
    }

    return {
      task: transitionedTask,
      emitted_events: emittedEvents,
      next_action: 'wait_manual',
      taskUpdates: mergeTaskUpdates(taskUpdates, blockedUpdate),
    };
  }

  /**
   * Handle failed result with retry/failover logic.
   */
  private handleFailedResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    taskUpdates: TaskUpdate,
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const failureClass = result.failure_class ?? this.deps.retryManager.classifyFromResult(result);
    const retryKey = `${task.task_id}:${job.stage}`;
    const currentRetryCount = result.retry_count ?? retryTracker.get(retryKey) ?? 0;
    const maxRetries = job.retry_policy?.max_retries ?? this.deps.retryManager.getDefaultMaxRetries(job.stage);

    // Check for doom loop first
    const loopResult = this.deps.doomLoopDetector.detectLoop(job.job_id);
    if (loopResult) {
      return this.handleDoomLoop(task, job, result, loopResult, emittedEvents, taskUpdates, ctx);
    }

    // Check if we should failover (Plan stage only)
    if (WorkerPolicy.canFailover(job.stage)) {
      const failoverWorker = WorkerPolicy.getFailoverWorker(job.stage, job.worker_type);
      if (failoverWorker) {
        return this.handleFailover(task, job, result, failoverWorker, emittedEvents, taskUpdates, ctx);
      }
    }

    // Check if we should retry (same worker)
    if (this.deps.retryManager.shouldRetry({ failure_class: failureClass, retry_count: currentRetryCount, max_retries: maxRetries })) {
      return this.handleRetry(task, job, result, retryKey, currentRetryCount, maxRetries, failureClass, emittedEvents, taskUpdates, retryTracker, ctx);
    }

    // Max retries reached or non-retryable failure
    return this.handleFinalFailure(task, job, result, failureClass, emittedEvents, taskUpdates, ctx);
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
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const blockedUpdate: TaskUpdate = {
      blocked_context: {
        resume_state: this.deps.stateMachine.stageToActiveState(job.stage),
        reason: `Doom loop detected: ${loopResult.loop_type}`,
        waiting_on: 'policy',
        loop_fingerprint: job.loop_fingerprint,
      },
      active_job_id: undefined,
    };

    const updatedTask = applyTaskUpdate(task, mergeTaskUpdates(taskUpdates, blockedUpdate));
    const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'blocked', {
      actor_type: 'policy_engine',
      actor_id: 'doom_loop_detector',
      reason: `doom loop detected: ${loopResult.loop_type}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    });
    emittedEvents.push(event);

    this.finalizeJob(job, false);

    return {
      task: transitionedTask,
      emitted_events: emittedEvents,
      next_action: 'wait_manual',
      taskUpdates: mergeTaskUpdates(taskUpdates, blockedUpdate),
    };
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
    taskUpdates: TaskUpdate,
    retryTracker: Map<string, number>,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    retryTracker.set(retryKey, currentRetryCount + 1);

    // Emit retry_triggered audit event
    ctx.emitAuditEvent(task.task_id, 'retry_triggered', {
      stage: job.stage,
      worker_type: job.worker_type,
      retry_count: currentRetryCount + 1,
      max_retries: maxRetries,
      failure_class: failureClass,
      reason: result.summary ?? `${failureClass} failure`,
    }, { jobId: job.job_id });

    const retryUpdate: TaskUpdate = { active_job_id: undefined };
    const updatedTask = applyTaskUpdate(task, mergeTaskUpdates(taskUpdates, retryUpdate));

    const nextState = this.deps.stateMachine.stageToActiveState(job.stage);
    const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'retry_manager',
      reason: `retry ${currentRetryCount + 1}/${maxRetries} after ${failureClass}`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    });
    emittedEvents.push(event);

    // Release lease but keep concurrency for retry
    this.deps.leaseManager.release(job.job_id, job.worker_type);

    const backoffSeconds = this.deps.retryManager.calculateBackoff(
      currentRetryCount,
      job.retry_policy ?? { max_retries: maxRetries, backoff_base_seconds: 2, max_backoff_seconds: 60, jitter_enabled: true }
    );

    return {
      task: transitionedTask,
      emitted_events: emittedEvents,
      next_action: 'retry',
      retry_scheduled_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      taskUpdates: mergeTaskUpdates(taskUpdates, retryUpdate),
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
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    // Emit failover audit event
    ctx.emitAuditEvent(task.task_id, 'run.workerFailover', {
      from_worker: job.worker_type,
      to_worker: nextWorker,
      stage: job.stage,
      reason: result.summary ?? 'worker failed',
    }, { jobId: job.job_id });

    // Finalize current job (release lease but keep concurrency for next dispatch)
    this.deps.leaseManager.release(job.job_id, job.worker_type);

    const failoverUpdate: TaskUpdate = { active_job_id: undefined };
    const updatedTask = applyTaskUpdate(task, mergeTaskUpdates(taskUpdates, failoverUpdate));

    const nextState = this.deps.stateMachine.stageToActiveState(job.stage);
    const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'failover_manager',
      reason: `failover to ${nextWorker} after ${job.worker_type} failure`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    });
    emittedEvents.push(event);

    return {
      task: transitionedTask,
      emitted_events: emittedEvents,
      next_action: 'failover',
      failover_worker: nextWorker,
      taskUpdates: mergeTaskUpdates(taskUpdates, failoverUpdate),
    };
  }

  /**
   * Handle final failure after all retries exhausted.
   */
  private handleFinalFailure(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    failureClass: FailureClass,
    emittedEvents: StateTransitionEvent[],
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const failUpdate: TaskUpdate = { active_job_id: undefined };
    const updatedTask = applyTaskUpdate(task, mergeTaskUpdates(taskUpdates, failUpdate));

    const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'rework_required', {
      actor_type: 'worker',
      actor_id: job.worker_type,
      reason: result.summary ?? `failed (${failureClass}, retries exhausted)`,
      job_id: job.job_id,
      artifact_ids: getArtifactIds(result),
    });
    emittedEvents.push(event);

    this.finalizeJob(job, true);

    return {
      task: transitionedTask,
      emitted_events: emittedEvents,
      next_action: 'dispatch_dev',
      taskUpdates: mergeTaskUpdates(taskUpdates, failUpdate),
    };
  }

  /**
   * Handle succeeded result with finalization.
   */
  private handleSucceededResultFinal(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const response = this.handleSucceededResult(task, job, result, emittedEvents, taskUpdates, ctx);
    this.finalizeJob(job, true);
    return response;
  }

  /**
   * Handle succeeded result based on stage.
   */
  private handleSucceededResult(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    emittedEvents: StateTransitionEvent[],
    taskUpdates: TaskUpdate,
    ctx: ResultContext,
  ): ResultApplyResponseWithUpdates {
    const artifactIds = getArtifactIds(result);

    switch (job.stage) {
      case 'plan': {
        const updatedTask = applyTaskUpdate(task, taskUpdates);
        const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'planned', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'plan completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        });
        emittedEvents.push(event);
        return { task: transitionedTask, emitted_events: emittedEvents, next_action: 'dispatch_dev', taskUpdates };
      }

      case 'dev': {
        const updatedTask = applyTaskUpdate(task, taskUpdates);
        const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'dev_completed', {
          actor_type: 'worker',
          actor_id: job.worker_type,
          reason: result.summary ?? 'dev completed',
          job_id: job.job_id,
          artifact_ids: artifactIds,
        });
        emittedEvents.push(event);
        return { task: transitionedTask, emitted_events: emittedEvents, next_action: 'dispatch_acceptance', taskUpdates };
      }

      case 'acceptance': {
        const verdict = result.verdict;

        // If worker rejected or requires rework, transition immediately
        if (verdict?.outcome === 'reject' || verdict?.outcome === 'rework') {
          const updatedTask = applyTaskUpdate(task, taskUpdates);
          const { event, task: transitionedTask } = ctx.transitionTask(updatedTask, 'rework_required', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: verdict.reason ?? 'acceptance rejected by worker',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          });
          emittedEvents.push(event);
          return { task: transitionedTask, emitted_events: emittedEvents, next_action: 'dispatch_dev', taskUpdates };
        }

        const verdictUpdate: TaskUpdate = verdict ? {
          last_verdict: {
            outcome: verdict.outcome,
            reason: verdict.reason,
            manual_notes: verdict.manual_notes,
          },
        } : {};

        const mergedTaskUpdates = mergeTaskUpdates(taskUpdates, verdictUpdate);
        const updatedTask = applyTaskUpdate(task, mergedTaskUpdates);

        // For an explicit accept verdict, try to complete acceptance automatically.
        // If the acceptance gate still requires manual intervention, keep the task in
        // accepting state and surface the stored verdict for later completion.
        if (verdict?.outcome === 'accept' && ctx.completeAcceptance) {
          ctx.setTask?.(updatedTask.task_id, updatedTask);
          try {
            const acceptedTask = ctx.completeAcceptance(updatedTask.task_id, { verdict });
            return {
              task: acceptedTask,
              emitted_events: emittedEvents,
              next_action: 'integrate',
              taskUpdates: mergedTaskUpdates,
            };
          } catch (error) {
            const logger = getLogger().child({
              component: 'ResultOrchestrator',
              taskId: updatedTask.task_id,
              jobId: job.job_id,
              stage: job.stage,
            });
            logger.info('Automatic acceptance completion fell back to manual gate', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          task: updatedTask,
          emitted_events: emittedEvents,
          next_action: 'wait_manual',
          taskUpdates: mergedTaskUpdates,
        };
      }
    }
  }

  /**
   * Finalize a job by releasing resources.
   */
  private finalizeJob(job: WorkerJob, releaseConcurrency: boolean): void {
    this.deps.leaseManager.release(job.job_id, job.worker_type);
    if (releaseConcurrency) {
      this.deps.concurrencyManager.recordComplete({
        job_id: job.job_id,
        worker_id: job.worker_type,
      });
    }
  }
}
