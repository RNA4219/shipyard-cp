import type {
  FailureClass,
  ResultApplyResponse,
  StateTransitionEvent,
  Task,
  WorkerJob,
  WorkerResult,
  WorkerStage,
} from '../../types.js';
import { DoomLoopDetector } from '../doom-loop/index.js';
import { LeaseManager } from '../lease/index.js';
import { RetryManager } from '../retry/index.js';
import { ConcurrencyManager } from '../concurrency/index.js';

/**
 * Context passed to ResultHandler for processing worker results
 */
export interface ResultHandlerContext {
  getJob(jobId: string): WorkerJob | undefined;
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): StateTransitionEvent;
  stageToActiveState(stage: WorkerStage): 'planning' | 'developing' | 'accepting';
  getArtifactIds(result: WorkerResult): string[];
}

/**
 * Handles worker result processing including success, failure, retry, and doom loop detection.
 */
export class ResultHandler {
  constructor(
    private readonly doomLoopDetector: DoomLoopDetector,
    private readonly leaseManager: LeaseManager,
    private readonly retryManager: RetryManager,
    private readonly concurrencyManager: ConcurrencyManager,
  ) {}

  /**
   * Process a succeeded result and determine next state/action.
   */
  handleSucceeded(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    ctx: ResultHandlerContext,
  ): ResultApplyResponse {
    const artifactIds = ctx.getArtifactIds(result);

    switch (job.stage) {
      case 'plan':
        return {
          task,
          emitted_events: [ctx.transitionTask(task, 'planned', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: result.summary ?? 'plan completed',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          })],
          next_action: 'dispatch_dev',
        };

      case 'dev':
        return {
          task,
          emitted_events: [ctx.transitionTask(task, 'dev_completed', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: result.summary ?? 'dev completed',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          })],
          next_action: 'dispatch_acceptance',
        };

      case 'acceptance': {
        const regressionOk = task.risk_level !== 'high' ||
          result.test_results.some(t => t.suite === 'regression' && t.status === 'passed');
        const accepted = result.verdict?.outcome === 'accept' && regressionOk;

        return {
          task,
          emitted_events: [ctx.transitionTask(task, accepted ? 'accepted' : 'rework_required', {
            actor_type: 'worker',
            actor_id: job.worker_type,
            reason: accepted ? 'acceptance passed' : 'acceptance requires rework',
            job_id: job.job_id,
            artifact_ids: artifactIds,
          })],
          next_action: accepted ? 'integrate' : 'dispatch_dev',
        };
      }
    }
  }

  /**
   * Process a blocked result.
   */
  handleBlocked(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    ctx: ResultHandlerContext,
  ): ResultApplyResponse {
    task.blocked_context = {
      resume_state: ctx.stageToActiveState(job.stage),
      reason: result.summary ?? 'worker blocked',
      waiting_on: 'human',
    };

    return {
      task,
      emitted_events: [ctx.transitionTask(task, 'blocked', {
        actor_type: 'worker',
        actor_id: job.worker_type,
        reason: result.summary ?? 'worker blocked',
        job_id: job.job_id,
        artifact_ids: ctx.getArtifactIds(result),
      })],
      next_action: 'wait_manual',
    };
  }

  /**
   * Process a failed result, handling retry logic and doom loop detection.
   */
  handleFailed(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    ctx: ResultHandlerContext,
  ): ResultApplyResponse {
    const failureClass = result.failure_class ?? this.retryManager.classifyFromResult(result);
    const currentRetryCount = result.retry_count ?? 0;
    const maxRetries = job.retry_policy?.max_retries ?? this.retryManager.getDefaultMaxRetries(job.stage);

    // Check for doom loop first
    const loopResult = this.doomLoopDetector.detectLoop(job.job_id);
    if (loopResult) {
      return this.handleDoomLoop(task, job, result, loopResult, ctx);
    }

    // Check if we should retry
    if (this.retryManager.shouldRetry({
      failure_class: failureClass,
      retry_count: currentRetryCount,
      max_retries: maxRetries,
    })) {
      return this.handleRetry(task, job, result, retryKey, currentRetryCount, maxRetries, failureClass, ctx);
    }

    // Max retries reached or non-retryable failure
    return this.handleFinalFailure(task, job, result, retryKey, failureClass, ctx);
  }

  /**
   * Handle doom loop detection.
   */
  handleDoomLoop(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    loopResult: { loop_type: string },
    ctx: ResultHandlerContext,
  ): ResultApplyResponse {
    task.blocked_context = {
      resume_state: ctx.stageToActiveState(job.stage),
      reason: `Doom loop detected: ${loopResult.loop_type}`,
      waiting_on: 'policy',
      loop_fingerprint: job.loop_fingerprint,
    };

    return {
      task,
      emitted_events: [ctx.transitionTask(task, 'blocked', {
        actor_type: 'policy_engine',
        actor_id: 'doom_loop_detector',
        reason: `doom loop detected: ${loopResult.loop_type}`,
        job_id: job.job_id,
        artifact_ids: ctx.getArtifactIds(result),
      })],
      next_action: 'wait_manual',
    };
  }

  /**
   * Handle retry logic.
   */
  handleRetry(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    currentRetryCount: number,
    maxRetries: number,
    failureClass: FailureClass,
    ctx: ResultHandlerContext,
  ): { task: Task; emitted_events: StateTransitionEvent[]; next_action: 'retry'; retry_scheduled_at: string } {
    const nextState = ctx.stageToActiveState(job.stage);

    const event = ctx.transitionTask(task, nextState, {
      actor_type: 'policy_engine',
      actor_id: 'retry_manager',
      reason: `retry ${currentRetryCount + 1}/${maxRetries} after ${failureClass}`,
      job_id: job.job_id,
      artifact_ids: ctx.getArtifactIds(result),
    });

    // Release lease but keep concurrency for retry
    this.leaseManager.release(job.job_id, job.worker_type);

    const backoffSeconds = this.retryManager.calculateBackoff(
      currentRetryCount,
      job.retry_policy ?? { max_retries: maxRetries, backoff_base_seconds: 2, max_backoff_seconds: 60, jitter_enabled: true },
    );

    return {
      task,
      emitted_events: [event],
      next_action: 'retry',
      retry_scheduled_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
    };
  }

  /**
   * Handle final failure when no more retries.
   */
  handleFinalFailure(
    task: Task,
    job: WorkerJob,
    result: WorkerResult,
    retryKey: string,
    failureClass: FailureClass,
    ctx: ResultHandlerContext,
  ): ResultApplyResponse {
    return {
      task,
      emitted_events: [ctx.transitionTask(task, 'rework_required', {
        actor_type: 'worker',
        actor_id: job.worker_type,
        reason: result.summary ?? `failed (${failureClass}, retries exhausted)`,
        job_id: job.job_id,
        artifact_ids: ctx.getArtifactIds(result),
      })],
      next_action: 'dispatch_dev',
    };
  }

  /**
   * Finalize a job by releasing resources.
   */
  finalizeJob(task: Task, job: WorkerJob, releaseConcurrency: boolean, updateTask: () => void): void {
    this.leaseManager.release(job.job_id, job.worker_type);
    if (releaseConcurrency) {
      this.concurrencyManager.recordComplete({
        job_id: job.job_id,
        worker_id: job.worker_type,
      });
    }
    updateTask();
  }
}