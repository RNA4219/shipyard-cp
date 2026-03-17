export type SideEffectCategory =
  | 'network_access'
  | 'workspace_outside_write'
  | 'protected_path_write'
  | 'destructive_tool'
  | 'secret_access'
  | 'external_release';

export type RiskImpact = 'low' | 'medium' | 'high';

export type EscalationKind =
  | 'network_access'
  | 'workspace_outside_write'
  | 'protected_path_write'
  | 'destructive_tool'
  | 'secret_access'
  | 'human_verdict';

export type PublishTarget = 'deployment' | 'release' | 'package_publish' | 'external_api';

export interface SideEffectInput {
  requested_outputs: string[];
  escalation_requests: EscalationKind[];
  publish_targets?: PublishTarget[];
}

export interface SideEffectResult {
  categories: SideEffectCategory[];
  requires_approval: boolean;
  risk_impact: RiskImpact;
}

// Categories that always require approval
const APPROVAL_REQUIRED_CATEGORIES: SideEffectCategory[] = [
  'network_access',
  'workspace_outside_write',
  'protected_path_write',
  'destructive_tool',
  'secret_access',
  'external_release',
];

// Categories that indicate high risk
const HIGH_RISK_CATEGORIES: SideEffectCategory[] = [
  'secret_access',
  'destructive_tool',
  'protected_path_write',
];

// Categories that indicate medium risk
const MEDIUM_RISK_CATEGORIES: SideEffectCategory[] = [
  'network_access',
  'workspace_outside_write',
  'external_release',
];

export class SideEffectAnalyzer {
  analyzeSideEffects(input: SideEffectInput): SideEffectResult {
    const categories: SideEffectCategory[] = [];

    // Add categories from escalation requests
    for (const escalation of input.escalation_requests) {
      if (escalation !== 'human_verdict') {
        categories.push(escalation as SideEffectCategory);
      }
    }

    // Check for external release from publish targets
    if (input.publish_targets?.includes('external_api')) {
      if (!categories.includes('external_release')) {
        categories.push('external_release');
      }
    }

    // Determine if approval is required
    const requiresApproval = categories.some((c) => APPROVAL_REQUIRED_CATEGORIES.includes(c));

    // Determine risk impact
    const riskImpact = this.determineRiskImpact(categories);

    return {
      categories,
      requires_approval: requiresApproval,
      risk_impact: riskImpact,
    };
  }

  isAllowed(categories: SideEffectCategory[], allowedCategories: SideEffectCategory[]): boolean {
    if (categories.length === 0) {
      return true;
    }
    return categories.every((c) => allowedCategories.includes(c));
  }

  private determineRiskImpact(categories: SideEffectCategory[]): RiskImpact {
    if (categories.length === 0) {
      return 'low';
    }

    // High risk if any high-risk category is present
    if (categories.some((c) => HIGH_RISK_CATEGORIES.includes(c))) {
      return 'high';
    }

    // Medium risk if any medium-risk category is present
    if (categories.some((c) => MEDIUM_RISK_CATEGORIES.includes(c))) {
      return 'medium';
    }

    return 'low';
  }
}