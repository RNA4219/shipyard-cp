/**
 * Sub-agent spawn limit control module
 * Implements AgentTreeLimits and SpawnController for controlling sub-agent spawning
 * Based on ADD_REQUIREMENTS.md Section 6
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Scope for spawn control
 * - 'job': Per job tree (same job and descendants)
 * - 'worker': Per worker instance
 * - 'global': System-wide
 */
export type SpawnControlScope = 'job' | 'worker' | 'global';

/**
 * Overflow policy for when limits are exceeded
 */
export interface OverflowPolicy {
  /** Action when concurrent limit is exceeded: 'queue' or 'reject' */
  on_concurrent_limit_exceeded: 'queue' | 'reject';
  /** Action when rate limit is exceeded: 'queue' or 'reject' */
  on_rate_limit_exceeded: 'queue' | 'reject';
}

/**
 * Rate limit configuration using token bucket algorithm
 */
export interface SpawnRateLimit {
  /** Time window in seconds (must be 60) */
  window_seconds: number;
  /** Maximum spawns allowed per window */
  max_spawns_per_window: number;
  /** Burst capacity - maximum tokens in bucket */
  burst: number;
  /** Algorithm type (fixed as 'token_bucket') */
  algorithm: 'token_bucket';
}

/**
 * Configuration for agent tree limits
 */
export interface AgentTreeLimits {
  /** Whether spawn control is enabled */
  enabled: boolean;
  /** Scope of the limits */
  scope: SpawnControlScope;
  /** Maximum concurrent agents allowed */
  max_concurrent_agents: number;
  /** Rate limiting configuration */
  spawn_rate_limit: SpawnRateLimit;
  /** Overflow handling policy */
  overflow_policy: OverflowPolicy;
  /** Maximum time a spawn request can wait in queue (seconds) */
  max_queue_wait_seconds: number;
  /** Whether to count descendant agents in the limit */
  count_descendants: boolean;
  /** Whether to include the root agent in the count */
  include_root_agent: boolean;
}

/**
 * Default AgentTreeLimits configuration
 */
export const DEFAULT_AGENT_TREE_LIMITS: AgentTreeLimits = {
  enabled: true,
  scope: 'job',
  max_concurrent_agents: 300,
  spawn_rate_limit: {
    window_seconds: 60,
    max_spawns_per_window: 150,
    burst: 150,
    algorithm: 'token_bucket',
  },
  overflow_policy: {
    on_concurrent_limit_exceeded: 'queue',
    on_rate_limit_exceeded: 'queue',
  },
  max_queue_wait_seconds: 60,
  count_descendants: true,
  include_root_agent: false,
};

/**
 * Reason codes for spawn decisions
 */
export type SpawnReasonCode =
  | 'ALLOWED'
  | 'CONCURRENT_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'AGENT_QUEUE_TIMEOUT'
  | 'DISABLED'
  | 'INVALID_REQUEST';

/**
 * Spawn decision result
 */
export type SpawnDecision = 'allow' | 'queue' | 'reject';

/**
 * Spawn request metadata
 */
export interface SpawnRequest {
  /** Unique identifier for the spawn request */
  spawn_request_id: string;
  /** ID of the parent job */
  parent_job_id: string;
  /** ID of the parent agent */
  parent_agent_id: string;
  /** Scope for this request */
  scope: SpawnControlScope;
  /** Timestamp when request was made */
  requested_at: Date;
  /** Current active agent count at request time */
  active_count: number;
  /** Remaining tokens in bucket at request time */
  remaining_tokens: number;
  /** Queue expiration timestamp if queued */
  queue_expires_at?: Date;
}

/**
 * Spawn evaluation result
 */
export interface SpawnResult {
  /** Decision: allow, queue, or reject */
  decision: SpawnDecision;
  /** Reason code explaining the decision */
  reason_code: SpawnReasonCode;
  /** Time waited in queue (if applicable) */
  queue_wait_seconds?: number;
  /** Request metadata */
  request: SpawnRequest;
}

/**
 * Queued spawn request entry
 */
interface QueuedRequest {
  request: SpawnRequest;
  resolve: (result: SpawnResult) => void;
  queued_at: Date;
}

// ============================================================================
// Token Bucket Implementation
// ============================================================================

/**
 * Token Bucket for rate limiting
 */
export class TokenBucket {
  private static readonly EPSILON = 0.005;
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Attempt to consume tokens from the bucket
   * @param count Number of tokens to consume
   * @returns true if tokens were consumed, false if insufficient
   */
  consume(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      if (this.tokens < TokenBucket.EPSILON) {
        this.tokens = 0;
      }
      return true;
    }
    return false;
  }

  /**
   * Check if tokens are available without consuming
   */
  peek(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    if (this.tokens < TokenBucket.EPSILON) {
      this.tokens = 0;
    }
    if (this.maxTokens - this.tokens < TokenBucket.EPSILON) {
      this.tokens = this.maxTokens;
    }
    this.lastRefill = now;
  }

  /**
   * Reset bucket to full capacity
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

// ============================================================================
// Metrics Interface
// ============================================================================

/**
 * Metrics collector interface for spawn events
 */
export interface SpawnMetrics {
  /** Increment spawn attempt counter */
  incrementSpawnAttempt(scope: SpawnControlScope): void;
  /** Increment spawn allowed counter */
  incrementSpawnAllowed(scope: SpawnControlScope): void;
  /** Increment spawn rejected counter */
  incrementSpawnRejected(scope: SpawnControlScope, reasonCode: SpawnReasonCode): void;
  /** Increment spawn queued counter */
  incrementSpawnQueued(scope: SpawnControlScope): void;
  /** Set current active agent count */
  setActiveCount(scope: SpawnControlScope, count: number): void;
  /** Record queue wait time */
  recordQueueWaitTime(seconds: number): void;
  /** Set current rate tokens */
  setRateTokensCurrent(scope: SpawnControlScope, tokens: number): void;
}

/**
 * Default no-op metrics implementation
 */
export class NoopMetrics implements SpawnMetrics {
  incrementSpawnAttempt(): void {}
  incrementSpawnAllowed(): void {}
  incrementSpawnRejected(): void {}
  incrementSpawnQueued(): void {}
  setActiveCount(): void {}
  recordQueueWaitTime(): void {}
  setRateTokensCurrent(): void {}
}

// ============================================================================
// Scope Manager
// ============================================================================

/**
 * Tracks active agents per scope
 */
interface ScopeState {
  activeAgents: Set<string>;
  tokenBucket: TokenBucket;
  queue: QueuedRequest[];
}

/**
 * Manager for tracking state across different scopes
 */
export class ScopeManager {
  private readonly states: Map<string, ScopeState> = new Map();
  private readonly config: AgentTreeLimits;

  constructor(config: AgentTreeLimits = DEFAULT_AGENT_TREE_LIMITS) {
    this.config = config;
  }

  /**
   * Get or create state for a scope key
   */
  private getScopeState(scopeKey: string): ScopeState {
    let state = this.states.get(scopeKey);
    if (!state) {
      const tokensPerMs = this.config.spawn_rate_limit.max_spawns_per_window / (this.config.spawn_rate_limit.window_seconds * 1000);
      state = {
        activeAgents: new Set(),
        tokenBucket: new TokenBucket(
          this.config.spawn_rate_limit.burst,
          tokensPerMs
        ),
        queue: [],
      };
      this.states.set(scopeKey, state);
    }
    return state;
  }

  /**
   * Get the count of active agents for a scope
   */
  getActiveCount(scopeKey: string): number {
    const state = this.states.get(scopeKey);
    return state ? state.activeAgents.size : 0;
  }

  /**
   * Register an agent as active in a scope
   */
  registerAgent(scopeKey: string, agentId: string): void {
    const state = this.getScopeState(scopeKey);
    state.activeAgents.add(agentId);
  }

  /**
   * Unregister an agent from a scope
   */
  unregisterAgent(scopeKey: string, agentId: string): void {
    const state = this.states.get(scopeKey);
    if (state) {
      state.activeAgents.delete(agentId);
    }
  }

  /**
   * Get remaining tokens for a scope
   */
  getRemainingTokens(scopeKey: string): number {
    const state = this.getScopeState(scopeKey);
    return state.tokenBucket.getTokens();
  }

  /**
   * Try to consume a token from the rate limiter
   */
  tryConsumeToken(scopeKey: string): boolean {
    const state = this.getScopeState(scopeKey);
    return state.tokenBucket.consume(1);
  }

  /**
   * Get the queue for a scope
   */
  getQueue(scopeKey: string): QueuedRequest[] {
    const state = this.getScopeState(scopeKey);
    return state.queue;
  }

  /**
   * Add to queue
   */
  addToQueue(scopeKey: string, entry: QueuedRequest): void {
    const state = this.getScopeState(scopeKey);
    state.queue.push(entry);
  }

  /**
   * Remove from queue
   */
  removeFromQueue(scopeKey: string, spawnRequestId: string): void {
    const state = this.states.get(scopeKey);
    if (state) {
      const index = state.queue.findIndex(q => q.request.spawn_request_id === spawnRequestId);
      if (index >= 0) {
        state.queue.splice(index, 1);
      }
    }
  }

  /**
   * Build scope key from scope type and identifiers
   */
  static buildScopeKey(scope: SpawnControlScope, jobId?: string, workerId?: string): string {
    switch (scope) {
      case 'job':
        return `job:${jobId ?? 'unknown'}`;
      case 'worker':
        return `worker:${workerId ?? 'unknown'}`;
      case 'global':
        return 'global';
    }
  }
}

// ============================================================================
// Spawn Controller
// ============================================================================

/**
 * Controller for managing sub-agent spawn requests
 */
export class SpawnController {
  private readonly config: AgentTreeLimits;
  private readonly scopeManager: ScopeManager;
  private readonly metrics: SpawnMetrics;
  private readonly processQueueInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: AgentTreeLimits = DEFAULT_AGENT_TREE_LIMITS,
    metrics: SpawnMetrics = new NoopMetrics()
  ) {
    this.config = config;
    this.scopeManager = new ScopeManager(config);
    this.metrics = metrics;
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentTreeLimits {
    return { ...this.config };
  }

  /**
   * Evaluate a spawn request
   */
  async evaluateSpawn(request: {
    spawn_request_id: string;
    parent_job_id: string;
    parent_agent_id: string;
    worker_id?: string;
    scope?: SpawnControlScope;
  }): Promise<SpawnResult> {
    const scope = request.scope ?? this.config.scope;
    const scopeKey = ScopeManager.buildScopeKey(scope, request.parent_job_id, request.worker_id);

    this.metrics.incrementSpawnAttempt(scope);

    const activeCount = this.scopeManager.getActiveCount(scopeKey);
    const remainingTokens = this.scopeManager.getRemainingTokens(scopeKey);

    const spawnRequest: SpawnRequest = {
      spawn_request_id: request.spawn_request_id,
      parent_job_id: request.parent_job_id,
      parent_agent_id: request.parent_agent_id,
      scope,
      requested_at: new Date(),
      active_count: activeCount,
      remaining_tokens: remainingTokens,
    };

    // Check if spawn control is enabled
    if (!this.config.enabled) {
      return this.createResult('allow', 'DISABLED', spawnRequest);
    }

    // Check concurrent limit
    const effectiveMaxAgents = this.config.include_root_agent
      ? this.config.max_concurrent_agents
      : this.config.max_concurrent_agents;

    if (activeCount >= effectiveMaxAgents) {
      return this.handleConcurrentLimitExceeded(scopeKey, spawnRequest);
    }

    // Check rate limit
    if (!this.scopeManager.tryConsumeToken(scopeKey)) {
      return this.handleRateLimitExceeded(scopeKey, spawnRequest);
    }

    // All checks passed - allow spawn
    this.metrics.incrementSpawnAllowed(scope);
    this.metrics.setRateTokensCurrent(scope, this.scopeManager.getRemainingTokens(scopeKey));

    return this.createResult('allow', 'ALLOWED', spawnRequest);
  }

  /**
   * Handle concurrent limit exceeded
   */
  private handleConcurrentLimitExceeded(scopeKey: string, request: SpawnRequest): SpawnResult {
    const policy = this.config.overflow_policy.on_concurrent_limit_exceeded;

    if (policy === 'reject') {
      this.metrics.incrementSpawnRejected(request.scope, 'CONCURRENT_LIMIT_EXCEEDED');
      return this.createResult('reject', 'CONCURRENT_LIMIT_EXCEEDED', request);
    }

    // Queue the request
    return this.queueRequest(scopeKey, request, 'CONCURRENT_LIMIT_EXCEEDED');
  }

  /**
   * Handle rate limit exceeded
   */
  private handleRateLimitExceeded(scopeKey: string, request: SpawnRequest): SpawnResult {
    const policy = this.config.overflow_policy.on_rate_limit_exceeded;

    if (policy === 'reject') {
      this.metrics.incrementSpawnRejected(request.scope, 'RATE_LIMIT_EXCEEDED');
      return this.createResult('reject', 'RATE_LIMIT_EXCEEDED', request);
    }

    // Queue the request
    return this.queueRequest(scopeKey, request, 'RATE_LIMIT_EXCEEDED');
  }

  /**
   * Queue a spawn request
   */
  private queueRequest(_scopeKey: string, request: SpawnRequest, reasonCode: SpawnReasonCode): SpawnResult {
    this.metrics.incrementSpawnQueued(request.scope);

    const queueExpiresAt = new Date(Date.now() + this.config.max_queue_wait_seconds * 1000);
    const queuedRequest: SpawnRequest = {
      ...request,
      queue_expires_at: queueExpiresAt,
    };

    // In a real implementation, this would return a Promise that resolves when dequeued
    // For now, we simulate the queue behavior synchronously for testing purposes
    const result = this.createResult('queue', reasonCode, queuedRequest);
    result.queue_wait_seconds = 0;

    return result;
  }

  /**
   * Wait for a queued spawn to be processed
   * Returns a promise that resolves when spawn is allowed or times out
   */
  async waitForQueuedSpawn(
    scopeKey: string,
    request: SpawnRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _reasonCode: SpawnReasonCode
  ): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const entry: QueuedRequest = {
        request,
        resolve,
        queued_at: new Date(),
      };

      this.scopeManager.addToQueue(scopeKey, entry);

      // Set up timeout
      const timeoutMs = this.config.max_queue_wait_seconds * 1000;
      const timeout = setTimeout(() => {
        this.scopeManager.removeFromQueue(scopeKey, request.spawn_request_id);
        this.metrics.incrementSpawnRejected(request.scope, 'AGENT_QUEUE_TIMEOUT');
        resolve(this.createResult('reject', 'AGENT_QUEUE_TIMEOUT', request));
      }, timeoutMs);

      // Store timeout for cleanup when processed
      (entry as QueuedRequest & { timeout?: ReturnType<typeof setTimeout> }).timeout = timeout;
    });
  }

  /**
   * Process the queue for a scope - called when an agent completes
   */
  processQueue(scopeKey: string): void {
    const queue = this.scopeManager.getQueue(scopeKey);
    const activeCount = this.scopeManager.getActiveCount(scopeKey);

    while (queue.length > 0 && activeCount < this.config.max_concurrent_agents) {
      const entry = queue.shift();
      if (!entry) break;

      // Check if request has expired
      if (entry.request.queue_expires_at && entry.request.queue_expires_at < new Date()) {
        this.metrics.incrementSpawnRejected(entry.request.scope, 'AGENT_QUEUE_TIMEOUT');
        const waitTime = (Date.now() - entry.queued_at.getTime()) / 1000;
        this.metrics.recordQueueWaitTime(waitTime);
        entry.resolve(this.createResult('reject', 'AGENT_QUEUE_TIMEOUT', entry.request));
        continue;
      }

      // Check rate limit
      if (!this.scopeManager.tryConsumeToken(scopeKey)) {
        // Put back at front of queue
        queue.unshift(entry);
        break;
      }

      // Calculate wait time
      const waitTime = (Date.now() - entry.queued_at.getTime()) / 1000;
      this.metrics.recordQueueWaitTime(waitTime);

      // Allow spawn
      const result = this.createResult('allow', 'ALLOWED', entry.request);
      result.queue_wait_seconds = waitTime;
      this.metrics.incrementSpawnAllowed(entry.request.scope);
      entry.resolve(result);
    }
  }

  /**
   * Register an agent as active (called after spawn succeeds)
   */
  registerActiveAgent(scope: SpawnControlScope, agentId: string, jobId?: string, workerId?: string): void {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    this.scopeManager.registerAgent(scopeKey, agentId);
    const activeCount = this.scopeManager.getActiveCount(scopeKey);
    this.metrics.setActiveCount(scope, activeCount);
  }

  /**
   * Unregister an agent (called when agent completes)
   */
  unregisterAgent(scope: SpawnControlScope, agentId: string, jobId?: string, workerId?: string): void {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    this.scopeManager.unregisterAgent(scopeKey, agentId);
    const activeCount = this.scopeManager.getActiveCount(scopeKey);
    this.metrics.setActiveCount(scope, activeCount);
    // Process queue after agent completes
    this.processQueue(scopeKey);
  }

  /**
   * Get current active agent count for a scope
   */
  getActiveAgentCount(scope: SpawnControlScope, jobId?: string, workerId?: string): number {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    return this.scopeManager.getActiveCount(scopeKey);
  }

  /**
   * Get current queue length for a scope
   */
  getQueueLength(scope: SpawnControlScope, jobId?: string, workerId?: string): number {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    return this.scopeManager.getQueue(scopeKey).length;
  }

  /**
   * Create a spawn result object
   */
  private createResult(
    decision: SpawnDecision,
    reasonCode: SpawnReasonCode,
    request: SpawnRequest
  ): SpawnResult {
    return {
      decision,
      reason_code: reasonCode,
      request,
    };
  }

  /**
   * Start processing queues periodically
   */
  startQueueProcessor(intervalMs: number = 1000): void {
    // Periodically check and process queues for token availability
    setInterval(() => {
      for (const [scopeKey] of this.scopeManager['states']) {
        this.processQueue(scopeKey);
      }
    }, intervalMs);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.processQueueInterval) {
      clearInterval(this.processQueueInterval);
    }
  }
}

// ============================================================================
// In-Memory Metrics Implementation
// ============================================================================

/**
 * In-memory metrics collector for testing and development
 */
export class InMemoryMetrics implements SpawnMetrics {
  private readonly spawnAttempts: Map<SpawnControlScope, number> = new Map();
  private readonly spawnAllowed: Map<SpawnControlScope, number> = new Map();
  private readonly spawnRejected: Map<string, number> = new Map();
  private readonly spawnQueued: Map<SpawnControlScope, number> = new Map();
  private readonly activeCounts: Map<SpawnControlScope, number> = new Map();
  private readonly rateTokens: Map<SpawnControlScope, number> = new Map();
  private queueWaitTimes: number[] = [];

  incrementSpawnAttempt(scope: SpawnControlScope): void {
    this.spawnAttempts.set(scope, (this.spawnAttempts.get(scope) ?? 0) + 1);
  }

  incrementSpawnAllowed(scope: SpawnControlScope): void {
    this.spawnAllowed.set(scope, (this.spawnAllowed.get(scope) ?? 0) + 1);
  }

  incrementSpawnRejected(scope: SpawnControlScope, reasonCode: SpawnReasonCode): void {
    const key = `${scope}:${reasonCode}`;
    this.spawnRejected.set(key, (this.spawnRejected.get(key) ?? 0) + 1);
  }

  incrementSpawnQueued(scope: SpawnControlScope): void {
    this.spawnQueued.set(scope, (this.spawnQueued.get(scope) ?? 0) + 1);
  }

  setActiveCount(scope: SpawnControlScope, count: number): void {
    this.activeCounts.set(scope, count);
  }

  recordQueueWaitTime(seconds: number): void {
    this.queueWaitTimes.push(seconds);
  }

  setRateTokensCurrent(scope: SpawnControlScope, tokens: number): void {
    this.rateTokens.set(scope, tokens);
  }

  // Getters for testing
  getSpawnAttempts(scope: SpawnControlScope): number {
    return this.spawnAttempts.get(scope) ?? 0;
  }

  getSpawnAllowed(scope: SpawnControlScope): number {
    return this.spawnAllowed.get(scope) ?? 0;
  }

  getSpawnRejected(scope: SpawnControlScope, reasonCode: SpawnReasonCode): number {
    const key = `${scope}:${reasonCode}`;
    return this.spawnRejected.get(key) ?? 0;
  }

  getSpawnQueued(scope: SpawnControlScope): number {
    return this.spawnQueued.get(scope) ?? 0;
  }

  getActiveCount(scope: SpawnControlScope): number {
    return this.activeCounts.get(scope) ?? 0;
  }

  getRateTokens(scope: SpawnControlScope): number {
    return this.rateTokens.get(scope) ?? 0;
  }

  getQueueWaitTimes(): number[] {
    return [...this.queueWaitTimes];
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];

    // agent_spawn_attempt_total
    for (const [scope, count] of this.spawnAttempts) {
      lines.push(`agent_spawn_attempt_total{scope="${scope}"} ${count}`);
    }

    // agent_spawn_allowed_total
    for (const [scope, count] of this.spawnAllowed) {
      lines.push(`agent_spawn_allowed_total{scope="${scope}"} ${count}`);
    }

    // agent_spawn_rejected_total
    for (const [key, count] of this.spawnRejected) {
      const [scope, reasonCode] = key.split(':');
      lines.push(`agent_spawn_rejected_total{scope="${scope}",reason_code="${reasonCode}"} ${count}`);
    }

    // agent_spawn_queued_total
    for (const [scope, count] of this.spawnQueued) {
      lines.push(`agent_spawn_queued_total{scope="${scope}"} ${count}`);
    }

    // agent_active_current
    for (const [scope, count] of this.activeCounts) {
      lines.push(`agent_active_current{scope="${scope}"} ${count}`);
    }

    // agent_rate_tokens_current
    for (const [scope, tokens] of this.rateTokens) {
      lines.push(`agent_rate_tokens_current{scope="${scope}"} ${Math.floor(tokens)}`);
    }

    // agent_queue_wait_seconds (histogram-like summary)
    if (this.queueWaitTimes.length > 0) {
      const avg = this.queueWaitTimes.reduce((a, b) => a + b, 0) / this.queueWaitTimes.length;
      lines.push(`agent_queue_wait_seconds{type="count"} ${this.queueWaitTimes.length}`);
      lines.push(`agent_queue_wait_seconds{type="sum"} ${this.queueWaitTimes.reduce((a, b) => a + b, 0).toFixed(3)}`);
      lines.push(`agent_queue_wait_seconds{type="avg"} ${avg.toFixed(3)}`);
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Factory and Utility Functions
// ============================================================================

/**
 * Create a spawn controller with default configuration
 */
export function createSpawnController(metrics?: SpawnMetrics): SpawnController {
  return new SpawnController(DEFAULT_AGENT_TREE_LIMITS, metrics);
}

/**
 * Create a spawn controller with custom configuration
 */
export function createSpawnControllerWithConfig(
  config: Partial<AgentTreeLimits>,
  metrics?: SpawnMetrics
): SpawnController {
  const fullConfig: AgentTreeLimits = {
    ...DEFAULT_AGENT_TREE_LIMITS,
    ...config,
    spawn_rate_limit: {
      ...DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit,
      ...config.spawn_rate_limit,
    },
    overflow_policy: {
      ...DEFAULT_AGENT_TREE_LIMITS.overflow_policy,
      ...config.overflow_policy,
    },
  };
  return new SpawnController(fullConfig, metrics);
}

/**
 * Validate AgentTreeLimits configuration
 */
export function validateAgentTreeLimits(config: AgentTreeLimits): string[] {
  const errors: string[] = [];

  if (config.max_concurrent_agents < 1) {
    errors.push('max_concurrent_agents must be >= 1');
  }

  if (config.spawn_rate_limit.window_seconds !== 60) {
    errors.push('spawn_rate_limit.window_seconds must be 60');
  }

  if (config.spawn_rate_limit.max_spawns_per_window < 1) {
    errors.push('spawn_rate_limit.max_spawns_per_window must be >= 1');
  }

  if (config.spawn_rate_limit.burst < 1) {
    errors.push('spawn_rate_limit.burst must be >= 1');
  }

  if (!['job', 'worker', 'global'].includes(config.scope)) {
    errors.push('scope must be one of: job, worker, global');
  }

  if (!['queue', 'reject'].includes(config.overflow_policy.on_concurrent_limit_exceeded)) {
    errors.push('overflow_policy.on_concurrent_limit_exceeded must be queue or reject');
  }

  if (!['queue', 'reject'].includes(config.overflow_policy.on_rate_limit_exceeded)) {
    errors.push('overflow_policy.on_rate_limit_exceeded must be queue or reject');
  }

  return errors;
}
