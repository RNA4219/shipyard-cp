import type { TaskState, StateTransitionEvent } from '../../types.js';
import { ShipyardError, ErrorCodes } from '../../constants/index.js';

export const TYPED_REF_PATTERN = /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$/;

export class TaskValidator {
  static validateObjective(objective: string | undefined): void {
    if (!objective || objective.trim() === '') {
      throw ShipyardError.fromCode(ErrorCodes.OBJECTIVE_REQUIRED);
    }
  }

  static validateTypedRef(typedRef: string | undefined): void {
    if (!typedRef) {
      throw ShipyardError.fromCode(ErrorCodes.TYPED_REF_REQUIRED);
    }
    if (!TYPED_REF_PATTERN.test(typedRef)) {
      throw ShipyardError.fromCode(ErrorCodes.TYPED_REF_INVALID_FORMAT, { typedRef });
    }
  }

  static validateCreateRequest(request: { objective?: string; typed_ref?: string }): void {
    this.validateObjective(request.objective);
    this.validateTypedRef(request.typed_ref);
  }

  static validateTransitionEvent(event: StateTransitionEvent, taskId: string, currentState: TaskState): void {
    if (event.task_id !== taskId) {
      throw ShipyardError.fromCode(ErrorCodes.TASK_ID_MISMATCH, { expected: taskId, actual: event.task_id });
    }
    if (event.from_state !== currentState) {
      throw ShipyardError.fromCode(ErrorCodes.FROM_STATE_MISMATCH, { current: currentState, expected: event.from_state });
    }
  }
}