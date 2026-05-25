// ToolPlanValidator tests

import { describe, it, expect } from 'vitest';
import { ToolPlanValidator, createToolPlanValidator } from '../src/domain/validation/index.js';

function createValidToolPlan() {
  return {
    summary: 'Add validation and run tests',
    calls: [
      { tool: 'read_file', args: { path: 'src/file.ts' } },
      { tool: 'apply_patch_intent', args: { path: 'src/file.ts', locator: 'func', replacement: 'func2' } },
      { tool: 'run_test_suite', args: { suite: 'unit' } },
    ],
    evidence: ['src/file.ts:10', 'test/file.test.ts:5'],
  };
}

describe('ToolPlanValidator', () => {
  describe('validate', () => {
    it('should pass valid tool_plan', () => {
      const validator = createToolPlanValidator();
      const plan = createValidToolPlan();

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject non-object input', () => {
      const validator = createToolPlanValidator();

      const validation = validator.validate(null);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'parse_error')).toBe(true);
    });

    it('should reject missing summary', () => {
      const validator = createToolPlanValidator();
      const plan = { ...createValidToolPlan(), summary: undefined };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'summary')).toBe(true);
    });

    it('should reject summary over 400 chars', () => {
      const validator = createToolPlanValidator();
      const plan = { ...createValidToolPlan(), summary: 'a'.repeat(401) };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'summary')).toBe(true);
    });

    it('should reject missing calls', () => {
      const validator = createToolPlanValidator();
      const plan = { ...createValidToolPlan(), calls: undefined };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'calls')).toBe(true);
    });

    it('should reject calls over 8 items', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: Array(9).fill({ tool: 'read_file', args: { path: 'file' } }),
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'calls')).toBe(true);
    });

    it('should reject call without tool', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: [{ args: { path: 'file' } }],
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'calls[0].tool')).toBe(true);
    });

    it('should reject call without args', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: [{ tool: 'read_file' }],
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'calls[0].args')).toBe(true);
    });

    it('should reject tool not in default allowlist', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: [{ tool: 'delete_everything', args: { all: true } }],
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'tool_not_allowed')).toBe(true);
    });

    it('should accept tool in custom allowlist', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: [{ tool: 'custom_tool', args: {} }],
      };
      const allowedTools = ['read_file', 'custom_tool'];

      const validation = validator.validate(plan, allowedTools);

      expect(validation.valid).toBe(true);
    });

    it('should reject tool not in custom allowlist', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        calls: [{ tool: 'write_file', args: { path: 'file' } }],
      };
      const allowedTools = ['read_file', 'search_code'];

      const validation = validator.validate(plan, allowedTools);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'tool_not_allowed')).toBe(true);
    });

    it('should reject missing evidence', () => {
      const validator = createToolPlanValidator();
      const plan = { ...createValidToolPlan(), evidence: undefined };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'evidence')).toBe(true);
    });

    it('should reject evidence over 12 items', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        evidence: Array(13).fill('ref'),
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'evidence')).toBe(true);
    });

    it('should reject empty evidence item', () => {
      const validator = createToolPlanValidator();
      const plan = {
        ...createValidToolPlan(),
        evidence: ['valid', '', 'another'],
      };

      const validation = validator.validate(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'evidence[1]')).toBe(true);
    });
  });

  describe('parseAndValidate', () => {
    it('should parse and validate valid JSON', () => {
      const validator = createToolPlanValidator();
      const json = JSON.stringify(createValidToolPlan());

      const validation = validator.parseAndValidate(json);

      expect(validation.valid).toBe(true);
    });

    it('should reject invalid JSON', () => {
      const validator = createToolPlanValidator();
      const json = '{ invalid json }';

      const validation = validator.parseAndValidate(json);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'parse_error')).toBe(true);
    });

    it('should reject JSON with valid syntax but invalid structure', () => {
      const validator = createToolPlanValidator();
      const json = JSON.stringify({ summary: 'test' });

      const validation = validator.parseAndValidate(json);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.path === 'calls')).toBe(true);
    });
  });
});