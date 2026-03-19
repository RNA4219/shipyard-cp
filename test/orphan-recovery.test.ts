import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrphanRecovery, OrphanScanner, type OrphanRecoveryConfig, type OrphanRecoveryDecision, type JobInfo, type OrphanScanContext } from '../src/domain/orphan/index.js';

describe('OrphanRecovery', () => {
  let recovery: OrphanRecovery;

  const defaultConfig: OrphanRecoveryConfig = {
    lease_timeout_seconds: 300, // 5 minutes
    heartbeat_interval_seconds: 30,
    max_recovery_attempts: 3,
  };

  beforeEach(() => {
    recovery = new OrphanRecovery(defaultConfig);
  });

  describe('detectOrphan', () => {
    it('should detect orphan when lease is expired', () => {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() - 60000); // expired 1 min ago
      const lastHeartbeatAt = new Date(now.getTime() - 120000); // 2 min ago

      const result = recovery.detectOrphan({
        job_id: 'job_123',
        stage: 'developing',
        lease_expires_at: leaseExpiresAt.toISOString(),
        last_heartbeat_at: lastHeartbeatAt.toISOString(),
      });

      expect(result.is_orphan).toBe(true);
      expect(result.reason).toBe('lease_expired');
    });

    it('should detect orphan when heartbeat is missing beyond threshold', () => {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + 60000); // 1 min in future
      const lastHeartbeatAt = new Date(now.getTime() - 300000); // 5 min ago (exceeds threshold)

      const result = recovery.detectOrphan({
        job_id: 'job_123',
        stage: 'developing',
        lease_expires_at: leaseExpiresAt.toISOString(),
        last_heartbeat_at: lastHeartbeatAt.toISOString(),
      });

      expect(result.is_orphan).toBe(true);
      expect(result.reason).toBe('heartbeat_timeout');
    });

    it('should not detect orphan when within normal bounds', () => {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + 300000); // 5 min in future
      const lastHeartbeatAt = new Date(now.getTime() - 30000); // 30 sec ago

      const result = recovery.detectOrphan({
        job_id: 'job_123',
        stage: 'developing',
        lease_expires_at: leaseExpiresAt.toISOString(),
        last_heartbeat_at: lastHeartbeatAt.toISOString(),
      });

      expect(result.is_orphan).toBe(false);
    });
  });

  describe('determineRecoveryAction', () => {
    it('should return blocked for publish stage', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'publishing',
        retry_count: 0,
      });

      expect(decision.action).toBe('block');
      expect(decision.resume_state).toBe('publishing');
    });

    it('should return blocked for integrate stage', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'integrating',
        retry_count: 0,
      });

      expect(decision.action).toBe('block');
      expect(decision.resume_state).toBe('integrating');
    });

    it('should return retry for plan stage with low retry count', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'plan',
        retry_count: 0,
      });

      expect(decision.action).toBe('retry');
      expect(decision.target_stage).toBe('plan');
    });

    it('should return retry for dev stage with low retry count', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'dev',
        retry_count: 1,
      });

      expect(decision.action).toBe('retry');
      expect(decision.target_stage).toBe('dev');
    });

    it('should return blocked for plan stage at max retries', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'plan',
        retry_count: 3, // at max
      });

      expect(decision.action).toBe('block');
    });

    it('should return blocked for dev stage at max retries', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'dev',
        retry_count: 3, // at max
      });

      expect(decision.action).toBe('block');
    });

    it('should return blocked for acceptance stage (requires manual intervention)', () => {
      const decision = recovery.determineRecoveryAction({
        job_id: 'job_123',
        stage: 'acceptance',
        retry_count: 0,
      });

      expect(decision.action).toBe('block');
      expect(decision.resume_state).toBe('accepting');
    });
  });

  describe('generateBlockedContext', () => {
    it('should generate blocked context with orphan reason', () => {
      const context = recovery.generateBlockedContext({
        job_id: 'job_123',
        stage: 'publishing',
        original_state: 'publishing',
        orphan_reason: 'lease_expired',
      });

      expect(context.resume_state).toBe('publishing');
      expect(context.reason).toBe('job_orphaned');
      expect(context.orphaned_run).toBe(true);
    });

    it('should set waiting_on correctly for integrate', () => {
      const context = recovery.generateBlockedContext({
        job_id: 'job_123',
        stage: 'integrating',
        original_state: 'integrating',
        orphan_reason: 'heartbeat_timeout',
      });

      expect(context.waiting_on).toBe('github');
    });

    it('should set waiting_on correctly for acceptance', () => {
      const context = recovery.generateBlockedContext({
        job_id: 'job_123',
        stage: 'acceptance',
        original_state: 'accepting',
        orphan_reason: 'lease_expired',
      });

      expect(context.waiting_on).toBe('human');
    });
  });

  describe('getMaxRetriesForStage', () => {
    it('should return correct max retries for each stage', () => {
      expect(recovery.getMaxRetriesForStage('plan')).toBe(2);
      expect(recovery.getMaxRetriesForStage('dev')).toBe(3);
      expect(recovery.getMaxRetriesForStage('acceptance')).toBe(1);
      expect(recovery.getMaxRetriesForStage('integrating')).toBe(0);
      expect(recovery.getMaxRetriesForStage('publishing')).toBe(0);
    });
  });

  describe('shouldAutoRecover', () => {
    it('should return true for recoverable stages with low retry count', () => {
      expect(recovery.shouldAutoRecover('plan', 0)).toBe(true);
      expect(recovery.shouldAutoRecover('dev', 1)).toBe(true);
    });

    it('should return false for non-recoverable stages', () => {
      expect(recovery.shouldAutoRecover('integrating', 0)).toBe(false);
      expect(recovery.shouldAutoRecover('publishing', 0)).toBe(false);
    });

    it('should return false when at max retries', () => {
      expect(recovery.shouldAutoRecover('plan', 2)).toBe(false);
      expect(recovery.shouldAutoRecover('dev', 3)).toBe(false);
    });
  });

  describe('custom config', () => {
    it('should respect custom max recovery attempts', () => {
      const customRecovery = new OrphanRecovery({
        ...defaultConfig,
        max_recovery_attempts: 5,
      });

      // dev stage default is 3, so min(3, 5) = 3
      expect(customRecovery.shouldAutoRecover('dev', 2)).toBe(true);
      expect(customRecovery.shouldAutoRecover('dev', 3)).toBe(false); // at max
    });
  });
});

describe('OrphanScanner', () => {
  let scanner: OrphanScanner;
  let mockCtx: OrphanScanContext;

  const createMockCtx = (): OrphanScanContext => ({
    getActiveJobs: vi.fn(() => []),
    retryJob: vi.fn(),
    blockTask: vi.fn(),
    emitAuditEvent: vi.fn(),
  });

  beforeEach(() => {
    mockCtx = createMockCtx();
    scanner = new OrphanScanner(mockCtx);
  });

  describe('scan', () => {
    it('should return empty result when no active jobs', () => {
      const result = scanner.scan();

      expect(result.scanned).toBe(0);
      expect(result.orphans_detected).toBe(0);
      expect(result.recovery_actions).toHaveLength(0);
    });

    it('should detect orphaned job with expired lease', () => {
      const now = new Date();
      const expiredJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'plan',
        lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([expiredJob]);

      const result = scanner.scan();

      expect(result.scanned).toBe(1);
      expect(result.orphans_detected).toBe(1);
      expect(result.recovery_actions).toHaveLength(1);
      expect(result.recovery_actions[0].job_id).toBe('job_123');
      expect(result.recovery_actions[0].action).toBe('retry');
    });

    it('should block orphaned publishing job', () => {
      const now = new Date();
      const expiredJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'publishing',
        lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([expiredJob]);

      const result = scanner.scan();

      expect(result.orphans_detected).toBe(1);
      expect(result.recovery_actions[0].action).toBe('block');
      expect(mockCtx.blockTask).toHaveBeenCalledWith(
        'task_456',
        expect.stringContaining('lease_expired'),
        'publishing',
        true,
      );
    });

    it('should retry orphaned plan job', () => {
      const now = new Date();
      const expiredJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'plan',
        lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([expiredJob]);

      scanner.scan();

      expect(mockCtx.retryJob).toHaveBeenCalledWith('task_456', 'plan');
    });

    it('should emit audit event for orphan detection', () => {
      const now = new Date();
      const expiredJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'dev',
        lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([expiredJob]);

      scanner.scan();

      expect(mockCtx.emitAuditEvent).toHaveBeenCalledWith(
        'task_456',
        'orphan_detected',
        expect.objectContaining({
          job_id: 'job_123',
          stage: 'dev',
        }),
      );
    });

    it('should not detect orphan for healthy jobs', () => {
      const now = new Date();
      const healthyJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'plan',
        lease_expires_at: new Date(now.getTime() + 300000).toISOString(),
        last_heartbeat_at: new Date(now.getTime() - 30000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([healthyJob]);

      const result = scanner.scan();

      expect(result.orphans_detected).toBe(0);
      expect(result.recovery_actions).toHaveLength(0);
      expect(mockCtx.retryJob).not.toHaveBeenCalled();
      expect(mockCtx.blockTask).not.toHaveBeenCalled();
    });

    it('should handle multiple orphaned jobs', () => {
      const now = new Date();
      const jobs: JobInfo[] = [
        {
          job_id: 'job_1',
          task_id: 'task_1',
          stage: 'plan',
          lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
          retry_count: 0,
        },
        {
          job_id: 'job_2',
          task_id: 'task_2',
          stage: 'publishing',
          lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
          retry_count: 0,
        },
        {
          job_id: 'job_3',
          task_id: 'task_3',
          stage: 'dev',
          lease_expires_at: new Date(now.getTime() + 300000).toISOString(),
          retry_count: 0,
        },
      ];

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue(jobs);

      const result = scanner.scan();

      expect(result.scanned).toBe(3);
      expect(result.orphans_detected).toBe(2);
      expect(result.recovery_actions).toHaveLength(2);
    });
  });

  describe('start/stop', () => {
    it('should not start multiple intervals', () => {
      vi.useFakeTimers();

      scanner.start(1000);
      scanner.start(1000);

      // Should only have one interval running
      expect(scanner.isRunning()).toBe(true);

      scanner.stop();
      expect(scanner.isRunning()).toBe(false);

      vi.useRealTimers();
    });

    it('should run periodic scans', () => {
      vi.useFakeTimers();

      const now = new Date();
      const expiredJob: JobInfo = {
        job_id: 'job_123',
        task_id: 'task_456',
        stage: 'plan',
        lease_expires_at: new Date(now.getTime() - 60000).toISOString(),
        retry_count: 0,
      };

      (mockCtx.getActiveJobs as ReturnType<typeof vi.fn>).mockReturnValue([expiredJob]);

      scanner.start(1000);

      // Initial scan
      expect(mockCtx.getActiveJobs).toHaveBeenCalledTimes(1);

      // Advance time and trigger another scan
      vi.advanceTimersByTime(1000);
      expect(mockCtx.getActiveJobs).toHaveBeenCalledTimes(2);

      scanner.stop();
      vi.useRealTimers();
    });
  });
});