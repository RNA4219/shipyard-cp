import { describe, it, expect, beforeEach } from 'vitest';
import { DoomLoopDetector, generateFingerprint, generateFingerprintFromComponents } from '../src/domain/doom-loop/index.js';
import type { WorkerJob, RepoRef } from '../src/types.js';

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

  describe('generateFingerprint', () => {
    const createMockJob = (overrides: Partial<WorkerJob> = {}): WorkerJob => ({
      job_id: 'job-123',
      task_id: 'task-456',
      worker_type: 'claude_code',
      stage: 'dev',
      input_prompt: 'Test prompt',
      repo_ref: {
        provider: 'github',
        owner: 'testowner',
        name: 'testrepo',
      },
      typed_ref: 'main',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    });

    it('should generate a consistent fingerprint for the same job', () => {
      const job = createMockJob();
      const fingerprint1 = generateFingerprint(job);
      const fingerprint2 = generateFingerprint(job);
      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should generate different fingerprints for different prompts', () => {
      const job1 = createMockJob({ input_prompt: 'First prompt' });
      const job2 = createMockJob({ input_prompt: 'Second prompt' });
      expect(generateFingerprint(job1)).not.toBe(generateFingerprint(job2));
    });

    it('should generate same fingerprint for normalized prompts', () => {
      const job1 = createMockJob({ input_prompt: '  Test   Prompt  ' });
      const job2 = createMockJob({ input_prompt: 'test prompt' });
      expect(generateFingerprint(job1)).toBe(generateFingerprint(job2));
    });

    it('should generate different fingerprints for different stages', () => {
      const job1 = createMockJob({ stage: 'dev' });
      const job2 = createMockJob({ stage: 'acceptance' });
      expect(generateFingerprint(job1)).not.toBe(generateFingerprint(job2));
    });

    it('should generate different fingerprints for different worker types', () => {
      const job1 = createMockJob({ worker_type: 'claude_code' });
      const job2 = createMockJob({ worker_type: 'codex' });
      expect(generateFingerprint(job1)).not.toBe(generateFingerprint(job2));
    });

    it('should generate different fingerprints for different repos', () => {
      const job1 = createMockJob({
        repo_ref: { provider: 'github', owner: 'owner1', name: 'repo1' },
      });
      const job2 = createMockJob({
        repo_ref: { provider: 'github', owner: 'owner2', name: 'repo1' },
      });
      expect(generateFingerprint(job1)).not.toBe(generateFingerprint(job2));
    });

    it('should generate different fingerprints for different typed refs', () => {
      const job1 = createMockJob({ typed_ref: 'main' });
      const job2 = createMockJob({ typed_ref: 'develop' });
      expect(generateFingerprint(job1)).not.toBe(generateFingerprint(job2));
    });

    it('should generate a 32-character hex string', () => {
      const job = createMockJob();
      const fingerprint = generateFingerprint(job);
      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('generateFingerprintFromComponents', () => {
    const repoRef: RepoRef = {
      provider: 'github',
      owner: 'testowner',
      name: 'testrepo',
    };

    it('should generate a consistent fingerprint for same components', () => {
      const fp1 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      const fp2 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      expect(fp1).toBe(fp2);
    });

    it('should generate different fingerprints for different stages', () => {
      const fp1 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      const fp2 = generateFingerprintFromComponents('acceptance', 'claude_code', 'test prompt', repoRef, 'main');
      expect(fp1).not.toBe(fp2);
    });

    it('should include target resource key when provided', () => {
      const fp1 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main', 'resource-123');
      const fp2 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      expect(fp1).not.toBe(fp2);
    });

    it('should generate same fingerprint with same target resource key', () => {
      const fp1 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main', 'resource-123');
      const fp2 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main', 'resource-123');
      expect(fp1).toBe(fp2);
    });

    it('should normalize prompts consistently', () => {
      const fp1 = generateFingerprintFromComponents('dev', 'claude_code', '  TEST   PROMPT  ', repoRef, 'main');
      const fp2 = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      expect(fp1).toBe(fp2);
    });

    it('should generate a 32-character hex string', () => {
      const fp = generateFingerprintFromComponents('dev', 'claude_code', 'test prompt', repoRef, 'main');
      expect(fp).toHaveLength(32);
      expect(fp).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('Fingerprint-based Loop Detection', () => {
    let fpDetector: DoomLoopDetector;

    beforeEach(() => {
      fpDetector = new DoomLoopDetector(
        { max_repeats: 3, window_minutes: 30, cooldown_minutes: 5 },
        { loop_window_size: 10, loop_warn_threshold: 2, loop_block_threshold: 4 }
      );
    });

    const createMockJob = (overrides: Partial<WorkerJob> = {}): WorkerJob => ({
      job_id: `job-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      task_id: 'task-456',
      worker_type: 'claude_code',
      stage: 'dev',
      input_prompt: 'Test prompt',
      repo_ref: {
        provider: 'github',
        owner: 'testowner',
        name: 'testrepo',
      },
      typed_ref: 'main',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    });

    describe('checkLoop', () => {
      it('should return none action for first occurrence', () => {
        const result = fpDetector.checkLoop('dev', 'fingerprint-1', 'task-1', 'job-1');
        expect(result.action).toBe('none');
        expect(result.occurrence_count).toBe(1);
      });

      it('should return warn action when warn threshold reached', () => {
        const fingerprint = 'fingerprint-warn';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        const result = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        expect(result.action).toBe('warn');
        expect(result.occurrence_count).toBe(2);
      });

      it('should return block action when block threshold reached', () => {
        const fingerprint = 'fingerprint-block';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        const result = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-4');
        expect(result.action).toBe('block');
        expect(result.occurrence_count).toBe(4);
      });

      it('should return block action for already blocked fingerprint', () => {
        const fingerprint = 'fingerprint-blocked';
        // Block it first
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-4');

        // Now check again - should still be blocked
        const result = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-5');
        expect(result.action).toBe('block');
      });

      it('should count fingerprints separately per stage', () => {
        const fingerprint = 'fingerprint-multi-stage';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        const result = fpDetector.checkLoop('acceptance', fingerprint, 'task-1', 'job-2');
        expect(result.action).toBe('none');
        expect(result.occurrence_count).toBe(1);
      });

      it('should only warn once per fingerprint', () => {
        const fingerprint = 'fingerprint-warn-once';
        const result1 = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        expect(result1.action).toBe('none');

        const result2 = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        expect(result2.action).toBe('warn');

        const result3 = fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        expect(result3.action).toBe('none');
      });

      it('should trim history to window size', () => {
        const detector = new DoomLoopDetector(
          {},
          { loop_window_size: 3, loop_warn_threshold: 5, loop_block_threshold: 10 }
        );

        detector.checkLoop('dev', 'fp1', 'task-1', 'job-1');
        detector.checkLoop('dev', 'fp2', 'task-1', 'job-2');
        detector.checkLoop('dev', 'fp3', 'task-1', 'job-3');
        detector.checkLoop('dev', 'fp4', 'task-1', 'job-4');

        expect(detector.getFingerprintHistoryLength()).toBe(3);
      });

      it('should return window size in result', () => {
        const result = fpDetector.checkLoop('dev', 'fingerprint-1', 'task-1', 'job-1');
        expect(result.window_size).toBe(10);
      });
    });

    describe('recordAndCheckFingerprint', () => {
      it('should generate fingerprint and check loop', () => {
        const job = createMockJob();
        const result = fpDetector.recordAndCheckFingerprint(job);
        expect(result.action).toBe('none');
        expect(result.fingerprint).toHaveLength(32);
      });

      it('should detect loop for repeated jobs', () => {
        const job = createMockJob();
        fpDetector.recordAndCheckFingerprint(job);
        const result = fpDetector.recordAndCheckFingerprint(job);
        expect(result.action).toBe('warn');
      });
    });

    describe('isFingerprintBlocked', () => {
      it('should return false for unblocked fingerprint', () => {
        expect(fpDetector.isFingerprintBlocked('unknown-fingerprint')).toBe(false);
      });

      it('should return true after block threshold reached', () => {
        const fingerprint = 'blocked-fingerprint';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-4');
        expect(fpDetector.isFingerprintBlocked(fingerprint)).toBe(true);
      });
    });

    describe('hasWarningBeenIssued', () => {
      it('should return false when no warning issued', () => {
        expect(fpDetector.hasWarningBeenIssued('unknown-fingerprint')).toBe(false);
      });

      it('should return true after warn threshold reached', () => {
        const fingerprint = 'warned-fingerprint';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        expect(fpDetector.hasWarningBeenIssued(fingerprint)).toBe(true);
      });
    });

    describe('getFingerprintHistoryLength', () => {
      it('should return 0 initially', () => {
        expect(fpDetector.getFingerprintHistoryLength()).toBe(0);
      });

      it('should increment with each check', () => {
        fpDetector.checkLoop('dev', 'fp1', 'task-1', 'job-1');
        expect(fpDetector.getFingerprintHistoryLength()).toBe(1);
        fpDetector.checkLoop('dev', 'fp2', 'task-1', 'job-2');
        expect(fpDetector.getFingerprintHistoryLength()).toBe(2);
      });
    });

    describe('getFingerprintHistoryForStage', () => {
      it('should return empty array for unknown stage', () => {
        const history = fpDetector.getFingerprintHistoryForStage('unknown');
        expect(history).toHaveLength(0);
      });

      it('should return history entries for specific stage', () => {
        fpDetector.checkLoop('dev', 'fp1', 'task-1', 'job-1');
        fpDetector.checkLoop('dev', 'fp2', 'task-1', 'job-2');
        fpDetector.checkLoop('acceptance', 'fp3', 'task-1', 'job-3');

        const devHistory = fpDetector.getFingerprintHistoryForStage('dev');
        expect(devHistory).toHaveLength(2);
      });
    });

    describe('getFingerprintOccurrenceCount', () => {
      it('should return 0 for unknown fingerprint', () => {
        expect(fpDetector.getFingerprintOccurrenceCount('unknown', 'dev')).toBe(0);
      });

      it('should count occurrences correctly', () => {
        const fingerprint = 'count-test';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        expect(fpDetector.getFingerprintOccurrenceCount(fingerprint, 'dev')).toBe(3);
      });

      it('should count separately per stage', () => {
        const fingerprint = 'count-stage-test';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('acceptance', fingerprint, 'task-1', 'job-3');
        expect(fpDetector.getFingerprintOccurrenceCount(fingerprint, 'dev')).toBe(2);
        expect(fpDetector.getFingerprintOccurrenceCount(fingerprint, 'acceptance')).toBe(1);
      });
    });

    describe('clearFingerprintState', () => {
      it('should clear blocked state', () => {
        const fingerprint = 'clear-blocked';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-3');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-4');
        expect(fpDetector.isFingerprintBlocked(fingerprint)).toBe(true);

        fpDetector.clearFingerprintState(fingerprint);
        expect(fpDetector.isFingerprintBlocked(fingerprint)).toBe(false);
      });

      it('should clear warning state', () => {
        const fingerprint = 'clear-warning';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        expect(fpDetector.hasWarningBeenIssued(fingerprint)).toBe(true);

        fpDetector.clearFingerprintState(fingerprint);
        expect(fpDetector.hasWarningBeenIssued(fingerprint)).toBe(false);
      });

      it('should keep history after clearing state', () => {
        const fingerprint = 'keep-history';
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fingerprint, 'task-1', 'job-2');
        fpDetector.clearFingerprintState(fingerprint);
        expect(fpDetector.getFingerprintHistoryLength()).toBe(2);
      });
    });

    describe('clearAllFingerprintState', () => {
      it('should clear all fingerprint state', () => {
        const fp1 = 'fp1';
        const fp2 = 'fp2';

        // Create some state
        fpDetector.checkLoop('dev', fp1, 'task-1', 'job-1');
        fpDetector.checkLoop('dev', fp1, 'task-1', 'job-2');
        fpDetector.checkLoop('dev', fp2, 'task-1', 'job-3');
        fpDetector.checkLoop('dev', fp2, 'task-1', 'job-4');
        fpDetector.checkLoop('dev', fp2, 'task-1', 'job-5');
        fpDetector.checkLoop('dev', fp2, 'task-1', 'job-6');

        fpDetector.clearAllFingerprintState();

        expect(fpDetector.getFingerprintHistoryLength()).toBe(0);
        expect(fpDetector.isFingerprintBlocked(fp1)).toBe(false);
        expect(fpDetector.isFingerprintBlocked(fp2)).toBe(false);
        expect(fpDetector.hasWarningBeenIssued(fp1)).toBe(false);
        expect(fpDetector.hasWarningBeenIssued(fp2)).toBe(false);
      });
    });

    describe('getFingerprintConfig', () => {
      it('should return the fingerprint configuration', () => {
        const config = fpDetector.getFingerprintConfig();
        expect(config.loop_window_size).toBe(10);
        expect(config.loop_warn_threshold).toBe(2);
        expect(config.loop_block_threshold).toBe(4);
      });

      it('should return a copy of the configuration', () => {
        const config1 = fpDetector.getFingerprintConfig();
        const config2 = fpDetector.getFingerprintConfig();
        expect(config1).not.toBe(config2); // Different object references
        expect(config1).toEqual(config2); // Same values
      });
    });
  });

  describe('detectLoop edge cases', () => {
    it('should return null for no transitions', () => {
      const result = detector.detectLoop('job_no_transitions');
      expect(result).toBeNull();
    });

    it('should return null for single transition', () => {
      detector.trackTransition({ job_id: 'job_single', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      const result = detector.detectLoop('job_single');
      expect(result).toBeNull();
    });

    it('should detect complex loop with multiple states', () => {
      // Create a complex loop: A -> B -> C -> D -> A
      detector.trackTransition({ job_id: 'job_complex', from_state: 'state_a', to_state: 'state_b', stage: 'stage1' });
      detector.trackTransition({ job_id: 'job_complex', from_state: 'state_b', to_state: 'state_c', stage: 'stage2' });
      detector.trackTransition({ job_id: 'job_complex', from_state: 'state_c', to_state: 'state_d', stage: 'stage3' });
      detector.trackTransition({ job_id: 'job_complex', from_state: 'state_d', to_state: 'state_a', stage: 'stage4' });

      const result = detector.detectLoop('job_complex');
      expect(result).not.toBeNull();
      expect(result?.loop_type).toBe('complex');
      expect(result?.states).toContain('state_a');
    });
  });

  describe('getRecommendedAction edge cases', () => {
    it('should return correct reason for complex loop', () => {
      // Create a complex loop
      detector.trackTransition({ job_id: 'job_complex_action', from_state: 'state_a', to_state: 'state_b', stage: 's1' });
      detector.trackTransition({ job_id: 'job_complex_action', from_state: 'state_b', to_state: 'state_c', stage: 's2' });
      detector.trackTransition({ job_id: 'job_complex_action', from_state: 'state_c', to_state: 'state_d', stage: 's3' });
      detector.trackTransition({ job_id: 'job_complex_action', from_state: 'state_d', to_state: 'state_a', stage: 's4' });

      detector.detectLoop('job_complex_action');
      const action = detector.getRecommendedAction('job_complex_action');
      expect(action.action).toBe('escalate');
      expect(action.reason).toContain('Complex loop detected');
    });

    it('should start cooldown on getRecommendedAction when not in cooldown', () => {
      // Create a loop
      detector.trackTransition({ job_id: 'job_cooldown', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_cooldown', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_cooldown', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      detector.detectLoop('job_cooldown');

      // Clear cooldown to test getRecommendedAction setting it
      // Actually, detectLoop already sets cooldown, so this tests that getRecommendedAction maintains it
      const action = detector.getRecommendedAction('job_cooldown');
      expect(action.action).toBe('escalate');
      expect(detector.isInCooldown('job_cooldown')).toBe(true);
    });
  });

  describe('multiple jobs tracking', () => {
    it('should track transitions for multiple jobs independently', () => {
      detector.trackTransition({ job_id: 'job_a', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_b', from_state: 'planned', to_state: 'testing', stage: 'test' });

      const historyA = detector.getTransitionHistory('job_a');
      const historyB = detector.getTransitionHistory('job_b');

      expect(historyA).toHaveLength(1);
      expect(historyB).toHaveLength(1);
      expect(historyA[0].to_state).toBe('developing');
      expect(historyB[0].to_state).toBe('testing');
    });

    it('should detect loops independently for multiple jobs', () => {
      // Job A has a loop
      detector.trackTransition({ job_id: 'job_a', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_a', from_state: 'developing', to_state: 'planned', stage: 'plan' });
      detector.trackTransition({ job_id: 'job_a', from_state: 'planned', to_state: 'developing', stage: 'dev' });

      // Job B has no loop
      detector.trackTransition({ job_id: 'job_b', from_state: 'planned', to_state: 'developing', stage: 'dev' });
      detector.trackTransition({ job_id: 'job_b', from_state: 'developing', to_state: 'completed', stage: 'complete' });

      expect(detector.detectLoop('job_a')).not.toBeNull();
      expect(detector.detectLoop('job_b')).toBeNull();
    });
  });
});