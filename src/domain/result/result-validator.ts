import type { Task, WorkerJob, WorkerResult } from '../../types.js';
import { SchemaValidator } from '../validation/index.js';
import { StageSemanticValidator, type SemanticValidationContext } from '../stage-validation/index.js';
import type { ResultContext } from './result-orchestrator.js';

export interface ResultValidation {
  valid: boolean;
  schemaErrors: Array<{ code: string; path: string; message: string }>;
  semanticErrors: Array<{ code: string; path: string; message: string }>;
  authorityConflictErrors?: Array<{ code: string; path: string; message: string }>;
}

export class ResultValidator {
  private readonly schemaValidator = new SchemaValidator();
  private readonly stageSemanticValidator = new StageSemanticValidator();

  validate(result: WorkerResult, task: Task, job: WorkerJob, ctx: ResultContext): ResultValidation {
    const authorityConflict = this.detectAuthorityConflict(result, task);
    if (authorityConflict) {
      const conflictError = {
        code: 'authority_conflict',
        path: 'authority',
        message: authorityConflict.type + ': ' + authorityConflict.details,
      };
      ctx.emitAuditEvent(task.task_id, 'instruction_authority_conflict', {
        job_id: job.job_id,
        stage: job.stage,
        conflict_type: authorityConflict.type,
        details: authorityConflict.details,
      }, { jobId: job.job_id });
      return { valid: false, schemaErrors: [], semanticErrors: [], authorityConflictErrors: [conflictError] };
    }

    const schemaResult = this.schemaValidator.validate(result);
    if (!schemaResult.valid) {
      ctx.emitAuditEvent(task.task_id, 'instruction_schema_rejected', {
        job_id: job.job_id,
        stage: job.stage,
        errors: schemaResult.errors,
      }, { jobId: job.job_id });
      return { valid: false, schemaErrors: schemaResult.errors, semanticErrors: [] };
    }

    const semanticContext: SemanticValidationContext = {
      stage: job.stage,
      risk_level: task.risk_level,
      requested_outputs: job.requested_outputs?.map(output => output.toString()),
    };
    const semanticResult = this.stageSemanticValidator.validate(result, semanticContext);
    if (!semanticResult.valid) {
      ctx.emitAuditEvent(task.task_id, 'instruction_semantic_rejected', {
        job_id: job.job_id,
        stage: job.stage,
        errors: semanticResult.errors,
      }, { jobId: job.job_id });
      return { valid: false, schemaErrors: [], semanticErrors: semanticResult.errors };
    }

    return { valid: true, schemaErrors: [], semanticErrors: [] };
  }

  private detectAuthorityConflict(result: WorkerResult, task: Task): { type: string; details: string } | null {
    const textFields = [
      result.summary,
      result.verdict?.reason,
      ...(result.requested_escalations?.map(escalation => escalation.reason) ?? []),
    ].filter(Boolean);

    const overridePatterns = [
      /\bignore\s+previous\s+instructions\b/i,
      /\bbypass\s+policy\b/i,
      /\boverride\s+authority\b/i,
      /\bset\s+approval_policy\s*=\s*allow\b/i,
      /\bdisable\s+sandbox\b/i,
    ];
    for (const text of textFields) {
      if (text && overridePatterns.some(pattern => pattern.test(text))) {
        return {
          type: 'instruction_injection',
          details: 'Content contains potential instruction override pattern',
        };
      }
    }

    if (task.resolver_refs?.doc_refs && task.resolver_refs.stale_status === 'stale') {
      return {
        type: 'stale_document_reference',
        details: 'Referenced documents may contain stale instructions',
      };
    }
    return null;
  }
}
