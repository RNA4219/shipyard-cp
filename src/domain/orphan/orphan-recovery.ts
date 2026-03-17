export interface OrphanRecoveryConfig {
  lease_timeout_seconds: number;
  heartbeat_interval_seconds: number;
  max_recovery_attempts: number;
}

export interface OrphanCheckInput {
  job_id: string;
  stage: WorkerStage | ControlPlaneStage;
  lease_expires_at: string;
  last_heartbeat_at?: string;
}

export interface OrphanCheckResult {
  is_orphan: boolean;
  reason?: 'lease_expired' | 'heartbeat_timeout';
}

export interface RecoveryActionInput {
  job_id: string;
  stage: WorkerStage | ControlPlaneStage;
  retry_count: number;
}

export interface OrphanRecoveryDecision {
  action: 'retry' | 'block' | 'fail';
  target_stage?: WorkerStage;
  resume_state?: ControlPlaneState;
}

export interface BlockedContextInput {
  job_id: string;
  stage: WorkerStage | ControlPlaneStage;
  original_state: ControlPlaneState;
  orphan_reason: 'lease_expired' | 'heartbeat_timeout';
}

export interface BlockedContextOutput {
  resume_state: ControlPlaneState;
  reason: string;
  waiting_on?: WaitingOnKind;
  orphaned_run: boolean;
}

export type WorkerStage = 'plan' | 'dev' | 'acceptance';
export type ControlPlaneStage = WorkerStage | 'integrating' | 'publishing';
export type ControlPlaneState =
  | 'planning'
  | 'developing'
  | 'accepting'
  | 'integrating'
  | 'publishing';
export type WaitingOnKind = 'litellm' | 'worker' | 'human' | 'github' | 'environment';

// Heartbeat threshold multiplier (how many intervals before considering orphan)
const HEARTBEAT_THRESHOLD_MULTIPLIER = 5;

export class OrphanRecovery {
  private readonly config: OrphanRecoveryConfig;

  // Stage-specific max retries (same as RetryManager defaults)
  private readonly stageMaxRetries: Record<WorkerStage, number> = {
    plan: 2,
    dev: 3,
    acceptance: 1,
  };

  constructor(config: OrphanRecoveryConfig) {
    this.config = config;
  }

  detectOrphan(input: OrphanCheckInput): OrphanCheckResult {
    const now = new Date();
    const leaseExpires = new Date(input.lease_expires_at);

    // Check if lease has expired
    if (leaseExpires < now) {
      return { is_orphan: true, reason: 'lease_expired' };
    }

    // Check heartbeat timeout
    if (input.last_heartbeat_at) {
      const lastHeartbeat = new Date(input.last_heartbeat_at);
      const heartbeatThreshold = this.config.heartbeat_interval_seconds * HEARTBEAT_THRESHOLD_MULTIPLIER * 1000;
      const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();

      if (timeSinceHeartbeat > heartbeatThreshold) {
        return { is_orphan: true, reason: 'heartbeat_timeout' };
      }
    }

    return { is_orphan: false };
  }

  determineRecoveryAction(input: RecoveryActionInput): OrphanRecoveryDecision {
    const { stage, retry_count } = input;

    // Control Plane stages always go to blocked
    if (stage === 'integrating' || stage === 'publishing') {
      return {
        action: 'block',
        resume_state: this.stageToState(stage),
      };
    }

    // Acceptance requires manual intervention
    if (stage === 'acceptance') {
      return {
        action: 'block',
        resume_state: 'accepting',
      };
    }

    // Worker stages can retry if under max retries
    const maxRetries = this.getMaxRetriesForStage(stage);
    if (retry_count < maxRetries) {
      return {
        action: 'retry',
        target_stage: stage as WorkerStage,
      };
    }

    // At max retries, block
    return {
      action: 'block',
      resume_state: this.stageToState(stage),
    };
  }

  generateBlockedContext(input: BlockedContextInput): BlockedContextOutput {
    const waitingOn = this.getWaitingOnForStage(input.stage);

    return {
      resume_state: input.original_state,
      reason: 'job_orphaned',
      waiting_on: waitingOn,
      orphaned_run: true,
    };
  }

  getMaxRetriesForStage(stage: WorkerStage | ControlPlaneStage): number {
    if (stage === 'integrating' || stage === 'publishing') {
      return 0; // No auto-retry for control plane stages
    }
    // Use the minimum of stage default and config max
    const stageDefault = this.stageMaxRetries[stage as WorkerStage] ?? 0;
    return Math.min(stageDefault, this.config.max_recovery_attempts);
  }

  shouldAutoRecover(stage: WorkerStage | ControlPlaneStage, retryCount: number): boolean {
    const maxRetries = this.getMaxRetriesForStage(stage);
    return maxRetries > 0 && retryCount < maxRetries;
  }

  private stageToState(stage: WorkerStage | ControlPlaneStage): ControlPlaneState {
    const mapping: Record<WorkerStage | ControlPlaneStage, ControlPlaneState> = {
      plan: 'planning',
      dev: 'developing',
      acceptance: 'accepting',
      integrating: 'integrating',
      publishing: 'publishing',
    };
    return mapping[stage];
  }

  private getWaitingOnForStage(stage: WorkerStage | ControlPlaneStage): WaitingOnKind {
    switch (stage) {
      case 'integrating':
        return 'github';
      case 'publishing':
        return 'environment';
      case 'acceptance':
        return 'human';
      case 'plan':
      case 'dev':
        return 'worker';
      default:
        return 'worker';
    }
  }
}