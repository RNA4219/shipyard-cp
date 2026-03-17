import { describe, it, expect } from 'vitest';
import { SideEffectAnalyzer, type SideEffectInput, type SideEffectCategory } from '../src/domain/side-effect/index.js';

describe('SideEffectAnalyzer', () => {
  const analyzer = new SideEffectAnalyzer();

  describe('analyzeSideEffects', () => {
    it('should detect network access from URLs', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['network_access'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('network_access');
      expect(result.requires_approval).toBe(true);
    });

    it('should detect workspace outside write', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['workspace_outside_write'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('workspace_outside_write');
      expect(result.requires_approval).toBe(true);
    });

    it('should detect protected path write', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['protected_path_write'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('protected_path_write');
      expect(result.requires_approval).toBe(true);
    });

    it('should detect destructive tool', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['destructive_tool'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('destructive_tool');
      expect(result.requires_approval).toBe(true);
    });

    it('should detect secret access', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['secret_access'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('secret_access');
      expect(result.requires_approval).toBe(true);
    });
  });

  describe('no side effects', () => {
    it('should return empty for normal patch', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: [],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toHaveLength(0);
      expect(result.requires_approval).toBe(false);
    });

    it('should return empty for branch only', () => {
      const input: SideEffectInput = {
        requested_outputs: ['branch'],
        escalation_requests: [],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toHaveLength(0);
    });
  });

  describe('multiple side effects', () => {
    it('should detect multiple categories', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['network_access', 'secret_access'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toHaveLength(2);
      expect(result.categories).toContain('network_access');
      expect(result.categories).toContain('secret_access');
    });
  });

  describe('approval requirement', () => {
    it('should require approval for any escalation', () => {
      const categories: SideEffectCategory[] = [
        'network_access',
        'workspace_outside_write',
        'protected_path_write',
        'destructive_tool',
        'secret_access',
      ];

      for (const category of categories) {
        const input: SideEffectInput = {
          requested_outputs: ['patch'],
          escalation_requests: [category],
        };

        const result = analyzer.analyzeSideEffects(input);
        expect(result.requires_approval).toBe(true);
      }
    });

    it('should not require approval for human verdict only', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['human_verdict'],
      };

      const result = analyzer.analyzeSideEffects(input);
      // human_verdict is about needing human input, not a side effect
      expect(result.requires_approval).toBe(false);
    });
  });

  describe('isAllowed', () => {
    it('should allow if category is in allowed list', () => {
      const result = analyzer.isAllowed(['network_access'], ['network_access']);
      expect(result).toBe(true);
    });

    it('should deny if category is not in allowed list', () => {
      const result = analyzer.isAllowed(['network_access', 'secret_access'], ['network_access']);
      expect(result).toBe(false);
    });

    it('should allow if all categories are in allowed list', () => {
      const result = analyzer.isAllowed(
        ['network_access', 'workspace_outside_write'],
        ['network_access', 'workspace_outside_write'],
      );
      expect(result).toBe(true);
    });

    it('should allow empty categories', () => {
      const result = analyzer.isAllowed([], ['network_access']);
      expect(result).toBe(true);
    });
  });

  describe('risk level impact', () => {
    it('should mark high risk for secret access', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['secret_access'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.risk_impact).toBe('high');
    });

    it('should mark high risk for destructive tool', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['destructive_tool'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.risk_impact).toBe('high');
    });

    it('should mark medium risk for network access', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: ['network_access'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.risk_impact).toBe('medium');
    });

    it('should mark low risk for no side effects', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: [],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.risk_impact).toBe('low');
    });
  });

  describe('external release detection', () => {
    it('should detect external release from publish targets', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: [],
        publish_targets: ['external_api', 'deployment'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).toContain('external_release');
      expect(result.requires_approval).toBe(true);
    });

    it('should not detect external release for internal targets', () => {
      const input: SideEffectInput = {
        requested_outputs: ['patch'],
        escalation_requests: [],
        publish_targets: ['deployment'],
      };

      const result = analyzer.analyzeSideEffects(input);
      expect(result.categories).not.toContain('external_release');
    });
  });
});