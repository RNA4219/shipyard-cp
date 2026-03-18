import type { LeaseConfig, Lease, HeartbeatRequest, HeartbeatResponse } from './types.js';
import { DEFAULT_LEASE_CONFIG } from './types.js';

export class LeaseManager {
  private readonly config: LeaseConfig;
  private readonly leases = new Map<string, Lease>();

  constructor(config: Partial<LeaseConfig> = {}) {
    this.config = { ...DEFAULT_LEASE_CONFIG, ...config };
  }

  acquire(jobId: string, owner: string): Lease | null {
    const existing = this.leases.get(jobId);

    // Check if lease exists and is not expired
    if (existing && !this.isLeaseExpired(existing)) {
      // Different owner cannot acquire
      if (existing.lease_owner !== owner) {
        return null;
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.lease_duration_seconds * 1000);

    const lease: Lease = {
      job_id: jobId,
      lease_owner: owner,
      lease_expires_at: expiresAt.toISOString(),
      acquired_at: now.toISOString(),
      last_heartbeat_at: now.toISOString(),
    };

    this.leases.set(jobId, lease);
    return lease;
  }

  heartbeat(jobId: string, owner: string, _request: HeartbeatRequest): HeartbeatResponse | null {
    const lease = this.leases.get(jobId);

    if (!lease || lease.lease_owner !== owner) {
      return null;
    }

    // Check if already orphaned
    if (lease.orphaned_at) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.lease_duration_seconds * 1000);
    const nextDue = new Date(now.getTime() + (this.config.heartbeat_interval_seconds ?? 60) * 1000);

    lease.lease_expires_at = expiresAt.toISOString();
    lease.last_heartbeat_at = now.toISOString();

    return {
      lease_expires_at: lease.lease_expires_at,
      next_heartbeat_due_at: nextDue.toISOString(),
      last_heartbeat_at: lease.last_heartbeat_at,
    };
  }

  isExpired(jobId: string): boolean {
    const lease = this.leases.get(jobId);
    if (!lease) {
      return true;
    }
    return this.isLeaseExpired(lease);
  }

  private isLeaseExpired(lease: Lease): boolean {
    const now = new Date();
    const expiresAt = new Date(lease.lease_expires_at);
    return now >= expiresAt;
  }

  detectOrphan(jobId: string): Lease | null {
    const lease = this.leases.get(jobId);

    if (!lease) {
      return null;
    }

    if (!this.isLeaseExpired(lease)) {
      return null;
    }

    if (lease.orphaned_at) {
      return lease; // Already marked as orphan
    }

    // Mark as orphaned
    lease.orphaned_at = new Date().toISOString();
    return lease;
  }

  release(jobId: string, owner: string): boolean {
    const lease = this.leases.get(jobId);

    if (!lease || lease.lease_owner !== owner) {
      return false;
    }

    this.leases.delete(jobId);
    return true;
  }

  getLease(jobId: string): Lease | null {
    return this.leases.get(jobId) ?? null;
  }

  getOrphanedJobs(): Lease[] {
    const orphans: Lease[] = [];
    for (const lease of this.leases.values()) {
      if (lease.orphaned_at) {
        orphans.push(lease);
      }
    }
    return orphans;
  }
}