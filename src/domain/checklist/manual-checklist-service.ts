/**
 * Manual Checklist Service
 *
 * Generates and validates manual verification checklists
 * for tasks based on risk level and context.
 */

import type { ManualChecklistItem, Task } from '../../types.js';
import type { RiskIntegrationResult } from '../risk/risk-integration-service.js';

export interface ChecklistTemplate {
  id: string;
  description: string;
  required: boolean;
  applies_to: ('low' | 'medium' | 'high')[];
  triggers?: string[];
}

/**
 * Default checklist templates by risk level
 */
export const DEFAULT_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  // Base items for all risk levels
  {
    id: 'tests-passed',
    description: 'All automated tests passed',
    required: true,
    applies_to: ['low', 'medium', 'high'],
  },
  {
    id: 'no-regressions',
    description: 'No regressions in existing functionality',
    required: true,
    applies_to: ['low', 'medium', 'high'],
  },
  {
    id: 'code-compiles',
    description: 'Code compiles without errors',
    required: true,
    applies_to: ['low', 'medium', 'high'],
  },

  // Medium risk items
  {
    id: 'code-review',
    description: 'Code review completed',
    required: true,
    applies_to: ['medium', 'high'],
  },
  {
    id: 'docs-updated',
    description: 'Documentation updated if applicable',
    required: false,
    applies_to: ['medium', 'high'],
  },

  // High risk items
  {
    id: 'security-review',
    description: 'Security review completed',
    required: true,
    applies_to: ['high'],
  },
  {
    id: 'performance-check',
    description: 'Performance impact assessed',
    required: true,
    applies_to: ['high'],
  },
  {
    id: 'rollback-plan',
    description: 'Rollback plan documented',
    required: true,
    applies_to: ['high'],
    triggers: ['rollback_notes_required'],
  },
  {
    id: 'stakeholder-approval',
    description: 'Stakeholder approval obtained',
    required: true,
    applies_to: ['high'],
    triggers: ['high_risk'],
  },

  // Special trigger items
  {
    id: 'secrets-handled',
    description: 'Secrets handling reviewed and approved',
    required: true,
    applies_to: ['low', 'medium', 'high'],
    triggers: ['secrets_referenced'],
  },
  {
    id: 'network-approved',
    description: 'Network access approved',
    required: true,
    applies_to: ['low', 'medium', 'high'],
    triggers: ['network_access'],
  },
  {
    id: 'core-review',
    description: 'Core area changes reviewed by senior engineer',
    required: true,
    applies_to: ['low', 'medium', 'high'],
    triggers: ['core_area_modified'],
  },
  {
    id: 'breaking-changes',
    description: 'Breaking changes documented and communicated',
    required: true,
    applies_to: ['low', 'medium', 'high'],
    triggers: ['breaking_change'],
  },
];

/**
 * Manual Checklist Service
 */
export class ManualChecklistService {
  private templates: ChecklistTemplate[];

  constructor(customTemplates?: ChecklistTemplate[]) {
    this.templates = customTemplates ?? DEFAULT_CHECKLIST_TEMPLATES;
  }

  /**
   * Generate a checklist for a task based on risk assessment.
   */
  generateChecklist(
    _task: Task,
    riskAssessment: RiskIntegrationResult,
    additionalTriggers: string[] = []
  ): ManualChecklistItem[] {
    const items: ManualChecklistItem[] = [];
    const riskLevel = riskAssessment.level;
    const triggers = new Set([
      ...additionalTriggers,
      ...riskAssessment.forced_high_factors,
    ]);

    // Add high risk trigger if applicable
    if (riskLevel === 'high') {
      triggers.add('high_risk');
    }

    for (const template of this.templates) {
      // Check if template applies to this risk level
      if (!template.applies_to.includes(riskLevel)) {
        continue;
      }

      // Check if trigger conditions are met
      if (template.triggers && template.triggers.length > 0) {
        const hasTrigger = template.triggers.some(t => triggers.has(t));
        if (!hasTrigger) {
          continue;
        }
      }

      items.push({
        id: template.id,
        description: template.description,
        required: template.required,
        checked: false,
      });
    }

    return items;
  }

  /**
   * Validate that all required checklist items are checked.
   */
  validateChecklist(checklist: ManualChecklistItem[]): {
    valid: boolean;
    missing: string[];
  } {
    const missing: string[] = [];

    for (const item of checklist) {
      if (item.required && !item.checked) {
        missing.push(item.id);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Check a specific item in the checklist.
   */
  checkItem(
    checklist: ManualChecklistItem[],
    itemId: string,
    checkedBy?: string,
    notes?: string
  ): ManualChecklistItem[] {
    return checklist.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          checked: true,
          checked_by: checkedBy,
          checked_at: new Date().toISOString(),
          notes,
        };
      }
      return item;
    });
  }

  /**
   * Uncheck a specific item in the checklist.
   */
  uncheckItem(checklist: ManualChecklistItem[], itemId: string): ManualChecklistItem[] {
    return checklist.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          checked: false,
          checked_by: undefined,
          checked_at: undefined,
          notes: undefined,
        };
      }
      return item;
    });
  }

  /**
   * Get completion percentage of the checklist.
   */
  getCompletionPercentage(checklist: ManualChecklistItem[]): number {
    if (checklist.length === 0) return 100;

    const checked = checklist.filter(item => item.checked).length;
    return Math.round((checked / checklist.length) * 100);
  }

  /**
   * Get required items completion percentage.
   */
  getRequiredCompletionPercentage(checklist: ManualChecklistItem[]): number {
    const required = checklist.filter(item => item.required);
    if (required.length === 0) return 100;

    const checked = required.filter(item => item.checked).length;
    return Math.round((checked / required.length) * 100);
  }

  /**
   * Add a custom item to the checklist.
   */
  addCustomItem(
    checklist: ManualChecklistItem[],
    description: string,
    required: boolean = false
  ): ManualChecklistItem[] {
    const customId = `custom-${Date.now()}`;
    return [
      ...checklist,
      {
        id: customId,
        description,
        required,
        checked: false,
      },
    ];
  }

  /**
   * Get unchecked required items.
   */
  getUncheckedRequired(checklist: ManualChecklistItem[]): ManualChecklistItem[] {
    return checklist.filter(item => item.required && !item.checked);
  }

  /**
   * Generate summary for display.
   */
  getSummary(checklist: ManualChecklistItem[]): {
    total: number;
    checked: number;
    required_total: number;
    required_checked: number;
    complete: boolean;
  } {
    const required = checklist.filter(item => item.required);
    const checked = checklist.filter(item => item.checked);
    const requiredChecked = required.filter(item => item.checked);

    return {
      total: checklist.length,
      checked: checked.length,
      required_total: required.length,
      required_checked: requiredChecked.length,
      complete: required.length === requiredChecked.length,
    };
  }
}

/**
 * Default manual checklist service instance.
 */
export const defaultManualChecklistService = new ManualChecklistService();