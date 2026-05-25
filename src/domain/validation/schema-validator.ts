// SchemaValidator - validates WorkerResult structure before state transition

import type { WorkerResult } from '../../types/index.js';

/**
 * Validation error with code, path, and message.
 */
export interface ValidationError {
  code: 'parse_error' | 'schema_error' | 'semantic_error';
  path: string;
  message: string;
}

/**
 * Result of schema validation.
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * SchemaValidator validates WorkerResult structure.
 *
 * Minimum requirements:
 * - job_id, typed_ref, status, artifacts, test_results, requested_escalations, usage.runtime_ms
 * - status=succeeded requires: patch_ref, branch_ref, verdict, or 1+ artifacts
 */
export class SchemaValidator {
  /**
   * Validate a WorkerResult for minimum structure requirements.
   */
  validate(result: WorkerResult): SchemaValidationResult {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!result.job_id || result.job_id.length === 0) {
      errors.push({
        code: 'schema_error',
        path: 'job_id',
        message: 'job_id is required and must be non-empty',
      });
    }

    if (!result.typed_ref || result.typed_ref.length === 0) {
      errors.push({
        code: 'schema_error',
        path: 'typed_ref',
        message: 'typed_ref is required and must be non-empty',
      });
    }

    if (!result.status) {
      errors.push({
        code: 'schema_error',
        path: 'status',
        message: 'status is required',
      });
    }

    if (!result.artifacts) {
      errors.push({
        code: 'schema_error',
        path: 'artifacts',
        message: 'artifacts array is required',
      });
    }

    if (!result.test_results) {
      errors.push({
        code: 'schema_error',
        path: 'test_results',
        message: 'test_results array is required',
      });
    }

    if (!result.requested_escalations) {
      errors.push({
        code: 'schema_error',
        path: 'requested_escalations',
        message: 'requested_escalations array is required',
      });
    }

    if (!result.usage || typeof result.usage.runtime_ms !== 'number') {
      errors.push({
        code: 'schema_error',
        path: 'usage.runtime_ms',
        message: 'usage.runtime_ms is required and must be a number',
      });
    }

    // Check succeeded-specific requirements
    if (result.status === 'succeeded') {
      const hasOutput =
        result.summary ||
        result.patch_ref ||
        result.branch_ref ||
        result.verdict ||
        (result.artifacts && result.artifacts.length > 0);

      if (!hasOutput) {
        errors.push({
          code: 'schema_error',
          path: 'output',
          message: 'status=succeeded requires summary, patch_ref, branch_ref, verdict, or at least 1 artifact',
        });
      }
    }

    // Check typed_ref format (4-segment canonical)
    if (result.typed_ref && !this.isValidTypedRef(result.typed_ref)) {
      errors.push({
        code: 'schema_error',
        path: 'typed_ref',
        message: 'typed_ref must match 4-segment canonical form: domain:entity_type:provider:entity_id',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check typed_ref format.
   * Must be: domain:entity_type:provider:entity_id
   */
  private isValidTypedRef(typedRef: string): boolean {
    const pattern = /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$/;
    return pattern.test(typedRef);
  }
}

/**
 * Factory function to create SchemaValidator.
 */
export function createSchemaValidator(): SchemaValidator {
  return new SchemaValidator();
}