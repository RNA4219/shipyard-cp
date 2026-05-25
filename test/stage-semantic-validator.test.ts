// StageSemanticValidator tests

import { describe, it, expect } from 'vitest';
import { StageSemanticValidator, createStageSemanticValidator } from '../src/domain/stage-validation/index.js';
import type { WorkerResult } from '../src/types/index.js';
import type { SemanticValidationContext } from '../src/domain/stage-validation/index.js';

function createMockResult(overrides?: Partial<WorkerResult>): WorkerResult {
  return {
    job_id: 'job_001',
    typed_ref: 'agent-taskstate:task:github:task_001',
    status: 'succeeded',
    summary: 'Completed successfully',
    artifacts: [
      { artifact_id: 'art_001', kind: 'log', uri: 'artifact://logs/run.log' },
    ],
    test_results: [{ suite: 'unit', status: 'passed', passed: 5 }],
    requested_escalations: [],
    usage: { runtime_ms: 1000 },
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<SemanticValidationContext>): SemanticValidationContext {
  return {
    stage: 'dev',
    risk_level: 'medium',
    ...overrides,
  };
}

describe('StageSemanticValidator', () => {
  describe('validate', () => {
    it('should pass valid dev result', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        patch_ref: { format: 'unified_diff', content: 'diff' },
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });
  });

  describe('plan stage', () => {
    it('should reject patch_ref in plan stage', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        patch_ref: { format: 'unified_diff', content: 'diff' },
      });
      const context = createMockContext({ stage: 'plan' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'patch_ref')).toBe(true);
    });

    it('should reject branch_ref in plan stage', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        branch_ref: { name: 'feature-branch' },
      });
      const context = createMockContext({ stage: 'plan' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'branch_ref')).toBe(true);
    });

    it('should require summary or artifact for succeeded plan', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        summary: undefined,
        artifacts: [],
      });
      const context = createMockContext({ stage: 'plan' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'output')).toBe(true);
    });

    it('should accept plan with summary', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        summary: 'Plan created successfully',
        artifacts: [{ artifact_id: 'art_plan', kind: 'json', uri: 'plan.json' }],
        patch_ref: undefined,
        branch_ref: undefined,
      });
      const context = createMockContext({ stage: 'plan' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should reject unapproved network_access in plan', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        requested_escalations: [
          { kind: 'network_access', reason: 'Need to fetch data', approved: false },
        ],
      });
      const context = createMockContext({ stage: 'plan' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.message.includes('network_access'))).toBe(true);
    });
  });

  describe('dev stage', () => {
    it('should require implementation output for succeeded dev', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        patch_ref: undefined,
        branch_ref: undefined,
        artifacts: [],
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'output')).toBe(true);
    });

    it('should accept dev with patch_ref', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        patch_ref: { format: 'unified_diff', content: 'diff' },
        artifacts: [],
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should accept dev with branch_ref', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        branch_ref: { name: 'feature-branch' },
        artifacts: [],
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should accept dev with tool_plan artifact', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        artifacts: [
          { artifact_id: 'art_tool_plan', kind: 'json', uri: 'artifact://tool_plan.json' },
        ],
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should warn on unapproved side effects', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        patch_ref: { format: 'unified_diff', content: 'diff' },
        requested_escalations: [
          { kind: 'network_access', reason: 'API call', approved: false },
        ],
      });
      const context = createMockContext({ stage: 'dev' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true); // warning, not error
      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it('should warn on high-risk dev without tests', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        patch_ref: { format: 'unified_diff', content: 'diff' },
        test_results: [],
      });
      const context = createMockContext({ stage: 'dev', risk_level: 'high' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true); // warning, not error
      expect(validation.warnings.some(w => w.path === 'test_results')).toBe(true);
    });
  });

  describe('acceptance stage', () => {
    it('should reject patch_ref in acceptance stage', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        patch_ref: { format: 'unified_diff', content: 'diff' },
        verdict: { outcome: 'accept', reason: 'Tests passed' },
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'patch_ref')).toBe(true);
    });

    it('should reject branch_ref in acceptance stage', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        branch_ref: { name: 'feature-branch' },
        verdict: { outcome: 'accept', reason: 'Tests passed' },
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'branch_ref')).toBe(true);
    });

    it('should require verdict', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: undefined,
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'verdict')).toBe(true);
    });

    it('should require verdict.outcome', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: { outcome: undefined as never, reason: 'Checking' },
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'verdict.outcome')).toBe(true);
    });

    it('should accept verdict with accept outcome', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: { outcome: 'accept', reason: 'All tests passed' },
        test_results: [{ suite: 'unit', status: 'passed', passed: 10 }],
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should accept verdict with reject outcome', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'reject', reason: 'Tests failed' },
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });

    it('should reject accept without evidence', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'Looks good' },
        test_results: [],
        artifacts: [],
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      // P0-3: accept without evidence is now an error (fail closed)
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'evidence')).toBe(true);
    });

    it('should reject needs_manual_review', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: { outcome: 'needs_manual_review', reason: 'Unclear' },
      });
      const context = createMockContext({ stage: 'acceptance' });

      const validation = validator.validate(result, context);

      // P0-3: needs_manual_review is now an error (fail closed to manual gate)
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'verdict.outcome')).toBe(true);
    });

    it('should reject high-risk accept without regression suite', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: { outcome: 'accept', reason: 'Tests passed' },
        test_results: [{ suite: 'unit', status: 'passed', passed: 10 }],
      });
      const context = createMockContext({ stage: 'acceptance', risk_level: 'high' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'test_results.regression')).toBe(true);
    });

    it('should accept high-risk accept with regression suite passed', () => {
      const validator = createStageSemanticValidator();
      const result = createMockResult({
        verdict: { outcome: 'accept', reason: 'All tests passed' },
        test_results: [
          { suite: 'unit', status: 'passed', passed: 10 },
          { suite: 'regression', status: 'passed', passed: 5 },
        ],
      });
      const context = createMockContext({ stage: 'acceptance', risk_level: 'high' });

      const validation = validator.validate(result, context);

      expect(validation.valid).toBe(true);
    });
  });
});