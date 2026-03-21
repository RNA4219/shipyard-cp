export interface DoomLoopConfig {
  max_repeats: number;
  window_minutes: number;
  cooldown_minutes: number;
}

/**
 * Fingerprint configuration for doom-loop detection
 */
export interface LoopFingerprintConfig {
  /** Number of recent fingerprints to keep in history */
  loop_window_size: number;
  /** Threshold to trigger a warning */
  loop_warn_threshold: number;
  /** Threshold to trigger a block */
  loop_block_threshold: number;
}

/**
 * Fingerprint components for identifying repetitive job patterns
 */
export interface LoopFingerprint {
  stage: string;
  worker_type: string;
  normalized_prompt_hash: string;
  repo_ref: string;
  typed_ref: string;
  target_resource_key?: string;
}

/**
 * Result of loop check operation
 */
export interface LoopCheckResult {
  fingerprint: string;
  occurrence_count: number;
  window_size: number;
  action: 'none' | 'warn' | 'block';
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

/**
 * Default fingerprint configuration for doom-loop detection
 */
export const DEFAULT_LOOP_FINGERPRINT_CONFIG: LoopFingerprintConfig = {
  loop_window_size: 20,
  loop_warn_threshold: 3,
  loop_block_threshold: 4,
};