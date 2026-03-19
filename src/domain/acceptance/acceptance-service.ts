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
  /** Whether log artifacts are required for acceptance (default: false for backwards compatibility) */
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

    // Gate 2: Validate manual checklist completion
    const checklistValidation = updatedChecklist
      ? this.deps.checklistService.validateChecklist(updatedChecklist)
      : { valid: true, missing: [] };

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

    // Gate 4: Log artifacts must be present for acceptance (if configured)
    if (this.deps.requireLogArtifacts) {
      const logArtifacts = task.artifacts?.filter(a => a.kind === 'log') ?? [];
      if (logArtifacts.length === 0) {
        throw new Error('at least one log artifact is required for acceptance completion');
      }
    }

    // All gates passed - transition to 'accepted'
    const { task: acceptedTask } = ctx.transitionTask(task, 'accepted', {
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