import type { TaskState, StateTransitionEvent } from '../../types.js';

export const TYPED_REF_PATTERN = /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$/;

export class TaskValidator {
  static validateObjective(objective: string | undefined): void {
    if (!objective || objective.trim() === '') {
      throw new Error('objective is required');
    }
  }

  static validateTypedRef(typedRef: string | undefined): void {
    if (!typedRef) {
      throw new Error('typed_ref is required');
    }
    if (!TYPED_REF_PATTERN.test(typedRef)) {
      throw new Error(`typed_ref invalid format: ${typedRef}`);
    }
  }

  static validateCreateRequest(request: { objective?: string; typed_ref?: string }): void {
    this.validateObjective(request.objective);
    this.validateTypedRef(request.typed_ref);
  }

  static validateTransitionEvent(event: StateTransitionEvent, taskId: string, currentState: TaskState): void {
    if (event.task_id !== taskId) {
      throw new Error(`task_id mismatch: expected ${taskId}, got ${event.task_id}`);
    }
    if (event.from_state !== currentState) {
      throw new Error(`from_state mismatch: task is in ${currentState}, not ${event.from_state}`);
    }
  }
}