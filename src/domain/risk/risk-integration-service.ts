/**
 * Risk Integration Service
 *
 * Integrates RiskAssessor into dispatch/acceptance flow.
 * Extracts risk factors from WorkerResult and determines risk level.
 */

import { RiskAssessor, type RiskFactor, type RiskAssessment, type RiskLevel, type ForcedHighFactor } from './risk-assessor.js';
import type { WorkerResult, RequestedEscalation } from '../../types.js';

export interface RiskIntegrationResult {
  level: RiskLevel;
  assessment: RiskAssessment;
  forced_high_factors: ForcedHighFactor[];
  recommendations: string[];
}

/**
 * Extracts risk factors from WorkerResult.
 */
export function extractRiskFactorsFromResult(result: WorkerResult): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // File count from patch
  if (result.patch_ref?.content) {
    const fileCount = countFilesInPatch(result.patch_ref.content);
    factors.push({ kind: 'file_count', value: fileCount });
  }

  // Escalation requests
  if (result.requested_escalations?.length) {
    const escalationKinds = result.requested_escalations.map(e => e.kind);
    factors.push({ kind: 'escalation_requested', value: escalationKinds });
  }

  // Network access
  const hasNetworkEscalation = result.requested_escalations?.some(
    e => e.kind === 'network_access'
  );
  if (hasNetworkEscalation) {
    factors.push({ kind: 'network_access', value: true });
  }

  // Secret access
  const hasSecretEscalation = result.requested_escalations?.some(
    e => e.kind === 'secret_access'
  );
  if (hasSecretEscalation) {
    factors.push({ kind: 'secrets_referenced', value: true });
  }

  // Destructive tool
  const hasDestructiveEscalation = result.requested_escalations?.some(
    e => e.kind === 'destructive_tool'
  );
  if (hasDestructiveEscalation) {
    factors.push({ kind: 'destructive_tool', value: true });
  }

  // Protected path write
  const hasProtectedPathEscalation = result.requested_escalations?.some(
    e => e.kind === 'protected_path_write'
  );
  if (hasProtectedPathEscalation) {
    factors.push({ kind: 'protected_path_write', value: true });
  }

  // Test results
  if (result.test_results?.length) {
    const allPassed = result.test_results.every(t => t.status === 'passed');
    const hasRegression = result.test_results.some(t => t.suite.includes('regression'));
    factors.push({ kind: 'test_coverage', value: allPassed });
    if (hasRegression && allPassed) {
      factors.push({ kind: 'regression_test_passed', value: true });
    }
  } else {
    // No test results means no test coverage
    factors.push({ kind: 'test_coverage', value: false });
  }

  return factors;
}

/**
 * Counts files in a unified diff patch.
 */
function countFilesInPatch(patch: string): number {
  const fileMatches = patch.match(/^---\s+a\/.+$/gm) || [];
  return fileMatches.length;
}

/**
 * Detects if any modified files are in core areas.
 */
export function detectCoreAreaModification(
  modifiedFiles: string[],
  coreAreas: string[] = [
    'src/auth/',
    'src/authentication/',
    'src/payment/',
    'src/payments/',
    'src/security/',
    'src/iam/',
    'src/identity/',
    'src/crypto/',
    'src/secrets/',
  ]
): boolean {
  return modifiedFiles.some(file =>
    coreAreas.some(area => file.includes(area))
  );
}

/**
 * Analyzes side effects for risk factors.
 */
export function analyzeSideEffects(
  escalations: RequestedEscalation[]
): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // Check for network access
  if (escalations.some(e => e.kind === 'network_access' && e.approved)) {
    factors.push({ kind: 'network_access', value: true });
  }

  // Check for secret access
  if (escalations.some(e => e.kind === 'secret_access' && e.approved)) {
    factors.push({ kind: 'secrets_referenced', value: true });
  }

  // Check for destructive tools
  if (escalations.some(e => e.kind === 'destructive_tool' && e.approved)) {
    factors.push({ kind: 'destructive_tool', value: true });
  }

  // Check for protected path writes
  if (escalations.some(e => e.kind === 'protected_path_write' && e.approved)) {
    factors.push({ kind: 'protected_path_write', value: true });
  }

  return factors;
}

/**
 * Risk Integration Service
 *
 * Provides integrated risk assessment for the Control Plane.
 */
export class RiskIntegrationService {
  private assessor: RiskAssessor;

  constructor() {
    this.assessor = new RiskAssessor();
  }

  /**
   * Assess risk from WorkerResult.
   * Used after dev stage completes to determine acceptance requirements.
   */
  assessFromResult(result: WorkerResult): RiskIntegrationResult {
    const factors = extractRiskFactorsFromResult(result);
    const assessment = this.assessor.assessRisk(factors);

    const forcedHighFactors = assessment.reasons.filter(
      (r): r is ForcedHighFactor => r !== 'large_change_scope' && r !== 'moderate_change_scope'
    );

    const recommendations = this.generateRecommendations(assessment);

    return {
      level: assessment.level,
      assessment,
      forced_high_factors: forcedHighFactors,
      recommendations,
    };
  }

  /**
   * Assess risk from explicit factors.
   * Used when additional context is available.
   */
  assessFromFactors(factors: RiskFactor[], overrideLevel?: 'low' | 'medium' | 'high'): RiskIntegrationResult {
    const assessment = this.assessor.assessRisk(factors);

    // Use override level if provided, otherwise use assessed level
    const level = overrideLevel ?? assessment.level;

    const forcedHighFactors = assessment.reasons.filter(
      (r): r is ForcedHighFactor => r !== 'large_change_scope' && r !== 'moderate_change_scope'
    );

    const recommendations = this.generateRecommendations(assessment);

    return {
      level,
      assessment,
      forced_high_factors: forcedHighFactors,
      recommendations,
    };
  }

  /**
   * Check if task requires manual review.
   */
  requiresManualReview(result: RiskIntegrationResult): boolean {
    return result.level === 'high' || result.forced_high_factors.length > 0;
  }

  /**
   * Check if task requires additional test verification.
   */
  requiresTestVerification(result: RiskIntegrationResult): boolean {
    return result.assessment.reasons.includes('no_test_coverage');
  }

  /**
   * Get acceptance checklist based on risk level.
   */
  getAcceptanceChecklist(result: RiskIntegrationResult): Array<{
    id: string;
    description: string;
    required: boolean;
    reason?: string;
  }> {
    const checklist: Array<{
      id: string;
      description: string;
      required: boolean;
      reason?: string;
    }> = [];

    // Base checklist for all tasks
    checklist.push({
      id: 'tests-passed',
      description: 'All tests passed',
      required: true,
    });

    checklist.push({
      id: 'no-regressions',
      description: 'No regressions introduced',
      required: true,
    });

    // Additional for medium risk
    if (result.level === 'medium' || result.level === 'high') {
      checklist.push({
        id: 'code-review',
        description: 'Code review completed',
        required: true,
      });
    }

    // Additional for high risk
    if (result.level === 'high') {
      checklist.push({
        id: 'security-review',
        description: 'Security review completed',
        required: true,
      });

      checklist.push({
        id: 'performance-check',
        description: 'Performance impact assessed',
        required: true,
      });
    }

    // Specific to forced high factors
    if (result.forced_high_factors.includes('secrets_referenced')) {
      checklist.push({
        id: 'secrets-audit',
        description: 'Secrets handling reviewed and approved',
        required: true,
        reason: 'Task references secrets',
      });
    }

    if (result.forced_high_factors.includes('network_access')) {
      checklist.push({
        id: 'network-review',
        description: 'Network access reviewed and approved',
        required: true,
        reason: 'Task requires network access',
      });
    }

    if (result.forced_high_factors.includes('core_area_modified')) {
      checklist.push({
        id: 'core-review',
        description: 'Core area changes reviewed by senior engineer',
        required: true,
        reason: 'Task modifies core functionality',
      });
    }

    return checklist;
  }

  private generateRecommendations(assessment: RiskAssessment): string[] {
    const recommendations: string[] = [];

    if (assessment.level === 'high') {
      recommendations.push('Require additional manual verification before acceptance');
      recommendations.push('Consider staging deployment before production');
    }

    if (assessment.reasons.includes('secrets_referenced')) {
      recommendations.push('Ensure secrets are properly masked in logs');
      recommendations.push('Verify secret access is logged for audit');
    }

    if (assessment.reasons.includes('network_access')) {
      recommendations.push('Verify network requests are to approved endpoints');
    }

    if (assessment.reasons.includes('core_area_modified')) {
      recommendations.push('Require senior engineer sign-off');
      recommendations.push('Run extended test suite');
    }

    if (assessment.reasons.includes('no_test_coverage')) {
      recommendations.push('Add tests before merging');
    }

    if (assessment.reasons.includes('config_modified')) {
      recommendations.push('Review configuration changes carefully');
    }

    if (assessment.reasons.includes('dependencies_changed')) {
      recommendations.push('Run dependency security scan');
    }

    return recommendations;
  }
}

/**
 * Default risk integration service instance.
 */
export const defaultRiskIntegrationService = new RiskIntegrationService();