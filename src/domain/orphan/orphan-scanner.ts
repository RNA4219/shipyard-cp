import { OrphanRecovery, type OrphanRecoveryConfig, type OrphanCheckInput, type WorkerStage, type ControlPlaneStage } from './orphan-recovery.js';

/**
 * Job information needed for orphan detection
 */
export interface JobInfo {
  job_id: string;
  task_id: string;
  stage: WorkerStage | ControlPlaneStage;
  lease_expires_at: string;
  last_heartbeat_at?: string;
  retry_count: number;
}

/**
 * Result of an orphan scan
 */
export interface OrphanScanResult {
  scanned: number;
  orphans_detected: number;
  recovery_actions: Array<{
    job_id: string;
    task_id: string;
    action: 'retry' | 'block';
    reason: string;
  }>;
}

/**
 * Context for recovery actions
 */
export interface OrphanScanContext {
  /** Get all active jobs that should be checked */
  getActiveJobs(): JobInfo[];
  /** Retry a job for a task */
  retryJob(taskId: string, stage: WorkerStage): void;
  /** Block a task with blocked context */
  blockTask(taskId: string, reason: string, resumeState: string, orphanedRun: boolean): void;
  /** Emit audit event */
  emitAuditEvent(taskId: string, eventType: string, payload: Record<string, unknown>): void;
  /** Record metrics for lease expiry (optional) */
  recordLeaseExpired?: (stage: string) => void;
  /** Record metrics for orphan recovery (optional) */
  recordOrphanRecovered?: (stage: string, recoveryAction: 'retry' | 'block' | 'fail') => void;
}

/**
 * Default configuration for orphan recovery
 */
export const DEFAULT_ORPHAN_CONFIG: OrphanRecoveryConfig = {
  lease_timeout_seconds: 300, // 5 minutes
  heartbeat_interval_seconds: 30, // 30 seconds
  max_recovery_attempts: 3,
};

/**
 * Scanner for detecting and recovering orphaned jobs.
 * Designed to be run periodically.
 */
export class OrphanScanner {
  private readonly orphanRecovery: OrphanRecovery;
  private scanInterval?: ReturnType<typeof setInterval>;
  private isScanning = false;

  constructor(
    private readonly ctx: OrphanScanContext,
    config: OrphanRecoveryConfig = DEFAULT_ORPHAN_CONFIG,
  ) {
    this.orphanRecovery = new OrphanRecovery(config);
  }

  /**
   * Start periodic orphan scanning.
   * @param intervalMs - Interval between scans in milliseconds (default: 60 seconds)
   */
  start(intervalMs: number = 60000): void {
    if (this.scanInterval) {
      return; // Already running
    }

    // Run initial scan
    this.scan();

    // Schedule periodic scans
    this.scanInterval = setInterval(() => {
      this.scan();
    }, intervalMs);
  }

  /**
   * Stop periodic orphan scanning.
   */
  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }
  }

  /**
   * Perform a single orphan scan.
   * Returns the results of the scan and any recovery actions taken.
   */
  scan(): OrphanScanResult {
    // Prevent concurrent scans
    if (this.isScanning) {
      return { scanned: 0, orphans_detected: 0, recovery_actions: [] };
    }

    this.isScanning = true;

    try {
      const result: OrphanScanResult = {
        scanned: 0,
        orphans_detected: 0,
        recovery_actions: [],
      };

      const activeJobs = this.ctx.getActiveJobs();
      result.scanned = activeJobs.length;

      for (const job of activeJobs) {
        const checkInput: OrphanCheckInput = {
          job_id: job.job_id,
          stage: job.stage,
          lease_expires_at: job.lease_expires_at,
          last_heartbeat_at: job.last_heartbeat_at,
        };

        const checkResult = this.orphanRecovery.detectOrphan(checkInput);

        if (checkResult.is_orphan) {
          result.orphans_detected++;

          // Record lease expired metric
          if (this.ctx.recordLeaseExpired) {
            this.ctx.recordLeaseExpired(job.stage);
          }

          // Determine recovery action
          const decision = this.orphanRecovery.determineRecoveryAction({
            job_id: job.job_id,
            stage: job.stage,
            retry_count: job.retry_count,
          });

          // Record orphan recovered metric
          if (this.ctx.recordOrphanRecovered) {
            this.ctx.recordOrphanRecovered(job.stage, decision.action);
          }

          // Execute recovery action
          if (decision.action === 'retry' && decision.target_stage) {
            this.ctx.retryJob(job.task_id, decision.target_stage);
            result.recovery_actions.push({
              job_id: job.job_id,
              task_id: job.task_id,
              action: 'retry',
              reason: checkResult.reason ?? 'orphan detected',
            });
          } else if (decision.action === 'block' && decision.resume_state) {
            this.ctx.blockTask(
              job.task_id,
              `job_orphaned:${checkResult.reason}`,
              decision.resume_state,
              true,
            );
            result.recovery_actions.push({
              job_id: job.job_id,
              task_id: job.task_id,
              action: 'block',
              reason: checkResult.reason ?? 'orphan detected',
            });
          }

          // Emit audit event for orphan detection
          this.ctx.emitAuditEvent(job.task_id, 'orphan_detected', {
            job_id: job.job_id,
            stage: job.stage,
            reason: checkResult.reason,
            recovery_action: decision.action,
          });

          // Emit heartbeat_missed audit event if heartbeat timeout
          if (checkResult.reason === 'heartbeat_timeout') {
            this.ctx.emitAuditEvent(job.task_id, 'heartbeat_missed', {
              job_id: job.job_id,
              stage: job.stage,
              last_heartbeat_at: job.last_heartbeat_at,
            });
          }
        }
      }

      return result;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Check if the scanner is currently running.
   */
  isRunning(): boolean {
    return this.scanInterval !== undefined;
  }
}