/**
 * Metrics Collector for Shipyard Control Plane
 *
 * Collects and manages Prometheus metrics using prom-client.
 * Supports counters, gauges, and histograms with automatic collection
 * from domain events.
 */

import client, { type Counter, type Gauge, type Histogram, type Registry } from 'prom-client';
import type { TaskState, WorkerStage, WorkerType, FailureClass, Capability } from '../../types.js';

/**
 * Metric label types (for documentation purposes)
 */
export type TaskLabels = 'state';
export type JobLabels = 'stage' | 'worker_type';
export type ResultLabels = 'status';
export type DispatchLabels = 'stage';
export type RetryLabels = 'stage' | 'failure_class';
export type RetryLimitLabels = 'stage';
export type LeaseLabels = 'stage';
export type OrphanLabels = 'stage' | 'recovery_action';
export type DoomLoopLabels = 'stage';
export type ResourceLockLabels = 'resource_type';
export type CapabilityMismatchLabels = 'stage' | 'capability';

/**
 * Metrics Collector configuration
 */
export interface MetricsCollectorConfig {
  /** Prefix for all metric names */
  prefix?: string;
  /** Default labels to add to all metrics */
  defaultLabels?: Record<string, string>;
  /** Enable default metrics (Node.js metrics) */
  enableDefaultMetrics?: boolean;
}

/**
 * Label value types for type-safe metric recording
 */
export interface TaskLabelValues {
  state: TaskState;
}

export interface JobLabelValues {
  stage: WorkerStage;
  worker_type: WorkerType;
}

export interface ResultLabelValues {
  status: 'succeeded' | 'failed' | 'blocked';
}

export interface DispatchLabelValues {
  stage: WorkerStage;
}

export interface LeaseLabelValues {
  stage: string;
}

export interface OrphanLabelValues {
  stage: string;
  recovery_action: 'retry' | 'block' | 'fail';
}

export interface RetryLabelValues {
  stage: string;
  failure_class: FailureClass;
}

export interface RetryLimitLabelValues {
  stage: string;
}

export interface DoomLoopLabelValues {
  stage: string;
}

export interface ResourceLockLabelValues {
  resource_type: 'task' | 'repo_branch' | 'environment' | 'publish_target';
}

export interface CapabilityMismatchLabelValues {
  stage: WorkerStage;
  capability: Capability;
}

/**
 * Metrics Collector class
 *
 * Manages Prometheus metrics for the control plane.
 */
export class MetricsCollector {
  private readonly registry: Registry;
  private readonly prefix: string;

  // Task metrics
  private readonly tasksTotal: Counter<TaskLabels>;
  private readonly tasksActive: Gauge<string>;

  // Job metrics
  private readonly jobsTotal: Counter<JobLabels>;
  private readonly jobDurationSeconds: Histogram<JobLabels>;

  // Dispatch/Result metrics
  private readonly dispatchTotal: Counter<DispatchLabels>;
  private readonly resultTotal: Counter<ResultLabels>;

  // Lease/Orphan metrics
  private readonly jobLeaseExpiredTotal: Counter<LeaseLabels>;
  private readonly jobOrphanRecoveredTotal: Counter<OrphanLabels>;

  // Retry metrics
  private readonly jobRetriesTotal: Counter<RetryLabels>;
  private readonly jobRetryLimitReachedTotal: Counter<RetryLimitLabels>;

  // Doom loop metrics
  private readonly doomLoopWarningsTotal: Counter<DoomLoopLabels>;
  private readonly doomLoopBlocksTotal: Counter<DoomLoopLabels>;

  // Resource lock metrics (ADD_REQUIREMENTS.md Section 5)
  private readonly resourceLockConflictTotal: Counter<ResourceLockLabels>;
  private readonly stateUpdateConflictTotal: Counter<string>;

  // Capability mismatch metrics (ADD_REQUIREMENTS.md Section 4)
  private readonly capabilityMismatchTotal: Counter<CapabilityMismatchLabels>;

  // Timing tracker for job durations
  private readonly jobStartTimes = new Map<string, number>();

  constructor(config: MetricsCollectorConfig = {}) {
    this.registry = new client.Registry();
    this.prefix = config.prefix ?? 'shipyard_';

    // Add default labels
    if (config.defaultLabels) {
      this.registry.setDefaultLabels(config.defaultLabels);
    }

    // Initialize task metrics
    this.tasksTotal = new client.Counter({
      name: `${this.prefix}tasks_total`,
      help: 'Total number of tasks by state',
      labelNames: ['state'],
      registers: [this.registry],
    });

    this.tasksActive = new client.Gauge({
      name: `${this.prefix}tasks_active`,
      help: 'Number of currently active tasks',
      registers: [this.registry],
    });

    // Initialize job metrics
    this.jobsTotal = new client.Counter({
      name: `${this.prefix}jobs_total`,
      help: 'Total number of jobs by stage and worker type',
      labelNames: ['stage', 'worker_type'],
      registers: [this.registry],
    });

    this.jobDurationSeconds = new client.Histogram({
      name: `${this.prefix}job_duration_seconds`,
      help: 'Duration of job execution in seconds',
      labelNames: ['stage', 'worker_type'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
      registers: [this.registry],
    });

    // Initialize dispatch metrics
    this.dispatchTotal = new client.Counter({
      name: `${this.prefix}dispatch_total`,
      help: 'Total number of dispatch operations by stage',
      labelNames: ['stage'],
      registers: [this.registry],
    });

    // Initialize result metrics
    this.resultTotal = new client.Counter({
      name: `${this.prefix}result_total`,
      help: 'Total number of result processing operations by status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    // Initialize lease/orphan metrics
    this.jobLeaseExpiredTotal = new client.Counter({
      name: `${this.prefix}job_lease_expired_total`,
      help: 'Total number of job leases that have expired by stage',
      labelNames: ['stage'],
      registers: [this.registry],
    });

    this.jobOrphanRecoveredTotal = new client.Counter({
      name: `${this.prefix}job_orphan_recovered_total`,
      help: 'Total number of orphaned jobs recovered by stage and recovery action',
      labelNames: ['stage', 'recovery_action'],
      registers: [this.registry],
    });

    // Initialize retry metrics
    this.jobRetriesTotal = new client.Counter({
      name: `${this.prefix}job_retries_total`,
      help: 'Total number of job retries by stage and failure class',
      labelNames: ['stage', 'failure_class'],
      registers: [this.registry],
    });

    this.jobRetryLimitReachedTotal = new client.Counter({
      name: `${this.prefix}job_retry_limit_reached_total`,
      help: 'Total number of jobs that reached retry limit by stage',
      labelNames: ['stage'],
      registers: [this.registry],
    });

    // Initialize doom loop metrics
    this.doomLoopWarningsTotal = new client.Counter({
      name: `${this.prefix}doom_loop_warnings_total`,
      help: 'Total number of doom loop warnings by stage',
      labelNames: ['stage'],
      registers: [this.registry],
    });

    this.doomLoopBlocksTotal = new client.Counter({
      name: `${this.prefix}doom_loop_blocks_total`,
      help: 'Total number of doom loop blocks by stage',
      labelNames: ['stage'],
      registers: [this.registry],
    });

    // Initialize resource lock metrics
    this.resourceLockConflictTotal = new client.Counter({
      name: `${this.prefix}resource_lock_conflict_total`,
      help: 'Total number of resource lock conflicts by resource type',
      labelNames: ['resource_type'],
      registers: [this.registry],
    });

    this.stateUpdateConflictTotal = new client.Counter({
      name: `${this.prefix}state_update_conflict_total`,
      help: 'Total number of state update conflicts (optimistic lock failures)',
      registers: [this.registry],
    });

    // Initialize capability mismatch metrics
    this.capabilityMismatchTotal = new client.Counter({
      name: `${this.prefix}capability_mismatch_total`,
      help: 'Total number of capability mismatches by stage and capability',
      labelNames: ['stage', 'capability'],
      registers: [this.registry],
    });

    // Enable default metrics if requested
    if (config.enableDefaultMetrics ?? true) {
      client.collectDefaultMetrics({ register: this.registry, prefix: this.prefix });
    }
  }

  /**
   * Get the Prometheus registry
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get the metrics prefix
   */
  getPrefix(): string {
    return this.prefix;
  }

  // ---------------------------------------------------------------------------
  // Task Metrics
  // ---------------------------------------------------------------------------

  /**
   * Increment the total task count for a state
   */
  incrementTasksTotal(state: TaskState): void {
    this.tasksTotal.inc({ state });
  }

  /**
   * Set the active task count
   */
  setActiveTasks(count: number): void {
    this.tasksActive.set(count);
  }

  /**
   * Increment active tasks
   */
  incrementActiveTasks(): void {
    this.tasksActive.inc();
  }

  /**
   * Decrement active tasks
   */
  decrementActiveTasks(): void {
    this.tasksActive.dec();
  }

  // ---------------------------------------------------------------------------
  // Job Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a new job creation
   */
  recordJobCreation(stage: WorkerStage, workerType: WorkerType): void {
    this.jobsTotal.inc({ stage, worker_type: workerType });
  }

  /**
   * Start timing a job
   */
  startJobTimer(jobId: string): void {
    this.jobStartTimes.set(jobId, Date.now());
  }

  /**
   * End timing a job and record the duration
   */
  endJobTimer(jobId: string, stage: WorkerStage, workerType: WorkerType): number | undefined {
    const startTime = this.jobStartTimes.get(jobId);
    if (startTime === undefined) {
      return undefined;
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    this.jobDurationSeconds.observe({ stage, worker_type: workerType }, durationSeconds);
    this.jobStartTimes.delete(jobId);

    return durationSeconds;
  }

  /**
   * Record job duration directly
   */
  recordJobDuration(stage: WorkerStage, workerType: WorkerType, durationSeconds: number): void {
    this.jobDurationSeconds.observe({ stage, worker_type: workerType }, durationSeconds);
  }

  // ---------------------------------------------------------------------------
  // Dispatch Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a dispatch operation
   */
  recordDispatch(stage: WorkerStage): void {
    this.dispatchTotal.inc({ stage });
  }

  // ---------------------------------------------------------------------------
  // Result Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a result processing operation
   */
  recordResult(status: 'succeeded' | 'failed' | 'blocked'): void {
    this.resultTotal.inc({ status });
  }

  // ---------------------------------------------------------------------------
  // Lease/Orphan Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a lease expiration event
   */
  recordLeaseExpired(stage: string): void {
    this.jobLeaseExpiredTotal.inc({ stage });
  }

  /**
   * Record an orphan recovery event
   */
  recordOrphanRecovered(stage: string, recoveryAction: 'retry' | 'block' | 'fail'): void {
    this.jobOrphanRecoveredTotal.inc({ stage, recovery_action: recoveryAction });
  }

  // ---------------------------------------------------------------------------
  // Retry Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a job retry event
   */
  recordJobRetry(stage: string, failureClass: FailureClass): void {
    this.jobRetriesTotal.inc({ stage, failure_class: failureClass });
  }

  /**
   * Record when a job reaches its retry limit
   */
  recordRetryLimitReached(stage: string): void {
    this.jobRetryLimitReachedTotal.inc({ stage });
  }

  // ---------------------------------------------------------------------------
  // Doom Loop Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a doom loop warning event
   */
  recordDoomLoopWarning(stage: string): void {
    this.doomLoopWarningsTotal.inc({ stage });
  }

  /**
   * Record a doom loop block event
   */
  recordDoomLoopBlock(stage: string): void {
    this.doomLoopBlocksTotal.inc({ stage });
  }

  // ---------------------------------------------------------------------------
  // Resource Lock Metrics
  // ---------------------------------------------------------------------------

  /**
   * Record a resource lock conflict
   */
  recordResourceLockConflict(resourceType: 'task' | 'repo_branch' | 'environment' | 'publish_target'): void {
    this.resourceLockConflictTotal.inc({ resource_type: resourceType });
  }

  /**
   * Record a state update conflict (optimistic lock failure)
   */
  recordStateUpdateConflict(): void {
    this.stateUpdateConflictTotal.inc();
  }

  // ---------------------------------------------------------------------------
  // Capability Mismatch Metrics (ADD_REQUIREMENTS.md Section 4)
  // ---------------------------------------------------------------------------

  /**
   * Record a capability mismatch event.
   * Called when a worker lacks required capabilities for a stage.
   */
  recordCapabilityMismatch(stage: WorkerStage, capability: Capability): void {
    this.capabilityMismatchTotal.inc({ stage, capability });
  }

  /**
   * Record multiple capability mismatches at once.
   * Convenience method for batch recording.
   */
  recordCapabilityMismatches(stage: WorkerStage, capabilities: Capability[]): void {
    for (const capability of capabilities) {
      this.recordCapabilityMismatch(stage, capability);
    }
  }

  // ---------------------------------------------------------------------------
  // Domain Event Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle task creation event
   */
  onTaskCreated(state: TaskState): void {
    this.incrementTasksTotal(state);
    this.incrementActiveTasks();
  }

  /**
   * Handle task state transition event
   */
  onTaskTransition(_fromState: TaskState, toState: TaskState): void {
    this.incrementTasksTotal(toState);

    // Check if task became terminal
    const terminalStates: TaskState[] = ['accepted', 'published', 'cancelled', 'failed'];
    if (terminalStates.includes(toState)) {
      this.decrementActiveTasks();
    }
  }

  /**
   * Handle job dispatch event
   */
  onJobDispatched(jobId: string, stage: WorkerStage, workerType: WorkerType): void {
    this.recordJobCreation(stage, workerType);
    this.recordDispatch(stage);
    this.startJobTimer(jobId);
  }

  /**
   * Handle job result event
   */
  onJobResult(jobId: string, stage: WorkerStage, workerType: WorkerType, status: 'succeeded' | 'failed' | 'blocked'): void {
    this.endJobTimer(jobId, stage, workerType);
    this.recordResult(status);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Export metrics in Prometheus text format
   */
  async export(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Export metrics as JSON
   */
  async exportJson(): Promise<unknown[]> {
    return this.registry.getMetricsAsJSON();
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clear(): void {
    this.registry.resetMetrics();
    this.jobStartTimes.clear();
  }

  /**
   * Get Content-Type header for Prometheus format
   */
  getContentType(): string {
    return this.registry.contentType;
  }
}

// -----------------------------------------------------------------------------
// Global Instance
// -----------------------------------------------------------------------------

let globalCollector: MetricsCollector | null = null;

/**
 * Initialize the global metrics collector
 */
export function initializeMetricsCollector(config?: MetricsCollectorConfig): MetricsCollector {
  globalCollector = new MetricsCollector(config);
  return globalCollector;
}

/**
 * Get the global metrics collector
 */
export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector();
  }
  return globalCollector;
}

/**
 * Reset the global metrics collector (useful for testing)
 */
export function resetMetricsCollector(): void {
  if (globalCollector) {
    globalCollector.clear();
  }
  globalCollector = null;
}