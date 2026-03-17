import type { TaskState, WorkerStage, ActiveState } from './types.js';
import { TERMINAL_STATES } from './types.js';

// Allowed state transitions based on state-machine.md
export const ALLOWED_TRANSITIONS = new Map<TaskState, TaskState[]>([
  ['queued', ['queued', 'planning', 'cancelled', 'failed']],
  ['planning', ['planned', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['planned', ['developing', 'cancelled', 'failed']],
  ['developing', ['dev_completed', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['dev_completed', ['accepting', 'cancelled', 'failed']],
  ['accepting', ['accepted', 'rework_required', 'blocked', 'cancelled', 'failed']],
  ['rework_required', ['developing', 'cancelled', 'failed']],
  ['accepted', ['integrating', 'cancelled', 'failed']],
  ['integrating', ['integrated', 'blocked', 'cancelled', 'failed']],
  ['integrated', ['publish_pending_approval', 'publishing', 'cancelled', 'failed']],
  ['publish_pending_approval', ['publishing', 'cancelled', 'failed']],
  ['publishing', ['published', 'blocked', 'cancelled', 'failed']],
  ['blocked', ['planning', 'developing', 'accepting', 'integrating', 'publishing', 'cancelled', 'failed']],
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
      throw new Error(`transition not allowed: ${from} -> ${to}`);
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
        throw new Error(`state ${state} cannot dispatch a worker job`);
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