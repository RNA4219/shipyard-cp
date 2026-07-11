import type {
  Task,
  StateTransitionEvent,
  CompleteAcceptanceRequest,
  CompleteAcceptanceResponse,
  AuditEventType,
} from '../../types.js';
import type { TaskUpdate } from '../task/index.js';
import type { ManualChecklistService } from '../checklist/index.js';
import type { CheckpointService } from '../checkpoint/index.js';
import type { StaleDocsValidator, StaleCheckInput } from '../stale-check/index.js';

/**
 * Context for acceptance operations
 */
export interface AcceptanceContext {
  requireTask(taskId: string): Task;
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: Omit<StateTransitionEvent, 'event_id' | 'task_id' | 'from_state' | 'to_state' | 'occurred_at'>,
  ): { event: StateTransitionEvent; task: Task };
  updateTask(taskId: string, update: TaskUpdate): void;
  emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
  ): void;
}

/**
 * Dependencies for AcceptanceService
 */
export interface AcceptanceDeps {
  checklistService: ManualChecklistService;
  checkpointService: CheckpointService;
  staleDocsValidator: StaleDocsValidator;
  /** @deprecated Log artifacts are always required by the manual acceptance contract. */
  requireLogArtifacts?: boolean;
}

/**
 * Service for acceptance completion.
 * Extracted from ControlPlaneStore to reduce complexity.
 * Returns TaskUpdate objects instead of mutating tasks directly.
 */
export class AcceptanceService {
  constructor(private readonly deps: AcceptanceDeps) {}

  /**
   * Complete manual acceptance after checklist is verified.
   * This is the gate that validates checklist completion and verdict before
   * transitioning from 'accepting' to 'accepted'.
   */
  completeAcceptance(taskId: string, request: CompleteAcceptanceRequest, ctx: AcceptanceContext): CompleteAcceptanceResponse {
    const task = ctx.requireTask(taskId);

    // Gate 1: Task must be in 'accepting' state
    if (task.state !== 'accepting') {
      throw new Error(`task is not in accepting state (current: ${task.state})`);
    }

    // Update checklist items if provided (create new checklist)
    let updatedChecklist = task.manual_checklist;
    if (request.checked_items && updatedChecklist) {
      for (const item of request.checked_items) {
        updatedChecklist = this.deps.checklistService.checkItem(
          updatedChecklist,
          item.id,
          item.checked_by,
          item.notes
        );
      }
      // Apply checklist update immutably
      ctx.updateTask(taskId, { manual_checklist: updatedChecklist });
    }

    if (!updatedChecklist || updatedChecklist.length === 0) {
      throw new Error('manual checklist is required for acceptance completion');
    }

    // Gate 2: Validate manual checklist completion
    const checklistValidation = this.deps.checklistService.validateChecklist(updatedChecklist);

    if (!checklistValidation.valid) {
      throw new Error(
        `manual checklist not complete. Missing required items: ${checklistValidation.missing.join(', ')}`
      );
    }

    // Gate 3: Verdict must be 'accept' (either from worker or override)
    const verdict = request.verdict ?? task.last_verdict;
    if (!verdict) {
      throw new Error('no verdict available. Worker must provide verdict or override must be given.');
    }

    if (verdict.outcome !== 'accept') {
      throw new Error(`verdict outcome must be 'accept', got '${verdict.outcome}'`);
    }

    // Gate 4: Every manual acceptance must retain at least one log artifact.
    const logArtifacts = task.artifacts?.filter(a => a.kind === 'log') ?? [];
    if (logArtifacts.length === 0) {
      throw new Error('at least one log artifact is required for acceptance completion');
    }

    // Gate 5: Stale docs check - must have fresh docs for acceptance
    if (task.resolver_refs && task.resolver_refs.stale_status) {
      const staleInput: StaleCheckInput = {
        stale_status: task.resolver_refs.stale_status,
        has_resolver_refs: true,
        current_stage: 'acceptance',
        doc_stale_counts: task.resolver_refs.stale_doc_counts,
      };
      const staleResult = this.deps.staleDocsValidator.checkStale(staleInput);

      if (!staleResult.can_proceed) {
        // Stale docs found - block or require rework
        if (staleResult.action === 'rework') {
          throw new Error('docs are still stale after re-read. Rework required before acceptance.');
        }
        throw new Error(`stale docs detected: ${staleResult.reason ?? 'docs require re-read'}. Resolve stale docs before acceptance.`);
      }
    }

    // All gates passed. Carry the manually checked items and any human override
    // into the same immutable snapshot that is persisted by the transition.
    const acceptedCandidate: Task = {
      ...task,
      manual_checklist: updatedChecklist,
      last_verdict: verdict,
    };
    const { task: acceptedTask } = ctx.transitionTask(acceptedCandidate, 'accepted', {
      actor_type: 'human',
      actor_id: 'manual_acceptance',
      reason: 'manual acceptance completed',
    });

    // Record approval checkpoint for acceptance
    this.deps.checkpointService.recordCheckpoint({
      task_id: task.task_id,
      run_id: task.task_id,
      checkpoint_type: 'approval',
      stage: 'acceptance',
      ref: `approval:${task.task_id}:accepted`,
      summary: 'Manual acceptance completed',
      actor: 'manual_acceptance',
    });

    // Emit audit event for verdict submission
    ctx.emitAuditEvent(task.task_id, 'task.verdictSubmitted', {
      verdict_outcome: verdict.outcome,
      verdict_reason: verdict.reason,
      checklist_complete: checklistValidation.valid,
      checklist_missing: checklistValidation.missing,
    });

    return {
      task_id: task.task_id,
      state: acceptedTask.state,
      checklist_complete: checklistValidation.valid,
      verdict_outcome: verdict.outcome,
    };
  }
}