/**
 * Sub-agent spawn limit control module
 * Implements AgentTreeLimits and SpawnController for controlling sub-agent spawning
 * Based on ADD_REQUIREMENTS.md Section 6
 *
 * Note: This is a backend copy of the domain logic.
 * The original implementation is in web/src/domain/agent/index.ts
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export type SpawnControlScope = 'job' | 'worker' | 'global';

export interface OverflowPolicy {
  on_concurrent_limit_exceeded: 'queue' | 'reject';
  on_rate_limit_exceeded: 'queue' | 'reject';
}

export interface SpawnRateLimit {
  window_seconds: number;
  max_spawns_per_window: number;
  burst: number;
  algorithm: 'token_bucket';
}

export interface AgentTreeLimits {
  enabled: boolean;
  scope: SpawnControlScope;
  max_concurrent_agents: number;
  spawn_rate_limit: SpawnRateLimit;
  overflow_policy: OverflowPolicy;
  max_queue_wait_seconds: number;
  count_descendants: boolean;
  include_root_agent: boolean;
}

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

export type SpawnReasonCode =
  | 'ALLOWED'
  | 'CONCURRENT_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'AGENT_QUEUE_TIMEOUT'
  | 'DISABLED'
  | 'INVALID_REQUEST';

export type SpawnDecision = 'allow' | 'queue' | 'reject';

export interface SpawnRequest {
  spawn_request_id: string;
  parent_job_id: string;
  parent_agent_id: string;
  scope: SpawnControlScope;
  requested_at: Date;
  active_count: number;
  remaining_tokens: number;
  queue_expires_at?: Date;
}

export interface SpawnResult {
  decision: SpawnDecision;
  reason_code: SpawnReasonCode;
  queue_wait_seconds?: number;
  request: SpawnRequest;
}

interface QueuedRequest {
  request: SpawnRequest;
  resolve: (result: SpawnResult) => void;
  queued_at: Date;
}

// ============================================================================
// Token Bucket Implementation
// ============================================================================

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  consume(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  peek(): number {
    this.refill();
    return this.tokens;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

// ============================================================================
// Metrics Interface
// ============================================================================

export interface SpawnMetrics {
  incrementSpawnAttempt(scope: SpawnControlScope): void;
  incrementSpawnAllowed(scope: SpawnControlScope): void;
  incrementSpawnRejected(scope: SpawnControlScope, reasonCode: SpawnReasonCode): void;
  incrementSpawnQueued(scope: SpawnControlScope): void;
  setActiveCount(scope: SpawnControlScope, count: number): void;
  recordQueueWaitTime(seconds: number): void;
  setRateTokensCurrent(scope: SpawnControlScope, tokens: number): void;
}

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

interface ScopeState {
  activeAgents: Set<string>;
  tokenBucket: TokenBucket;
  queue: QueuedRequest[];
}

export class ScopeManager {
  private readonly states: Map<string, ScopeState> = new Map();
  private readonly config: AgentTreeLimits;

  constructor(config: AgentTreeLimits = DEFAULT_AGENT_TREE_LIMITS) {
    this.config = config;
  }

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

  getActiveCount(scopeKey: string): number {
    const state = this.states.get(scopeKey);
    return state ? state.activeAgents.size : 0;
  }

  registerAgent(scopeKey: string, agentId: string): void {
    const state = this.getScopeState(scopeKey);
    state.activeAgents.add(agentId);
  }

  unregisterAgent(scopeKey: string, agentId: string): void {
    const state = this.states.get(scopeKey);
    if (state) {
      state.activeAgents.delete(agentId);
    }
  }

  getRemainingTokens(scopeKey: string): number {
    const state = this.getScopeState(scopeKey);
    return state.tokenBucket.getTokens();
  }

  tryConsumeToken(scopeKey: string): boolean {
    const state = this.getScopeState(scopeKey);
    return state.tokenBucket.consume(1);
  }

  getQueue(scopeKey: string): QueuedRequest[] {
    const state = this.getScopeState(scopeKey);
    return state.queue;
  }

  addToQueue(scopeKey: string, entry: QueuedRequest): void {
    const state = this.getScopeState(scopeKey);
    state.queue.push(entry);
  }

  removeFromQueue(scopeKey: string, spawnRequestId: string): void {
    const state = this.states.get(scopeKey);
    if (state) {
      const index = state.queue.findIndex(q => q.request.spawn_request_id === spawnRequestId);
      if (index >= 0) {
        state.queue.splice(index, 1);
      }
    }
  }

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

export class SpawnController {
  private readonly config: AgentTreeLimits;
  private readonly scopeManager: ScopeManager;
  private readonly metrics: SpawnMetrics;

  constructor(
    config: AgentTreeLimits = DEFAULT_AGENT_TREE_LIMITS,
    metrics: SpawnMetrics = new NoopMetrics()
  ) {
    this.config = config;
    this.scopeManager = new ScopeManager(config);
    this.metrics = metrics;
  }

  getConfig(): AgentTreeLimits {
    return { ...this.config };
  }

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

    if (!this.config.enabled) {
      return this.createResult('allow', 'DISABLED', spawnRequest);
    }

    if (activeCount >= this.config.max_concurrent_agents) {
      return this.handleConcurrentLimitExceeded(scopeKey, spawnRequest);
    }

    if (!this.scopeManager.tryConsumeToken(scopeKey)) {
      return this.handleRateLimitExceeded(scopeKey, spawnRequest);
    }

    this.metrics.incrementSpawnAllowed(scope);
    this.metrics.setRateTokensCurrent(scope, this.scopeManager.getRemainingTokens(scopeKey));

    return this.createResult('allow', 'ALLOWED', spawnRequest);
  }

  private handleConcurrentLimitExceeded(scopeKey: string, request: SpawnRequest): SpawnResult {
    const policy = this.config.overflow_policy.on_concurrent_limit_exceeded;

    if (policy === 'reject') {
      this.metrics.incrementSpawnRejected(request.scope, 'CONCURRENT_LIMIT_EXCEEDED');
      return this.createResult('reject', 'CONCURRENT_LIMIT_EXCEEDED', request);
    }

    return this.queueRequest(scopeKey, request, 'CONCURRENT_LIMIT_EXCEEDED');
  }

  private handleRateLimitExceeded(scopeKey: string, request: SpawnRequest): SpawnResult {
    const policy = this.config.overflow_policy.on_rate_limit_exceeded;

    if (policy === 'reject') {
      this.metrics.incrementSpawnRejected(request.scope, 'RATE_LIMIT_EXCEEDED');
      return this.createResult('reject', 'RATE_LIMIT_EXCEEDED', request);
    }

    return this.queueRequest(scopeKey, request, 'RATE_LIMIT_EXCEEDED');
  }

  private queueRequest(_scopeKey: string, request: SpawnRequest, reasonCode: SpawnReasonCode): SpawnResult {
    this.metrics.incrementSpawnQueued(request.scope);

    const queueExpiresAt = new Date(Date.now() + this.config.max_queue_wait_seconds * 1000);
    const queuedRequest: SpawnRequest = {
      ...request,
      queue_expires_at: queueExpiresAt,
    };

    const result = this.createResult('queue', reasonCode, queuedRequest);
    result.queue_wait_seconds = 0;

    return result;
  }

  registerActiveAgent(scope: SpawnControlScope, agentId: string, jobId?: string, workerId?: string): void {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    this.scopeManager.registerAgent(scopeKey, agentId);
    const activeCount = this.scopeManager.getActiveCount(scopeKey);
    this.metrics.setActiveCount(scope, activeCount);
  }

  unregisterAgent(scope: SpawnControlScope, agentId: string, jobId?: string, workerId?: string): void {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    this.scopeManager.unregisterAgent(scopeKey, agentId);
    const activeCount = this.scopeManager.getActiveCount(scopeKey);
    this.metrics.setActiveCount(scope, activeCount);
  }

  getActiveAgentCount(scope: SpawnControlScope, jobId?: string, workerId?: string): number {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    return this.scopeManager.getActiveCount(scopeKey);
  }

  getQueueLength(scope: SpawnControlScope, jobId?: string, workerId?: string): number {
    const scopeKey = ScopeManager.buildScopeKey(scope, jobId, workerId);
    return this.scopeManager.getQueue(scopeKey).length;
  }

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
}

// ============================================================================
// In-Memory Metrics Implementation
// ============================================================================

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

  exportPrometheusMetrics(): string {
    const lines: string[] = [];

    for (const [scope, count] of this.spawnAttempts) {
      lines.push(`agent_spawn_attempt_total{scope="${scope}"} ${count}`);
    }

    for (const [scope, count] of this.spawnAllowed) {
      lines.push(`agent_spawn_allowed_total{scope="${scope}"} ${count}`);
    }

    for (const [key, count] of this.spawnRejected) {
      const [scope, reasonCode] = key.split(':');
      lines.push(`agent_spawn_rejected_total{scope="${scope}",reason_code="${reasonCode}"} ${count}`);
    }

    for (const [scope, count] of this.spawnQueued) {
      lines.push(`agent_spawn_queued_total{scope="${scope}"} ${count}`);
    }

    for (const [scope, count] of this.activeCounts) {
      lines.push(`agent_active_current{scope="${scope}"} ${count}`);
    }

    for (const [scope, tokens] of this.rateTokens) {
      lines.push(`agent_rate_tokens_current{scope="${scope}"} ${Math.floor(tokens)}`);
    }

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
// Factory Functions
// ============================================================================

export function createSpawnController(metrics?: SpawnMetrics): SpawnController {
  return new SpawnController(DEFAULT_AGENT_TREE_LIMITS, metrics);
}

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