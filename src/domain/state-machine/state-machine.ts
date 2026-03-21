import type { TaskState, WorkerStage, ActiveState } from './types.js';
import { TERMINAL_STATES } from './types.js';
import { ShipyardError, ErrorCodes } from '../../constants/index.js';

// Allowed state transitions based on state-machine.md
// Each state can transition to itself for idempotency (e.g., retry scenarios, duplicate requests)
// All completion states can transition to blocked for late-stage blocking scenarios
export const ALLOWED_TRANSITIONS = new Map<TaskState, TaskState[]>([
  ['queued', ['queued', 'planning', 'blocked', 'cancelled', 'failed']],
  ['planning', ['planning', 'planned', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['planned', ['planned', 'developing', 'blocked', 'cancelled', 'failed']],
  ['developing', ['developing', 'dev_completed', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['dev_completed', ['dev_completed', 'accepting', 'blocked', 'cancelled', 'failed']],
  ['accepting', ['accepting', 'accepted', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['rework_required', ['rework_required', 'developing', 'blocked', 'cancelled', 'failed']],
  ['accepted', ['accepted', 'integrating', 'blocked', 'cancelled', 'failed']],
  ['integrating', ['integrating', 'integrated', 'blocked', 'cancelled', 'failed']],
  ['integrated', ['integrated', 'publish_pending_approval', 'publishing', 'blocked', 'cancelled', 'failed']],
  ['publish_pending_approval', ['publish_pending_approval', 'publishing', 'blocked', 'cancelled', 'failed']],
  ['publishing', ['publishing', 'published', 'blocked', 'cancelled', 'failed']],
  ['blocked', ['blocked', 'planning', 'developing', 'accepting', 'integrating', 'integrated', 'publishing', 'cancelled', 'failed']],
]);

export class StateMachine {
  getAllowedTransitions(state: TaskState): TaskState[] {
    return ALLOWED_TRANSITIONS.get(state) ?? [];
  }

  canTransition(from: TaskState, to: TaskState): boolean {
    const allowed = this.getAllowedTransitions(from);
    return allowed.includes(to);
  }

  validateTransition(from: TaskState, to: TaskState): void {
    if (!this.canTransition(from, to)) {
      throw ShipyardError.fromCode(ErrorCodes.TRANSITION_NOT_ALLOWED, { from, to });
    }
  }

  getAllowedDispatchStage(state: TaskState): WorkerStage {
    switch (state) {
      case 'queued':
        return 'plan';
      case 'planned':
      case 'rework_required':
        return 'dev';
      case 'dev_completed':
        return 'acceptance';
      default:
        throw ShipyardError.fromCode(ErrorCodes.CANNOT_DISPATCH_WORKER, { state });
    }
  }

  stageToActiveState(stage: WorkerStage): ActiveState {
    switch (stage) {
      case 'plan':
        return 'planning';
      case 'dev':
        return 'developing';
      case 'acceptance':
        return 'accepting';
    }
  }

  isTerminal(state: TaskState): boolean {
    return TERMINAL_STATES.has(state);
  }
}