import { describe, it, expect } from 'vitest';
import { RiskAssessor, type RiskFactor } from '../src/domain/risk/index.js';

describe('RiskAssessor', () => {
  const assessor = new RiskAssessor();

  describe('assessRisk', () => {
    it('should return low for minimal changes without risk factors', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 2 },
        { kind: 'test_coverage', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('low');
      expect(result.reasons).toHaveLength(0);
    });

    it('should return medium for moderate changes', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 10 },
        { kind: 'test_coverage', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('medium');
    });

    it('should return high for large changes', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 50 },
        { kind: 'test_coverage', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('large_change_scope');
    });
  });

  describe('forced high risk conditions', () => {
    it('should force high for secret reference', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'secrets_referenced', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('secrets_referenced');
    });

    it('should force high for network access', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'network_access', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('network_access');
    });

    it('should force high for destructive tools', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'destructive_tool', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('destructive_tool');
    });

    it('should force high for core area modification', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'core_area_modified', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('core_area_modified');
    });

    it('should force high for protected path write', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'protected_path_write', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('protected_path_write');
    });

    it('should force high for no test coverage', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 5 },
        { kind: 'test_coverage', value: false },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('no_test_coverage');
    });
  });

  describe('forced high risk with multiple factors', () => {
    it('should accumulate all forced high reasons', () => {
      const factors: RiskFactor[] = [
        { kind: 'secrets_referenced', value: true },
        { kind: 'network_access', value: true },
        { kind: 'destructive_tool', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons).toContain('secrets_referenced');
      expect(result.reasons).toContain('network_access');
      expect(result.reasons).toContain('destructive_tool');
    });
  });

  describe('no test coverage edge cases', () => {
    it('should not force high if test coverage is undefined but has regression test', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 5 },
        { kind: 'regression_test_passed', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).not.toBe('high');
    });
  });

  describe('core areas', () => {
    it('should recognize auth as core area', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'modified_areas', value: ['src/auth/'] },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('core_area_modified');
    });

    it('should recognize payment as core area', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'modified_areas', value: ['src/payment/'] },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('core_area_modified');
    });

    it('should recognize security as core area', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'modified_areas', value: ['src/security/'] },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('core_area_modified');
    });
  });

  describe('medium risk conditions', () => {
    it('should return medium for moderate file count', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 8 },
        { kind: 'test_coverage', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('medium');
    });

    it('should return medium for config file changes', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'config_modified', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('medium');
      expect(result.reasons).toContain('config_modified');
    });

    it('should return medium for dependency changes', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'dependencies_changed', value: true },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('medium');
      expect(result.reasons).toContain('dependencies_changed');
    });
  });

  describe('escalation requests', () => {
    it('should mark high for escalation with secret access', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'escalation_requested', value: ['secret_access'] },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
    });

    it('should mark high for escalation with network access', () => {
      const factors: RiskFactor[] = [
        { kind: 'file_count', value: 1 },
        { kind: 'test_coverage', value: true },
        { kind: 'escalation_requested', value: ['network_access'] },
      ];

      const result = assessor.assessRisk(factors);
      expect(result.level).toBe('high');
    });
  });
});