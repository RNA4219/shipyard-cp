import { describe, it, expect, beforeEach } from 'vitest';
import { LeaseManager } from '../src/domain/lease/lease-manager.js';

describe('LeaseManager', () => {
  let leaseManager: LeaseManager;

  beforeEach(() => {
    leaseManager = new LeaseManager({
      lease_duration_seconds: 300,
      heartbeat_grace_multiplier: 3,
    });
  });

  describe('acquire', () => {
    it('should acquire a lease for a job', () => {
      const lease = leaseManager.acquire('job_123', 'worker_1');

      expect(lease).toBeDefined();
      expect(lease.job_id).toBe('job_123');
      expect(lease.lease_owner).toBe('worker_1');
      expect(lease.lease_expires_at).toBeDefined();
    });

    it('should not acquire lease if already held by another owner', () => {
      leaseManager.acquire('job_123', 'worker_1');

      const lease = leaseManager.acquire('job_123', 'worker_2');

      expect(lease).toBeNull();
    });

    it('should allow re-acquire after lease expired', () => {
      const expiredManager = new LeaseManager({
        lease_duration_seconds: 0, // immediate expiry
        heartbeat_grace_multiplier: 1,
      });

      expiredManager.acquire('job_123', 'worker_1');

      // After expiry, another worker can acquire
      const lease = expiredManager.acquire('job_123', 'worker_2');

      expect(lease).toBeDefined();
      expect(lease.lease_owner).toBe('worker_2');
    });
  });

  describe('heartbeat', () => {
    it('should extend lease on heartbeat', async () => {
      const originalLease = leaseManager.acquire('job_123', 'worker_1');
      const originalExpiry = new Date(originalLease.lease_expires_at).getTime();

      // Wait a bit to ensure time difference
      await new Promise(r => setTimeout(r, 10));

      const extendedLease = leaseManager.heartbeat('job_123', 'worker_1', {
        stage: 'dev',
        progress: 50,
      });

      expect(extendedLease).toBeDefined();
      const newExpiry = new Date(extendedLease!.lease_expires_at).getTime();
      expect(newExpiry).toBeGreaterThanOrEqual(originalExpiry);
    });

    it('should reject heartbeat from wrong owner', () => {
      leaseManager.acquire('job_123', 'worker_1');

      const result = leaseManager.heartbeat('job_123', 'worker_2', {
        stage: 'dev',
      });

      expect(result).toBeNull();
    });

    it('should record last_heartbeat_at', () => {
      leaseManager.acquire('job_123', 'worker_1');

      const lease = leaseManager.heartbeat('job_123', 'worker_1', {
        stage: 'dev',
      });

      expect(lease!.last_heartbeat_at).toBeDefined();
    });

    it('should return next_heartbeat_due_at', () => {
      leaseManager.acquire('job_123', 'worker_1');

      const result = leaseManager.heartbeat('job_123', 'worker_1', {
        stage: 'dev',
      });

      expect(result!.next_heartbeat_due_at).toBeDefined();
    });
  });

  describe('isExpired', () => {
    it('should return false for active lease', () => {
      leaseManager.acquire('job_123', 'worker_1');

      expect(leaseManager.isExpired('job_123')).toBe(false);
    });

    it('should return true for expired lease', () => {
      const expiredManager = new LeaseManager({
        lease_duration_seconds: 0,
        heartbeat_grace_multiplier: 1,
      });

      expiredManager.acquire('job_123', 'worker_1');

      expect(expiredManager.isExpired('job_123')).toBe(true);
    });

    it('should return true for non-existent lease', () => {
      expect(leaseManager.isExpired('job_nonexistent')).toBe(true);
    });
  });

  describe('detectOrphan', () => {
    it('should detect orphaned job with expired lease', () => {
      const expiredManager = new LeaseManager({
        lease_duration_seconds: 0,
        heartbeat_grace_multiplier: 1,
      });

      expiredManager.acquire('job_123', 'worker_1');

      const orphan = expiredManager.detectOrphan('job_123');

      expect(orphan).toBeDefined();
      expect(orphan!.orphaned_at).toBeDefined();
    });

    it('should not detect orphan for active lease', () => {
      leaseManager.acquire('job_123', 'worker_1');

      const orphan = leaseManager.detectOrphan('job_123');

      expect(orphan).toBeNull();
    });
  });

  describe('release', () => {
    it('should release lease', () => {
      leaseManager.acquire('job_123', 'worker_1');

      leaseManager.release('job_123', 'worker_1');

      // Can now be acquired by another worker
      const newLease = leaseManager.acquire('job_123', 'worker_2');
      expect(newLease).toBeDefined();
    });

    it('should only allow owner to release', () => {
      leaseManager.acquire('job_123', 'worker_1');

      leaseManager.release('job_123', 'worker_2'); // wrong owner

      // Original owner still holds lease
      const newLease = leaseManager.acquire('job_123', 'worker_2');
      expect(newLease).toBeNull();
    });
  });

  describe('getLease', () => {
    it('should return lease info', () => {
      const lease = leaseManager.acquire('job_123', 'worker_1');

      const retrieved = leaseManager.getLease('job_123');

      expect(retrieved).toBeDefined();
      expect(retrieved!.job_id).toBe('job_123');
    });

    it('should return null for non-existent lease', () => {
      const retrieved = leaseManager.getLease('job_nonexistent');

      expect(retrieved).toBeNull();
    });
  });

  describe('getOrphanedJobs', () => {
    it('should list all orphaned jobs', () => {
      const expiredManager = new LeaseManager({
        lease_duration_seconds: 0,
        heartbeat_grace_multiplier: 1,
      });

      expiredManager.acquire('job_123', 'worker_1');
      expiredManager.acquire('job_456', 'worker_1');

      // Detect orphans
      expiredManager.detectOrphan('job_123');
      expiredManager.detectOrphan('job_456');

      const orphans = expiredManager.getOrphanedJobs();

      expect(orphans).toHaveLength(2);
    });
  });
});