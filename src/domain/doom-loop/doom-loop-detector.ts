import type {
  DoomLoopConfig,
  TransitionRecord,
  LoopDetectionResult,
  RecommendedAction,
  LoopStats,
} from './types.js';
import { DEFAULT_DOOM_LOOP_CONFIG } from './types.js';

export class DoomLoopDetector {
  private readonly config: DoomLoopConfig;
  private readonly transitionHistory = new Map<string, TransitionRecord[]>();
  private readonly loopResults = new Map<string, LoopDetectionResult>();
  private readonly cooldownStart = new Map<string, string>();

  constructor(config: Partial<DoomLoopConfig> = {}) {
    this.config = { ...DEFAULT_DOOM_LOOP_CONFIG, ...config };
  }

  recordTransition(params: {
    job_id: string;
    from_state: string;
    to_state: string;
    stage: string;
  }): void {
    const { job_id, from_state, to_state, stage } = params;

    if (!this.transitionHistory.has(job_id)) {
      this.transitionHistory.set(job_id, []);
    }

    const history = this.transitionHistory.get(job_id);
    if (history) {
      history.push({
        from_state,
        to_state,
        stage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  getTransitionHistory(jobId: string): TransitionRecord[] {
    return this.transitionHistory.get(jobId) ?? [];
  }

  detectLoop(jobId: string): LoopDetectionResult | null {
    const history = this.getTransitionHistory(jobId);
    if (history.length < 2) {
      return null;
    }

    // Count state visits (including from_state of first transition)
    const stateVisits: Record<string, number> = {};
    // Count first state
    if (history.length > 0) {
      stateVisits[history[0].from_state] = 1;
    }
    for (const record of history) {
      stateVisits[record.to_state] = (stateVisits[record.to_state] ?? 0) + 1;
    }

    // Check for state repeat (same state visited more than max_repeats times)
    for (const [state, count] of Object.entries(stateVisits)) {
      if (count > this.config.max_repeats) {
        const result: LoopDetectionResult = {
          loop_type: 'state_repeat',
          states: [state],
          repeat_count: count,
          detected_at: new Date().toISOString(),
        };
        this.loopResults.set(jobId, result);
        this.cooldownStart.set(jobId, new Date().toISOString());
        return result;
      }
    }

    // Build state sequence including starting state
    const stateSequence: string[] = [];
    if (history.length > 0) {
      stateSequence.push(history[0].from_state);
    }
    for (const record of history) {
      stateSequence.push(record.to_state);
    }

    // Check for simple loop: oscillating between exactly two states
    // A->B->A pattern requires at least 3 states in sequence (A, B, A)
    const uniqueStates = new Set(stateSequence);
    if (uniqueStates.size === 2 && stateSequence.length >= 3) {
      const states = Array.from(uniqueStates);
      const result: LoopDetectionResult = {
        loop_type: 'simple',
        states,
        detected_at: new Date().toISOString(),
      };
      this.loopResults.set(jobId, result);
      this.cooldownStart.set(jobId, new Date().toISOString());
      return result;
    }

    // Check for complex loop: returning to a state after visiting others
    // Only detect if a state appears >= max_repeats times
    const complexLoop = this.detectComplexLoop(stateSequence, stateVisits);
    if (complexLoop) {
      const result: LoopDetectionResult = {
        loop_type: 'complex',
        states: complexLoop.states,
        detected_at: new Date().toISOString(),
      };
      this.loopResults.set(jobId, result);
      this.cooldownStart.set(jobId, new Date().toISOString());
      return result;
    }

    return null;
  }

  private detectComplexLoop(sequence: string[], _stateVisits: Record<string, number>): { states: string[] } | null {
    if (sequence.length < 5) return null;

    // Complex loop: return to the starting state after visiting other states
    // This indicates a complete cycle
    const startState = sequence[0];
    const startStatePositions: number[] = [];

    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] === startState) {
        startStatePositions.push(i);
      }
    }

    // Check if starting state appears again after at least 2 other states
    if (startStatePositions.length >= 2) {
      const firstPos = startStatePositions[0];
      const lastPos = startStatePositions[startStatePositions.length - 1];

      if (lastPos - firstPos >= 3) {
        // We have a return to the starting state after visiting other states
        const loopStates = sequence.slice(firstPos, lastPos);
        return { states: loopStates };
      }
    }

    return null;
  }

  isInCooldown(jobId: string): boolean {
    const cooldownStartStr = this.cooldownStart.get(jobId);
    if (!cooldownStartStr) {
      return false;
    }

    const cooldownStart = new Date(cooldownStartStr).getTime();
    const now = Date.now();
    const cooldownMs = this.config.cooldown_minutes * 60 * 1000;

    return now - cooldownStart < cooldownMs;
  }

  getRecommendedAction(jobId: string): RecommendedAction {
    const loop = this.loopResults.get(jobId);

    if (!loop) {
      return { action: 'continue' };
    }

    // Start cooldown if not already in cooldown
    if (!this.isInCooldown(jobId)) {
      this.cooldownStart.set(jobId, new Date().toISOString());
    }

    switch (loop.loop_type) {
      case 'simple':
        return {
          action: 'escalate',
          reason: `Simple loop detected between states: ${loop.states.join(' <-> ')}`,
        };

      case 'complex':
        return {
          action: 'escalate',
          reason: `Complex loop detected: ${loop.states.join(' -> ')} -> ...`,
        };

      case 'state_repeat':
        return {
          action: 'block',
          reason: `State '${loop.states[0]}' visited ${loop.repeat_count} times, exceeding threshold of ${this.config.max_repeats}`,
        };

      default:
        return { action: 'escalate', reason: 'Loop detected' };
    }
  }

  clearHistory(jobId: string): void {
    this.transitionHistory.delete(jobId);
    this.loopResults.delete(jobId);
    this.cooldownStart.delete(jobId);
  }

  getLoopStats(jobId: string): LoopStats {
    const loop = this.loopResults.get(jobId);
    const history = this.getTransitionHistory(jobId);

    const stateVisitCounts: Record<string, number> = {};
    for (const record of history) {
      stateVisitCounts[record.to_state] = (stateVisitCounts[record.to_state] ?? 0) + 1;
    }

    return {
      detected: !!loop,
      loop_type: loop?.loop_type,
      state_visit_counts: stateVisitCounts,
    };
  }
}