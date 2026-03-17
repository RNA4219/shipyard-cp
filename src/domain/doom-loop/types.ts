export interface DoomLoopConfig {
  max_repeats: number;
  window_minutes: number;
  cooldown_minutes: number;
}

export interface TransitionRecord {
  from_state: string;
  to_state: string;
  stage: string;
  timestamp: string;
}

export type LoopType = 'simple' | 'complex' | 'state_repeat';

export interface LoopDetectionResult {
  loop_type: LoopType;
  states: string[];
  repeat_count?: number;
  detected_at: string;
}

export interface RecommendedAction {
  action: 'continue' | 'escalate' | 'block' | 'cooldown';
  reason?: string;
}

export interface LoopStats {
  detected: boolean;
  loop_type?: LoopType;
  state_visit_counts?: Record<string, number>;
}

export const DEFAULT_DOOM_LOOP_CONFIG: DoomLoopConfig = {
  max_repeats: 3,
  window_minutes: 30,
  cooldown_minutes: 5,
};