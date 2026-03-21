import type {
  DoomLoopConfig,
  TransitionRecord,
  LoopDetectionResult,
  RecommendedAction,
  LoopStats,
  LoopFingerprintConfig,
  LoopFingerprint,
  LoopCheckResult,
} from './types.js';
import {
  DEFAULT_DOOM_LOOP_CONFIG,
  DEFAULT_LOOP_FINGERPRINT_CONFIG,
} from './types.js';
import type { WorkerJob, RepoRef } from '../../types.js';
import { createHash } from 'crypto';

/**
 * Generate a normalized prompt hash for fingerprinting
 */
function hashPrompt(prompt: string): string {
  // Normalize whitespace and convert to lowercase for consistent hashing
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Generate a repo reference string for fingerprinting
 */
function repoRefToString(repoRef: RepoRef): string {
  return `${repoRef.provider}:${repoRef.owner}/${repoRef.name}`;
}

/**
 * Generate a fingerprint string from a WorkerJob
 */
export function generateFingerprint(job: WorkerJob): string {
  const fingerprint: LoopFingerprint = {
    stage: job.stage,
    worker_type: job.worker_type,
    normalized_prompt_hash: hashPrompt(job.input_prompt),
    repo_ref: repoRefToString(job.repo_ref),
    typed_ref: job.typed_ref,
  };

  // Create a deterministic string representation
  const parts = [
    `stage:${fingerprint.stage}`,
    `worker:${fingerprint.worker_type}`,
    `prompt:${fingerprint.normalized_prompt_hash}`,
    `repo:${fingerprint.repo_ref}`,
    `typed:${fingerprint.typed_ref}`,
  ];

  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
}

/**
 * Generate a fingerprint from components directly
 */
export function generateFingerprintFromComponents(
  stage: string,
  workerType: string,
  prompt: string,
  repoRef: RepoRef,
  typedRef: string,
  targetResourceKey?: string
): string {
  const fingerprint: LoopFingerprint = {
    stage,
    worker_type: workerType,
    normalized_prompt_hash: hashPrompt(prompt),
    repo_ref: repoRefToString(repoRef),
    typed_ref: typedRef,
    target_resource_key: targetResourceKey,
  };

  const parts = [
    `stage:${fingerprint.stage}`,
    `worker:${fingerprint.worker_type}`,
    `prompt:${fingerprint.normalized_prompt_hash}`,
    `repo:${fingerprint.repo_ref}`,
    `typed:${fingerprint.typed_ref}`,
  ];

  if (targetResourceKey) {
    parts.push(`resource:${targetResourceKey}`);
  }

  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
}

/**
 * Fingerprint history entry with stage information
 */
interface FingerprintHistoryEntry {
  fingerprint: string;
  stage: string;
  task_id: string;
  job_id: string;
  timestamp: string;
}

export class DoomLoopDetector {
  private readonly config: DoomLoopConfig;
  private readonly fingerprintConfig: LoopFingerprintConfig;
  private readonly transitionHistory = new Map<string, TransitionRecord[]>();
  private readonly loopResults = new Map<string, LoopDetectionResult>();
  private readonly cooldownStart = new Map<string, string>();

  // Fingerprint-based loop detection
  private readonly fingerprintHistory: FingerprintHistoryEntry[] = [];
  private readonly warningIssued = new Set<string>();
  private readonly blockedFingerprints = new Set<string>();

  constructor(
    config: Partial<DoomLoopConfig> = {},
    fingerprintConfig: Partial<LoopFingerprintConfig> = {}
  ) {
    this.config = { ...DEFAULT_DOOM_LOOP_CONFIG, ...config };
    this.fingerprintConfig = { ...DEFAULT_LOOP_FINGERPRINT_CONFIG, ...fingerprintConfig };
  }

  /**
   * Track a state transition for doom-loop detection analysis.
   * This does NOT perform the actual transition - it only records history.
   */
  trackTransition(params: {
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

  // ---------------------------------------------------------------------------
  // Fingerprint-based Loop Detection
  // ---------------------------------------------------------------------------

  /**
   * Check if a fingerprint indicates a doom loop condition.
   * This should be called before dispatching a new job.
   */
  checkLoop(
    stage: string,
    fingerprint: string,
    taskId: string,
    jobId: string
  ): LoopCheckResult {
    const windowSize = this.fingerprintConfig.loop_window_size;
    const warnThreshold = this.fingerprintConfig.loop_warn_threshold;
    const blockThreshold = this.fingerprintConfig.loop_block_threshold;

    // Add to history
    this.fingerprintHistory.push({
      fingerprint,
      stage,
      task_id: taskId,
      job_id: jobId,
      timestamp: new Date().toISOString(),
    });

    // Trim history to window size
    if (this.fingerprintHistory.length > windowSize) {
      this.fingerprintHistory.splice(0, this.fingerprintHistory.length - windowSize);
    }

    // Count occurrences of this fingerprint within the window
    const occurrences = this.fingerprintHistory.filter(
      (entry) => entry.fingerprint === fingerprint && entry.stage === stage
    );

    const occurrenceCount = occurrences.length;

    // Check if already blocked
    if (this.blockedFingerprints.has(fingerprint)) {
      return {
        fingerprint,
        occurrence_count: occurrenceCount,
        window_size: windowSize,
        action: 'block',
      };
    }

    // Check for block threshold
    if (occurrenceCount >= blockThreshold) {
      this.blockedFingerprints.add(fingerprint);
      return {
        fingerprint,
        occurrence_count: occurrenceCount,
        window_size: windowSize,
        action: 'block',
      };
    }

    // Check for warn threshold (only warn once per fingerprint)
    if (occurrenceCount >= warnThreshold && !this.warningIssued.has(fingerprint)) {
      this.warningIssued.add(fingerprint);
      return {
        fingerprint,
        occurrence_count: occurrenceCount,
        window_size: windowSize,
        action: 'warn',
      };
    }

    return {
      fingerprint,
      occurrence_count: occurrenceCount,
      window_size: windowSize,
      action: 'none',
    };
  }

  /**
   * Record a fingerprint occurrence and return the check result.
   * This is a convenience method that combines generateFingerprint and checkLoop.
   */
  recordAndCheckFingerprint(job: WorkerJob): LoopCheckResult {
    const fingerprint = generateFingerprint(job);
    return this.checkLoop(job.stage, fingerprint, job.task_id, job.job_id);
  }

  /**
   * Check if a fingerprint is currently blocked.
   */
  isFingerprintBlocked(fingerprint: string): boolean {
    return this.blockedFingerprints.has(fingerprint);
  }

  /**
   * Check if a warning has been issued for a fingerprint.
   */
  hasWarningBeenIssued(fingerprint: string): boolean {
    return this.warningIssued.has(fingerprint);
  }

  /**
   * Get the current fingerprint history length.
   */
  getFingerprintHistoryLength(): number {
    return this.fingerprintHistory.length;
  }

  /**
   * Get fingerprint history for a specific stage.
   */
  getFingerprintHistoryForStage(stage: string): FingerprintHistoryEntry[] {
    return this.fingerprintHistory.filter((entry) => entry.stage === stage);
  }

  /**
   * Get occurrence count for a fingerprint within the current window.
   */
  getFingerprintOccurrenceCount(fingerprint: string, stage: string): number {
    return this.fingerprintHistory.filter(
      (entry) => entry.fingerprint === fingerprint && entry.stage === stage
    ).length;
  }

  /**
   * Clear fingerprint-based loop detection state for a specific fingerprint.
   * This should only be called when manually resuming after a block.
   */
  clearFingerprintState(fingerprint: string): void {
    this.blockedFingerprints.delete(fingerprint);
    this.warningIssued.delete(fingerprint);
    // Note: We don't clear history to allow detection of repeated issues
  }

  /**
   * Clear all fingerprint-based loop detection state.
   */
  clearAllFingerprintState(): void {
    this.fingerprintHistory.length = 0;
    this.warningIssued.clear();
    this.blockedFingerprints.clear();
  }

  /**
   * Get the fingerprint configuration.
   */
  getFingerprintConfig(): LoopFingerprintConfig {
    return { ...this.fingerprintConfig };
  }
}