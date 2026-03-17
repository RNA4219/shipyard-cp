import { describe, it, expect } from 'vitest';
import { StateMachine } from '../src/domain/state-machine/index.js';
import type { TaskState } from '../src/domain/state-machine/index.js';

describe('StateMachine', () => {
  describe('getAllowedTransitions', () => {
    it('should return allowed transitions for queued state', () => {
      const machine = new StateMachine();
      const allowed = machine.getAllowedTransitions('queued');

      expect(allowed).toContain('queued');
      expect(allowed).toContain('planning');
      expect(allowed).toContain('cancelled');
      expect(allowed).toContain('failed');
      expect(allowed).not.toContain('published');
    });

    it('should return allowed transitions for planned state', () => {
      const machine = new StateMachine();
      const allowed = machine.getAllowedTransitions('planned');

      expect(allowed).toContain('developing');
      expect(allowed).toContain('cancelled');
      expect(allowed).not.toContain('accepting');
    });

    it('should return allowed transitions for accepted state', () => {
      const machine = new StateMachine();
      const allowed = machine.getAllowedTransitions('accepted');

      expect(allowed).toContain('integrating');
      expect(allowed).not.toContain('publishing');
    });

    it('should return allowed transitions for integrated state', () => {
      const machine = new StateMachine();
      const allowed = machine.getAllowedTransitions('integrated');

      expect(allowed).toContain('publish_pending_approval');
      expect(allowed).toContain('publishing');
    });

    it('should return allowed transitions for blocked state', () => {
      const machine = new StateMachine();
      const allowed = machine.getAllowedTransitions('blocked');

      expect(allowed).toContain('planning');
      expect(allowed).toContain('developing');
      expect(allowed).toContain('accepting');
      expect(allowed).toContain('integrating');
      expect(allowed).toContain('publishing');
    });
  });

  describe('canTransition', () => {
    it('should return true for valid transition', () => {
      const machine = new StateMachine();

      expect(machine.canTransition('queued', 'planning')).toBe(true);
      expect(machine.canTransition('planned', 'developing')).toBe(true);
      expect(machine.canTransition('accepted', 'integrating')).toBe(true);
    });

    it('should return false for invalid transition', () => {
      const machine = new StateMachine();

      expect(machine.canTransition('queued', 'published')).toBe(false);
      expect(machine.canTransition('queued', 'accepting')).toBe(false);
      expect(machine.canTransition('planned', 'accepting')).toBe(false);
    });
  });

  describe('validateTransition', () => {
    it('should not throw for valid transition', () => {
      const machine = new StateMachine();

      expect(() => machine.validateTransition('queued', 'planning')).not.toThrow();
      expect(() => machine.validateTransition('planned', 'developing')).not.toThrow();
    });

    it('should throw for invalid transition', () => {
      const machine = new StateMachine();

      expect(() => machine.validateTransition('queued', 'published')).toThrow(
        'transition not allowed: queued -> published'
      );
      expect(() => machine.validateTransition('planned', 'accepting')).toThrow(
        'transition not allowed: planned -> accepting'
      );
    });
  });

  describe('getAllowedDispatchStage', () => {
    it('should return plan for queued state', () => {
      const machine = new StateMachine();
      expect(machine.getAllowedDispatchStage('queued')).toBe('plan');
    });

    it('should return dev for planned and rework_required states', () => {
      const machine = new StateMachine();
      expect(machine.getAllowedDispatchStage('planned')).toBe('dev');
      expect(machine.getAllowedDispatchStage('rework_required')).toBe('dev');
    });

    it('should return acceptance for dev_completed state', () => {
      const machine = new StateMachine();
      expect(machine.getAllowedDispatchStage('dev_completed')).toBe('acceptance');
    });

    it('should throw for states that cannot dispatch', () => {
      const machine = new StateMachine();

      expect(() => machine.getAllowedDispatchStage('planning')).toThrow(
        'state planning cannot dispatch a worker job'
      );
      expect(() => machine.getAllowedDispatchStage('published')).toThrow();
    });
  });

  describe('stageToActiveState', () => {
    it('should map plan stage to planning state', () => {
      const machine = new StateMachine();
      expect(machine.stageToActiveState('plan')).toBe('planning');
    });

    it('should map dev stage to developing state', () => {
      const machine = new StateMachine();
      expect(machine.stageToActiveState('dev')).toBe('developing');
    });

    it('should map acceptance stage to accepting state', () => {
      const machine = new StateMachine();
      expect(machine.stageToActiveState('acceptance')).toBe('accepting');
    });
  });

  describe('isTerminal', () => {
    it('should return true for terminal states', () => {
      const machine = new StateMachine();
      const terminalStates: TaskState[] = ['completed', 'cancelled', 'failed', 'published'];

      terminalStates.forEach((state) => {
        expect(machine.isTerminal(state)).toBe(true);
      });
    });

    it('should return false for non-terminal states', () => {
      const machine = new StateMachine();
      const nonTerminalStates: TaskState[] = ['queued', 'planning', 'planned', 'developing', 'accepted', 'integrated'];

      nonTerminalStates.forEach((state) => {
        expect(machine.isTerminal(state)).toBe(false);
      });
    });
  });
});