import { describe, it, expect } from 'vitest';
import { ManualChecklistService } from '../src/domain/checklist/index.js';
import { DEFAULT_CHECKLIST_TEMPLATES } from '../src/domain/checklist/manual-checklist-service.js';
import type { Task, RiskIntegrationResult } from '../src/types.js';

describe('ManualChecklistService', () => {
  const service = new ManualChecklistService();

  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    task_id: 'task-123',
    title: 'Test Task',
    objective: 'Test objective',
    typed_ref: 'agent-taskstate:task:local:task-123',
    state: 'developing',
    version: 0,
    risk_level: 'low',
    repo_ref: {
      provider: 'github',
      owner: 'test',
      name: 'repo',
      default_branch: 'main',
    },
    created_at: '2026-03-18T00:00:00Z',
    updated_at: '2026-03-18T00:00:00Z',
    ...overrides,
  });

  const createMockRiskAssessment = (
    level: 'low' | 'medium' | 'high',
    forcedHighFactors: string[] = []
  ): RiskIntegrationResult => ({
    level,
    assessment: { level, reasons: [] },
    forced_high_factors: forcedHighFactors,
    recommendations: [],
  });

  describe('generateChecklist', () => {
    it('should generate basic checklist for low risk', () => {
      const task = createMockTask({ risk_level: 'low' });
      const risk = createMockRiskAssessment('low');

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.length).toBeGreaterThan(0);
      expect(checklist.every(item => item.applies_to === undefined)).toBe(true);
      expect(checklist.some(item => item.id === 'tests-passed')).toBe(true);
      expect(checklist.some(item => item.id === 'no-regressions')).toBe(true);
    });

    it('should add code review for medium risk', () => {
      const task = createMockTask({ risk_level: 'medium' });
      const risk = createMockRiskAssessment('medium');

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.some(item => item.id === 'code-review')).toBe(true);
      expect(checklist.some(item => item.id === 'docs-updated')).toBe(true);
    });

    it('should add security review for high risk', () => {
      const task = createMockTask({ risk_level: 'high' });
      const risk = createMockRiskAssessment('high');

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.some(item => item.id === 'security-review')).toBe(true);
      expect(checklist.some(item => item.id === 'performance-check')).toBe(true);
      // rollback-plan and stakeholder-approval require triggers, so not in basic high risk
      expect(checklist.some(item => item.id === 'stakeholder-approval')).toBe(true);
    });

    it('should add trigger-based items', () => {
      const task = createMockTask();
      const risk = createMockRiskAssessment('low', ['secrets_referenced']);

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.some(item => item.id === 'secrets-handled')).toBe(true);
    });

    it('should add core review for core area modification', () => {
      const task = createMockTask();
      const risk = createMockRiskAssessment('low', ['core_area_modified']);

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.some(item => item.id === 'core-review')).toBe(true);
    });

    it('should not check items by default', () => {
      const task = createMockTask({ risk_level: 'low' });
      const risk = createMockRiskAssessment('low');

      const checklist = service.generateChecklist(task, risk);

      expect(checklist.every(item => item.checked === false)).toBe(true);
    });
  });

  describe('validateChecklist', () => {
    it('should return valid when all required items are checked', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: true },
      ];

      const result = service.validateChecklist(checklist);

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should return invalid when required items are unchecked', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: false },
      ];

      const result = service.validateChecklist(checklist);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('item-2');
    });

    it('should ignore optional unchecked items', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: false, checked: false },
      ];

      const result = service.validateChecklist(checklist);

      expect(result.valid).toBe(true);
    });
  });

  describe('checkItem', () => {
    it('should check an item', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: false },
      ];

      const updated = service.checkItem(checklist, 'item-1', 'user-123', 'All good');

      expect(updated[0].checked).toBe(true);
      expect(updated[0].checked_by).toBe('user-123');
      expect(updated[0].notes).toBe('All good');
      expect(updated[0].checked_at).toBeDefined();
    });

    it('should not modify other items', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: false },
        { id: 'item-2', description: 'Item 2', required: true, checked: false },
      ];

      const updated = service.checkItem(checklist, 'item-1');

      expect(updated[0].checked).toBe(true);
      expect(updated[1].checked).toBe(false);
    });
  });

  describe('uncheckItem', () => {
    it('should uncheck an item', () => {
      const checklist = [
        {
          id: 'item-1',
          description: 'Item 1',
          required: true,
          checked: true,
          checked_by: 'user',
          checked_at: '2026-03-18T00:00:00Z',
        },
      ];

      const updated = service.uncheckItem(checklist, 'item-1');

      expect(updated[0].checked).toBe(false);
      expect(updated[0].checked_by).toBeUndefined();
      expect(updated[0].checked_at).toBeUndefined();
    });
  });

  describe('getCompletionPercentage', () => {
    it('should return correct percentage', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: true },
        { id: 'item-3', description: 'Item 3', required: true, checked: false },
        { id: 'item-4', description: 'Item 4', required: true, checked: false },
      ];

      expect(service.getCompletionPercentage(checklist)).toBe(50);
    });

    it('should return 100 for empty checklist', () => {
      expect(service.getCompletionPercentage([])).toBe(100);
    });
  });

  describe('getRequiredCompletionPercentage', () => {
    it('should only count required items', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: false },
        { id: 'item-3', description: 'Item 3', required: false, checked: false },
      ];

      expect(service.getRequiredCompletionPercentage(checklist)).toBe(50);
    });
  });

  describe('addCustomItem', () => {
    it('should add a custom item', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: false },
      ];

      const updated = service.addCustomItem(checklist, 'Custom check', true);

      expect(updated.length).toBe(2);
      expect(updated[1].description).toBe('Custom check');
      expect(updated[1].required).toBe(true);
      expect(updated[1].id).toContain('custom-');
    });
  });

  describe('getUncheckedRequired', () => {
    it('should return unchecked required items', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: false },
        { id: 'item-3', description: 'Item 3', required: false, checked: false },
      ];

      const unchecked = service.getUncheckedRequired(checklist);

      expect(unchecked.length).toBe(1);
      expect(unchecked[0].id).toBe('item-2');
    });
  });

  describe('getSummary', () => {
    it('should return correct summary', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: false },
        { id: 'item-3', description: 'Item 3', required: false, checked: true },
      ];

      const summary = service.getSummary(checklist);

      expect(summary.total).toBe(3);
      expect(summary.checked).toBe(2);
      expect(summary.required_total).toBe(2);
      expect(summary.required_checked).toBe(1);
      expect(summary.complete).toBe(false);
    });

    it('should return complete when all required are checked', () => {
      const checklist = [
        { id: 'item-1', description: 'Item 1', required: true, checked: true },
        { id: 'item-2', description: 'Item 2', required: true, checked: true },
        { id: 'item-3', description: 'Item 3', required: false, checked: false },
      ];

      const summary = service.getSummary(checklist);

      expect(summary.complete).toBe(true);
    });
  });

  describe('DEFAULT_CHECKLIST_TEMPLATES', () => {
    it('should have templates defined', () => {
      expect(DEFAULT_CHECKLIST_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('should have required fields', () => {
      for (const template of DEFAULT_CHECKLIST_TEMPLATES) {
        expect(template.id).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.required).toBeDefined();
        expect(template.applies_to.length).toBeGreaterThan(0);
      }
    });
  });
});