import { describe, it, expect, beforeEach } from 'vitest';
import { DoomLoopDetector } from '../src/domain/doom-loop/index.js';

describe('DoomLoopDetector', () => {
  let detector: DoomLoopDetector;

  beforeEach(() => {
    detector = new DoomLoopDetector({
      max_repeats: 3,
      window_minutes: 30,
      cooldown_minutes: 5,
    });
  });

  describe('trackTransition', () => {
    it('should record a state transition', () => {
      detector.trackTransition({
        job_id: 'job_1',
        from_state: 'planned',
        to_state: 'developing',
        stage: 'dev',
      });

      const transitions = detector.getTransitionHistory('job_1');
      expect(transitions).toHaveLength(1);
    });

    it('should record multiple transitions', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'dev_completed', stage: 'acceptance' });

      const transitions = detector.getTransitionHistory('job_1');
      expect(transitions).toHaveLength(2);
    });
  });

  describe('detectLoop', () => {
    it('should not detect loop with unique transitions', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'dev_completed', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'dev_completed', to_state: 'integrated', stage: 'integrate' });

      const result = detector.detectLoop('job_1');
      expect(result).toBeNull();
    });

    it('should detect simple loop (A->B->A)', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      const result = detector.detectLoop('job_1');
      expect(result).not.toBeNull();
      expect(result?.loop_type).toBe('simple');
      expect(result?.states).toEqual(['planned', 'developing']);
    });

    it('should detect complex loop (A->B->C->A)', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      const result = detector.detectLoop('job_1');
      expect(result).not.toBeNull();
      expect(result?.loop_type).toBe('complex');
    });

    it('should detect repeated state visits', () => {
      // Visit 'developing' 4 times
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'developing', stage: 'dev' });

      const result = detector.detectLoop('job_1');
      expect(result).not.toBeNull();
      expect(result?.loop_type).toBe('state_repeat');
      expect(result?.repeat_count).toBe(4);
    });

    it('should not detect loop below threshold', () => {
      // Only 2 visits (below max_repeats=3)
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'developing', stage: 'dev' });

      const result = detector.detectLoop('job_1');
      expect(result).toBeNull();
    });
  });

  describe('isInCooldown', () => {
    it('should not be in cooldown initially', () => {
      expect(detector.isInCooldown('job_1')).toBe(false);
    });

    it('should be in cooldown after loop detected', () => {
      // Create a loop
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      detector.detectLoop('job_1');
      expect(detector.isInCooldown('job_1')).toBe(true);
    });
  });

  describe('getRecommendedAction', () => {
    it('should recommend continue when no loop', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      const action = detector.getRecommendedAction('job_1');
      expect(action.action).toBe('continue');
    });

    it('should recommend escalation for simple loop', () => {
      // Create a simple loop
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      detector.detectLoop('job_1');
      const action = detector.getRecommendedAction('job_1');
      expect(action.action).toBe('escalate');
      expect(action.reason).toContain('loop detected');
    });

    it('should recommend block for state_repeat loop', () => {
      // Create repeated state visits
      for (let i = 0; i < 4; i++) {
        detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
        detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'rework_required', stage: 'acceptance' });
        detector.trackTransition({ job_id: 'job_1', from_state: 'rework_required', to_state: 'planned', stage: 'plan' });
      }

      detector.detectLoop('job_1');
      const action = detector.getRecommendedAction('job_1');
      expect(action.action).toBe('block');
    });
  });

  describe('clearHistory', () => {
    it('should clear transition history for a job', () => {
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      detector.clearHistory('job_1');

      const transitions = detector.getTransitionHistory('job_1');
      expect(transitions).toHaveLength(0);
    });
  });

  describe('getLoopStats', () => {
    it('should return loop statistics', () => {
      // Create a loop
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_1', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      const loop = detector.detectLoop('job_1');
      const stats = detector.getLoopStats('job_1');

      expect(stats.detected).toBe(true);
      expect(stats.loop_type).toBe(loop?.loop_type);
    });

    it('should return empty stats for job without loop', () => {
      const stats = detector.getLoopStats('job_1');
      expect(stats.detected).toBe(false);
    });
  });
});