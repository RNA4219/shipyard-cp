import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrphanScanner, type OrphanScanContext, type JobInfo } from '../src/domain/orphan/orphan-scanner.js';

describe('OrphanScanner', () => {
  let mockContext: OrphanScanContext;
  let scanner: OrphanScanner;
  let activeJobs: JobInfo[];

  beforeEach(() => {
    activeJobs = [];

    mockContext = {
      getActiveJobs: vi.fn(() => activeJobs),
      retryJob: vi.fn(),
      blockTask: vi.fn(),
      emitAuditEvent: vi.fn(),
      recordLeaseExpired: vi.fn(),
      recordOrphanRecovered: vi.fn(),
    };

    scanner = new OrphanScanner(mockContext);
  });

  afterEach(() => {
    scanner.stop();
  });

  describe('scan', () => {
    it('should return empty result when no active jobs', () => {
      const result = scanner.scan();

      expect(result.scanned).toBe(0);
      expect(result.orphans_detected).toBe(0);
      expect(result.recovery_actions).toHaveLength(0);
    });

    it('should detect orphan when lease is expired', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      activeJobs.push({
        job_id: 'job_1',
        task_id: 'task_1',
        stage: 'plan',
        lease_expires_at: expiredTime,
        retry_count: 0,
      });

      const result = scanner.scan();

      expect(result.scanned).toBe(1);
      expect(result.orphans_detected).toBe(1);
      expect(result.recovery_actions).toHaveLength(1);
      expect(result.recovery_actions[0].job_id).toBe('job_1');
    });

    it('should not detect orphan when lease is valid', () => {
      const futureTime = new Date(Date.now() + 60000).toISOString(); // 1 minute in future
      activeJobs.push({
        job_id: 'job_2',
        task_id: 'task_2',
        stage: 'dev',
        lease_expires_at: futureTime,
        retry_count: 0,
      });

      const result = scanner.scan();

      expect(result.scanned).toBe(1);
      expect(result.orphans_detected).toBe(0);
      expect(result.recovery_actions).toHaveLength(0);
    });

    it('should retry job when under max retries', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      activeJobs.push({
        job_id: 'job_3',
        task_id: 'task_3',
        stage: 'plan',
        lease_expires_at: expiredTime,
        retry_count: 1,
      });

      const result = scanner.scan();

      expect(result.recovery_actions[0].action).toBe('retry');
      expect(mockContext.retryJob).toHaveBeenCalledWith('task_3', 'plan');
    });

    it('should block task when over max retries', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      activeJobs.push({
        job_id: 'job_4',
        task_id: 'task_4',
        stage: 'plan',
        lease_expires_at: expiredTime,
        retry_count: 5,
      });

      const result = scanner.scan();

      expect(result.recovery_actions[0].action).toBe('block');
      expect(mockContext.blockTask).toHaveBeenCalled();
    });

    it('should record metrics when provided', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      activeJobs.push({
        job_id: 'job_5',
        task_id: 'task_5',
        stage: 'dev',
        lease_expires_at: expiredTime,
        retry_count: 0,
      });

      scanner.scan();

      expect(mockContext.recordLeaseExpired).toHaveBeenCalledWith('dev');
      expect(mockContext.recordOrphanRecovered).toHaveBeenCalled();
    });

    it('should emit audit events for orphan detection', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      activeJobs.push({
        job_id: 'job_6',
        task_id: 'task_6',
        stage: 'plan',
        lease_expires_at: expiredTime,
        retry_count: 0,
      });

      scanner.scan();

      expect(mockContext.emitAuditEvent).toHaveBeenCalledWith(
        'task_6',
        'orphan_detected',
        expect.objectContaining({ job_id: 'job_6' })
      );
    });

    it('should prevent concurrent scans', () => {
      activeJobs.push({
        job_id: 'job_7',
        task_id: 'task_7',
        stage: 'plan',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        retry_count: 0,
      });

      // First scan marks isScanning = true
      // Manually set isScanning to simulate concurrent access
      const scannerAny = scanner as unknown as { isScanning: boolean };
      scannerAny.isScanning = true;

      const result = scanner.scan();

      expect(result.scanned).toBe(0); // Early return due to concurrent scan

      scannerAny.isScanning = false;
    });
  });

  describe('start/stop', () => {
    it('should start periodic scanning', () => {
      vi.useFakeTimers();

      scanner.start(1000);
      expect(scanner.isRunning()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(mockContext.getActiveJobs).toHaveBeenCalled();

      scanner.stop();
      expect(scanner.isRunning()).toBe(false);

      vi.useRealTimers();
    });

    it('should not start twice', () => {
      scanner.start(1000);
      scanner.start(2000); // Second call should be ignored

      expect(scanner.isRunning()).toBe(true);

      scanner.stop();
    });

    it('should run initial scan on start', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      activeJobs.push({
        job_id: 'job_8',
        task_id: 'task_8',
        stage: 'plan',
        lease_expires_at: expiredTime,
        retry_count: 0,
      });

      scanner.start(10000);

      expect(mockContext.getActiveJobs).toHaveBeenCalled();

      scanner.stop();
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      expect(scanner.isRunning()).toBe(false);
    });

    it('should return true after start', () => {
      scanner.start(1000);
      expect(scanner.isRunning()).toBe(true);
      scanner.stop();
    });

    it('should return false after stop', () => {
      scanner.start(1000);
      scanner.stop();
      expect(scanner.isRunning()).toBe(false);
    });
  });
});