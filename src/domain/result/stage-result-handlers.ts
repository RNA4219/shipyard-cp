import type { StateTransitionEvent, Task, WorkerJob, WorkerResult } from '../../types.js';
import { getArtifactIds } from '../../store/utils.js';
import type { TaskUpdate } from '../task/index.js';
import { applyTaskUpdate, mergeTaskUpdates } from '../task/index.js';
import type { ResultApplyResponseWithUpdates, ResultContext } from './result-orchestrator.js';

export function handleSucceededStage(
  task: Task,
  job: WorkerJob,
  result: WorkerResult,
  emittedEvents: StateTransitionEvent[],
  taskUpdates: TaskUpdate,
  ctx: ResultContext,
  generateManualChecklist: (task: Task) => NonNullable<Task['manual_checklist']>,
): ResultApplyResponseWithUpdates {
  const artifactIds = getArtifactIds(result);

  if (job.stage === 'plan') {
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

  if (job.stage === 'dev') {
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

  const verdict = result.verdict;
  if (task.acceptance_gate_context?.required) {
    ctx.emitAuditEvent(task.task_id, 'run.acceptanceGateEnforced', {
      source_job_id: task.acceptance_gate_context.source_job_id,
      acceptance_job_id: job.job_id,
      artifact_ids: artifactIds,
      verdict: verdict?.outcome,
    }, { jobId: job.job_id });
  }

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
  const checklistUpdate: TaskUpdate = task.manual_checklist?.length
    ? {}
    : { manual_checklist: generateManualChecklist(task) };
  const mergedTaskUpdates = mergeTaskUpdates(taskUpdates, verdictUpdate, checklistUpdate);
  return {
    task: applyTaskUpdate(task, mergedTaskUpdates),
    emitted_events: emittedEvents,
    next_action: 'wait_manual',
    taskUpdates: mergedTaskUpdates,
  };
}
