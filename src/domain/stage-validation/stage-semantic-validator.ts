// StageSemanticValidator - validates WorkerResult semantics per stage

import type { WorkerResult } from '../../types/index.js';

/**
 * Semantic validation error.
 */
export interface SemanticValidationError {
  code: 'semantic_error' | 'policy_violation' | 'logic_error';
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Result of semantic validation.
 */
export interface SemanticValidationResult {
  valid: boolean;
  errors: SemanticValidationError[];
  warnings: SemanticValidationError[];
}

/**
 * Validation context with stage info.
 */
export interface SemanticValidationContext {
  stage: 'plan' | 'dev' | 'acceptance';
  risk_level?: 'low' | 'medium' | 'high';
  requested_outputs?: string[];
}

/**
 * StageSemanticValidator validates stage-specific semantic requirements.
 *
 * Plan stage:
 * - summary or plan artifact required
 * - patch_ref forbidden
 * - write/network side effects forbidden
 *
 * Dev stage:
 * - patch_ref, branch_ref, tool_plan, or edit_intent required
 * - allowed side effects must be in requested_escalations
 *
 * Acceptance stage:
 * - verdict.outcome required
 * - accept requires test evidence or acceptance artifact
 */
export class StageSemanticValidator {
  /**
   * Validate a WorkerResult against stage semantic requirements.
   */
  validate(result: WorkerResult, context: SemanticValidationContext): SemanticValidationResult {
    const errors: SemanticValidationError[] = [];
    const warnings: SemanticValidationError[] = [];

    switch (context.stage) {
      case 'plan':
        this.validatePlanStage(result, errors, warnings);
        break;
      case 'dev':
        this.validateDevStage(result, errors, warnings, context);
        break;
      case 'acceptance':
        this.validateAcceptanceStage(result, errors, warnings, context);
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate plan stage requirements.
   */
  private validatePlanStage(
    result: WorkerResult,
    errors: SemanticValidationError[],
    _warnings: SemanticValidationError[],
  ): void {
    // Plan must not have patch_ref
    if (result.patch_ref) {
      errors.push({
        code: 'semantic_error',
        path: 'patch_ref',
        message: 'plan stage must not return patch_ref',
        severity: 'error',
      });
    }

    // Plan must not have branch_ref
    if (result.branch_ref) {
      errors.push({
        code: 'semantic_error',
        path: 'branch_ref',
        message: 'plan stage must not return branch_ref',
        severity: 'error',
      });
    }

    // Plan must have summary or plan artifact
    if (result.status === 'succeeded') {
      const hasPlanOutput =
        result.summary ||
        result.artifacts?.some(a => a.kind === 'json' || a.kind === 'report');

      if (!hasPlanOutput) {
        errors.push({
          code: 'semantic_error',
          path: 'output',
          message: 'plan stage succeeded requires summary or plan artifact',
          severity: 'error',
        });
      }
    }

    // Check for forbidden side effects
    const forbiddenEscalations = result.requested_escalations?.filter(
      e =>
        e.kind === 'network_access' ||
        e.kind === 'workspace_outside_write' ||
        e.kind === 'protected_path_write' ||
        e.kind === 'destructive_tool',
    );

    if (forbiddenEscalations?.length > 0) {
      for (const esc of forbiddenEscalations) {
        if (!esc.approved) {
          errors.push({
            code: 'policy_violation',
            path: `requested_escalations.${esc.kind}`,
            message: `plan stage forbidden side effect: ${esc.kind}`,
            severity: 'error',
          });
        }
      }
    }
  }

  /**
   * Validate dev stage requirements.
   */
  private validateDevStage(
    result: WorkerResult,
    errors: SemanticValidationError[],
    warnings: SemanticValidationError[],
    context: SemanticValidationContext,
  ): void {
    // Dev must have implementation output
    if (result.status === 'succeeded') {
      const hasDevOutput =
        result.patch_ref ||
        result.branch_ref ||
        result.artifacts?.some(a => a.kind === 'json' && a.uri.includes('tool_plan')) ||
        result.artifacts?.some(a => a.kind === 'json' && a.uri.includes('edit_intent'));

      if (!hasDevOutput) {
        errors.push({
          code: 'semantic_error',
          path: 'output',
          message: 'dev stage succeeded requires patch_ref, branch_ref, tool_plan, or edit_intent',
          severity: 'error',
        });
      }
    }

    // Check for unauthorized side effects
    const unauthorizedEffects = result.requested_escalations?.filter(
      e => !e.approved && e.kind !== 'human_verdict',
    );

    if (unauthorizedEffects?.length > 0) {
      warnings.push({
        code: 'policy_violation',
        path: 'requested_escalations',
        message: `dev stage has unapproved side effects: ${unauthorizedEffects.map(e => e.kind).join(', ')}`,
        severity: 'warning',
      });
    }

    // High-risk tasks require test results
    if (context.risk_level === 'high' && result.status === 'succeeded') {
      const hasTests =
        result.test_results?.some(t => t.status === 'passed') ||
        result.test_results?.length > 0;

      if (!hasTests) {
        warnings.push({
          code: 'semantic_error',
          path: 'test_results',
          message: 'high-risk dev stage should have test results',
          severity: 'warning',
        });
      }
    }
  }

  /**
   * Validate acceptance stage requirements.
   */
  private validateAcceptanceStage(
    result: WorkerResult,
    errors: SemanticValidationError[],
    warnings: SemanticValidationError[],
    context: SemanticValidationContext,
  ): void {
    // Acceptance must not have edit outputs
    if (result.patch_ref) {
      errors.push({
        code: 'semantic_error',
        path: 'patch_ref',
        message: 'acceptance stage must not return patch_ref',
        severity: 'error',
      });
    }

    if (result.branch_ref) {
      errors.push({
        code: 'semantic_error',
        path: 'branch_ref',
        message: 'acceptance stage must not return branch_ref',
        severity: 'error',
      });
    }

    // Acceptance must have verdict
    if (!result.verdict) {
      errors.push({
        code: 'semantic_error',
        path: 'verdict',
        message: 'acceptance stage requires verdict',
        severity: 'error',
      });
    } else {
      // Check verdict structure
      if (!result.verdict.outcome) {
        errors.push({
          code: 'semantic_error',
          path: 'verdict.outcome',
          message: 'verdict.outcome is required',
          severity: 'error',
        });
      }

      // Accept verdict requires evidence - fail closed (error, not warning)
      if (result.verdict.outcome === 'accept' && result.status === 'succeeded') {
        const hasEvidence =
          result.test_results?.some(t => t.status === 'passed') ||
          result.artifacts?.some(a => a.kind === 'report' || a.kind === 'json');

        if (!hasEvidence) {
          errors.push({
            code: 'semantic_error',
            path: 'evidence',
            message: 'accept verdict requires test results or acceptance artifact - insufficient evidence for auto-acceptance',
            severity: 'error',
          });
        }
      }

      // needs_manual_review should go to manual gate (error)
      if (result.verdict.outcome === 'needs_manual_review') {
        errors.push({
          code: 'semantic_error',
          path: 'verdict.outcome',
          message: 'acceptance requires manual review',
          severity: 'error',
        });
      }
    }

    // High-risk requires regression suite
    if (context.risk_level === 'high' && result.verdict?.outcome === 'accept') {
      const hasRegression = result.test_results?.some(
        t => t.suite === 'regression' && t.status === 'passed',
      );

      if (!hasRegression) {
        errors.push({
          code: 'policy_violation',
          path: 'test_results.regression',
          message: 'high-risk acceptance requires regression suite passed',
          severity: 'error',
        });
      }
    }
  }
}

/**
 * Factory function to create StageSemanticValidator.
 */
export function createStageSemanticValidator(): StageSemanticValidator {
  return new StageSemanticValidator();
}