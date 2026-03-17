export type RiskLevel = 'low' | 'medium' | 'high';

export type ForcedHighFactor =
  | 'secrets_referenced'
  | 'network_access'
  | 'destructive_tool'
  | 'protected_path_write'
  | 'core_area_modified'
  | 'no_test_coverage'
  | 'escalation_requested';

export type MediumRiskReason =
  | 'config_modified'
  | 'dependencies_changed'
  | 'moderate_change_scope';

export type HighRiskReason =
  | 'large_change_scope'
  | ForcedHighFactor;

export type EscalationKind =
  | 'network_access'
  | 'workspace_outside_write'
  | 'protected_path_write'
  | 'destructive_tool'
  | 'secret_access'
  | 'human_verdict';

export interface RiskFactor {
  kind:
    | 'file_count'
    | 'test_coverage'
    | 'secrets_referenced'
    | 'network_access'
    | 'destructive_tool'
    | 'protected_path_write'
    | 'core_area_modified'
    | 'modified_areas'
    | 'config_modified'
    | 'dependencies_changed'
    | 'escalation_requested'
    | 'regression_test_passed';
  value: boolean | number | string[];
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: (HighRiskReason | MediumRiskReason)[];
}

// Core areas that force high risk when modified
const CORE_AREAS = [
  'src/auth/',
  'src/authentication/',
  'src/payment/',
  'src/payments/',
  'src/security/',
  'src/iam/',
  'src/identity/',
  'src/crypto/',
  'src/secrets/',
];

// Thresholds
const MEDIUM_FILE_THRESHOLD = 5;
const HIGH_FILE_THRESHOLD = 20;

export class RiskAssessor {
  assessRisk(factors: RiskFactor[]): RiskAssessment {
    const reasons: (HighRiskReason | MediumRiskReason)[] = [];
    let forcedHigh = false;

    // Check forced high conditions first
    for (const factor of factors) {
      const forcedHighResult = this.checkForcedHigh(factor, factors, reasons);
      if (forcedHighResult) {
        forcedHigh = true;
      }
    }

    // If forced high, return immediately
    if (forcedHigh) {
      return { level: 'high', reasons };
    }

    // Check medium risk conditions
    for (const factor of factors) {
      this.checkMediumRisk(factor, reasons);
    }

    // Determine base risk from file count
    const fileCountFactor = factors.find((f) => f.kind === 'file_count');
    const fileCount = typeof fileCountFactor?.value === 'number' ? fileCountFactor.value : 1;

    if (reasons.length > 0) {
      return { level: 'medium', reasons };
    }

    if (fileCount >= HIGH_FILE_THRESHOLD) {
      return { level: 'high', reasons: ['large_change_scope'] };
    }

    if (fileCount >= MEDIUM_FILE_THRESHOLD) {
      return { level: 'medium', reasons: ['moderate_change_scope'] };
    }

    return { level: 'low', reasons: [] };
  }

  private checkForcedHigh(
    factor: RiskFactor,
    allFactors: RiskFactor[],
    reasons: (HighRiskReason | MediumRiskReason)[],
  ): boolean {
    switch (factor.kind) {
      case 'secrets_referenced':
        if (factor.value === true) {
          reasons.push('secrets_referenced');
          return true;
        }
        break;

      case 'network_access':
        if (factor.value === true) {
          reasons.push('network_access');
          return true;
        }
        break;

      case 'destructive_tool':
        if (factor.value === true) {
          reasons.push('destructive_tool');
          return true;
        }
        break;

      case 'protected_path_write':
        if (factor.value === true) {
          reasons.push('protected_path_write');
          return true;
        }
        break;

      case 'core_area_modified':
        if (factor.value === true) {
          reasons.push('core_area_modified');
          return true;
        }
        break;

      case 'modified_areas':
        if (Array.isArray(factor.value)) {
          const hasCoreArea = factor.value.some((area) =>
            CORE_AREAS.some((core) => area.includes(core) || core.includes(area)),
          );
          if (hasCoreArea) {
            reasons.push('core_area_modified');
            return true;
          }
        }
        break;

      case 'test_coverage':
        if (factor.value === false) {
          // Check if there's a regression test as fallback
          const hasRegression = allFactors.some(
            (f) => f.kind === 'regression_test_passed' && f.value === true,
          );
          if (!hasRegression) {
            reasons.push('no_test_coverage');
            return true;
          }
        }
        break;

      case 'escalation_requested':
        if (Array.isArray(factor.value) && factor.value.length > 0) {
          const highRiskEscalations: EscalationKind[] = [
            'network_access',
            'secret_access',
            'destructive_tool',
            'protected_path_write',
          ];
          const hasHighRiskEscalation = factor.value.some((e) =>
            highRiskEscalations.includes(e as EscalationKind),
          );
          if (hasHighRiskEscalation) {
            reasons.push('escalation_requested');
            return true;
          }
        }
        break;
    }

    return false;
  }

  private checkMediumRisk(
    factor: RiskFactor,
    reasons: (HighRiskReason | MediumRiskReason)[],
  ): void {
    switch (factor.kind) {
      case 'config_modified':
        if (factor.value === true && !reasons.includes('config_modified')) {
          reasons.push('config_modified');
        }
        break;

      case 'dependencies_changed':
        if (factor.value === true && !reasons.includes('dependencies_changed')) {
          reasons.push('dependencies_changed');
        }
        break;
    }
  }
}