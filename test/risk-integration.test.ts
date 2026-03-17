import { describe, it, expect } from 'vitest';
import {
  RiskIntegrationService,
  extractRiskFactorsFromResult,
  detectCoreAreaModification,
  analyzeSideEffects,
} from '../src/domain/risk/index.js';
import type { WorkerResult, RequestedEscalation } from '../src/types.js';

describe('Risk Integration Service', () => {
  const service = new RiskIntegrationService();

  describe('extractRiskFactorsFromResult', () => {
    it('should extract file count from patch', () => {
      const result = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded' as const,
        artifacts: [],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 1000 },
        patch_ref: {
          format: 'unified_diff' as const,
          content: `--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,1 +1,1 @@
-old
+new
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1,1 +1,1 @@
-old
+new`,
        },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'file_count')?.value).toBe(2);
    });

    it('should detect network access escalation', () => {
      const result: WorkerResult = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded',
        artifacts: [],
        test_results: [],
        requested_escalations: [
          { kind: 'network_access', reason: 'API call needed', approved: true },
        ],
        usage: { runtime_ms: 1000 },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'network_access')?.value).toBe(true);
      expect(factors.find(f => f.kind === 'escalation_requested')?.value).toContain('network_access');
    });

    it('should detect secret access escalation', () => {
      const result: WorkerResult = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded',
        artifacts: [],
        test_results: [],
        requested_escalations: [
          { kind: 'secret_access', reason: 'Need DB password', approved: true },
        ],
        usage: { runtime_ms: 1000 },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'secrets_referenced')?.value).toBe(true);
    });

    it('should detect test coverage', () => {
      const result: WorkerResult = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded',
        artifacts: [],
        test_results: [
          { suite: 'unit', status: 'passed', passed: 10, failed: 0 },
        ],
        requested_escalations: [],
        usage: { runtime_ms: 1000 },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'test_coverage')?.value).toBe(true);
    });

    it('should detect failed tests', () => {
      const result: WorkerResult = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded',
        artifacts: [],
        test_results: [
          { suite: 'unit', status: 'failed', passed: 8, failed: 2 },
        ],
        requested_escalations: [],
        usage: { runtime_ms: 1000 },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'test_coverage')?.value).toBe(false);
    });

    it('should detect regression test', () => {
      const result: WorkerResult = {
        job_id: 'job-1',
        typed_ref: 'agent-taskstate:task:local:task-1',
        status: 'succeeded',
        artifacts: [],
        test_results: [
          { suite: 'regression', status: 'passed', passed: 50, failed: 0 },
        ],
        requested_escalations: [],
        usage: { runtime_ms: 1000 },
      };

      const factors = extractRiskFactorsFromResult(result);
      expect(factors.find(f => f.kind === 'regression_test_passed')?.value).toBe(true);
    });
  });

  describe('detectCoreAreaModification', () => {
    it('should detect auth area modification', () => {
      const files = ['src/auth/login.ts', 'src/utils/helper.ts'];
      expect(detectCoreAreaModification(files)).toBe(true);
    });

    it('should detect payment area modification', () => {
      const files = ['src/payments/checkout.ts'];
      expect(detectCoreAreaModification(files)).toBe(true);
    });

    it('should not detect non-core modification', () => {
      const files = ['src/components/Button.tsx', 'src/utils/format.ts'];
      expect(detectCoreAreaModification(files)).toBe(false);
    });

    it('should use custom core areas', () => {
      const files = ['custom/critical/module.ts'];
      expect(detectCoreAreaModification(files, ['custom/critical/'])).toBe(true);
    });
  });

  describe('analyzeSideEffects', () => {
    it('should analyze escalations for risk factors', () => {
      const escalations: RequestedEscalation[] = [
        { kind: 'network_access', reason: 'API call', approved: true },
        { kind: 'secret_access', reason: 'DB password', approved: true },
      ];

      const factors = analyzeSideEffects(escalations);

      expect(factors.find(f => f.kind === 'network_access')?.value).toBe(true);
      expect(factors.find(f => f.kind === 'secrets_referenced')?.value).toBe(true);
    });

    it('should not include unapproved escalations', () => {
      const escalations: RequestedEscalation[] = [
        { kind: 'network_access', reason: 'API call', approved: false },
      ];

      const factors = analyzeSideEffects(escalations);
      expect(factors.find(f => f.kind === 'network_access')).toBeUndefined();
    });
  });

  describe('RiskIntegrationService', () => {
    describe('assessFromResult', () => {
      it('should assess low risk for simple changes', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [{ suite: 'unit', status: 'passed', passed: 10, failed: 0 }],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
          patch_ref: {
            format: 'unified_diff',
            content: '--- a/src/file.ts\n+++ b/src/file.ts',
          },
        };

        const assessment = service.assessFromResult(result);
        expect(assessment.level).toBe('low');
        expect(assessment.forced_high_factors).toHaveLength(0);
      });

      it('should assess high risk for secret access', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [
            { kind: 'secret_access', reason: 'Need API key', approved: true },
          ],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        expect(assessment.level).toBe('high');
        expect(assessment.forced_high_factors).toContain('secrets_referenced');
      });

      it('should assess high risk for network access', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [
            { kind: 'network_access', reason: 'External API', approved: true },
          ],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        expect(assessment.level).toBe('high');
      });

      it('should generate recommendations', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [
            { kind: 'secret_access', reason: 'Need key', approved: true },
          ],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        expect(assessment.recommendations.length).toBeGreaterThan(0);
        expect(assessment.recommendations.some(r => r.includes('secrets'))).toBe(true);
      });
    });

    describe('requiresManualReview', () => {
      it('should require manual review for high risk', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [
            { kind: 'destructive_tool', reason: 'Delete files', approved: true },
          ],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        expect(service.requiresManualReview(assessment)).toBe(true);
      });

      it('should not require manual review for low risk', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [{ suite: 'unit', status: 'passed', passed: 10, failed: 0 }],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        expect(service.requiresManualReview(assessment)).toBe(false);
      });
    });

    describe('requiresTestVerification', () => {
      it('should require test verification when no coverage', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],  // No tests
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        // When there's no test coverage and no regression test, it triggers forced high
        // The requiresTestVerification checks for 'no_test_coverage' reason
        const hasNoTestCoverage = assessment.assessment.reasons.includes('no_test_coverage');
        expect(hasNoTestCoverage).toBe(true);
        expect(service.requiresTestVerification(assessment)).toBe(true);
      });
    });

    describe('getAcceptanceChecklist', () => {
      it('should return base checklist for low risk', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [{ suite: 'unit', status: 'passed', passed: 10, failed: 0 }],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        const checklist = service.getAcceptanceChecklist(assessment);

        expect(checklist.length).toBe(2);
        expect(checklist.find(c => c.id === 'tests-passed')?.required).toBe(true);
      });

      it('should add code review for medium risk', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [{ suite: 'unit', status: 'passed', passed: 10, failed: 0 }],
          requested_escalations: [],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromFactors([
          { kind: 'file_count', value: 8 },
          { kind: 'test_coverage', value: true },
        ]);

        const checklist = service.getAcceptanceChecklist(assessment);
        expect(checklist.find(c => c.id === 'code-review')).toBeDefined();
      });

      it('should add security review for high risk', () => {
        const result: WorkerResult = {
          job_id: 'job-1',
          typed_ref: 'agent-taskstate:task:local:task-1',
          status: 'succeeded',
          artifacts: [],
          test_results: [],
          requested_escalations: [
            { kind: 'secret_access', reason: 'Need key', approved: true },
          ],
          usage: { runtime_ms: 1000 },
        };

        const assessment = service.assessFromResult(result);
        const checklist = service.getAcceptanceChecklist(assessment);

        expect(checklist.find(c => c.id === 'security-review')).toBeDefined();
        expect(checklist.find(c => c.id === 'secrets-audit')?.reason).toContain('secrets');
      });

      it('should add core review for core area modification', () => {
        const assessment = service.assessFromFactors([
          { kind: 'core_area_modified', value: true },
          { kind: 'test_coverage', value: true },
        ]);

        const checklist = service.getAcceptanceChecklist(assessment);
        expect(checklist.find(c => c.id === 'core-review')?.reason).toContain('core');
      });
    });
  });
});