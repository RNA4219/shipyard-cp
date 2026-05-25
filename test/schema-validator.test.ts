// SchemaValidator tests

import { describe, it, expect } from 'vitest';
import { SchemaValidator, createSchemaValidator } from '../src/domain/validation/index.js';
import type { WorkerResult } from '../src/types/index.js';

function createMockResult(overrides?: Partial<WorkerResult>): WorkerResult {
  return {
    job_id: 'job_001',
    typed_ref: 'agent-taskstate:task:github:task_001',
    status: 'succeeded',
    artifacts: [
      { artifact_id: 'art_001', kind: 'log', uri: 'artifact://logs/run.log' },
    ],
    test_results: [{ suite: 'unit', status: 'passed', passed: 5 }],
    requested_escalations: [],
    usage: { runtime_ms: 1000 },
    ...overrides,
  };
}

describe('SchemaValidator', () => {
  describe('validate', () => {
    it('should pass valid result', () => {
      const validator = createSchemaValidator();
      const result = createMockResult();

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject missing job_id', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ job_id: '' });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'job_id')).toBe(true);
    });

    it('should reject missing typed_ref', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ typed_ref: '' });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'typed_ref')).toBe(true);
    });

    it('should reject invalid typed_ref format', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ typed_ref: 'invalid-format' });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'typed_ref')).toBe(true);
    });

    it('should accept valid 4-segment typed_ref', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        typed_ref: 'agent-taskstate:task:github:task_001',
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should reject missing status', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ status: undefined as never });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'status')).toBe(true);
    });

    it('should reject missing artifacts', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ artifacts: undefined as never });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'artifacts')).toBe(true);
    });

    it('should reject missing test_results', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ test_results: undefined as never });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'test_results')).toBe(true);
    });

    it('should reject missing requested_escalations', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ requested_escalations: undefined as never });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'requested_escalations')).toBe(true);
    });

    it('should reject missing usage.runtime_ms', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({ usage: undefined as never });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'usage.runtime_ms')).toBe(true);
    });
  });

  describe('succeeded status requirements', () => {
    it('should accept succeeded with summary', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        summary: 'Plan created successfully',
        artifacts: [],
        patch_ref: undefined,
        branch_ref: undefined,
        verdict: undefined,
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should accept succeeded with patch_ref', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        patch_ref: { format: 'unified_diff', content: 'diff' },
        artifacts: [],
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should accept succeeded with branch_ref', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        branch_ref: { name: 'feature-branch' },
        artifacts: [],
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should accept succeeded with verdict', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        verdict: { outcome: 'accept', reason: 'All tests passed' },
        artifacts: [],
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should accept succeeded with artifacts', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        artifacts: [
          { artifact_id: 'art_001', kind: 'log', uri: 'artifact://logs/run.log' },
        ],
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should reject succeeded without output', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'succeeded',
        summary: undefined,
        artifacts: [],
        patch_ref: undefined,
        branch_ref: undefined,
        verdict: undefined,
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'output')).toBe(true);
    });

    it('should accept failed without output', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'failed',
        artifacts: [],
        failure_class: 'non_retryable_logic',
        failure_code: 'implementation_error',
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('should accept blocked without output', () => {
      const validator = createSchemaValidator();
      const result = createMockResult({
        status: 'blocked',
        artifacts: [],
      });

      const validation = validator.validate(result);

      expect(validation.valid).toBe(true);
    });
  });
});