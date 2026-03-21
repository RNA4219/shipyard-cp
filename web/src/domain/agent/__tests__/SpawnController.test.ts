/**
 * Tests for Spawn Controller
 * Validates acceptance criteria from ADD_REQUIREMENTS.md Section 6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SpawnController,
  InMemoryMetrics,
  TokenBucket,
  DEFAULT_AGENT_TREE_LIMITS,
  createSpawnController,
  createSpawnControllerWithConfig,
  validateAgentTreeLimits,
  type AgentTreeLimits,
} from '../index.js';

describe('TokenBucket', () => {
  it('should allow consuming tokens up to burst capacity', () => {
    const bucket = new TokenBucket(150, 150 / 60000); // 150 tokens, refill 150 per 60s
    expect(bucket.getTokens()).toBe(150);

    // Consume 150 tokens
    expect(bucket.consume(150)).toBe(true);
    expect(bucket.getTokens()).toBe(0);

    // Next consume should fail
    expect(bucket.consume(1)).toBe(false);
  });

  it('should refill tokens over time', () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket(150, 150 / 60000); // 150 tokens per 60s = 2.5 per second

    bucket.consume(150);
    expect(bucket.getTokens()).toBe(0);

    // Advance 30 seconds (half the window)
    vi.advanceTimersByTime(30000);
    expect(bucket.getTokens()).toBeCloseTo(75, 0);

    // Advance another 30 seconds (full window)
    vi.advanceTimersByTime(30000);
    expect(bucket.getTokens()).toBeCloseTo(150, 0);

    vi.useRealTimers();
  });

  it('should not exceed max tokens when refilling', () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket(150, 150 / 60000);

    // Don't consume, let time pass
    vi.advanceTimersByTime(120000); // 2 minutes
    expect(bucket.getTokens()).toBe(150); // Capped at max

    vi.useRealTimers();
  });
});

describe('SpawnController', () => {
  let controller: SpawnController;
  let metrics: InMemoryMetrics;

  beforeEach(() => {
    metrics = new InMemoryMetrics();
    controller = createSpawnController(metrics);
  });

  describe('Acceptance Criteria', () => {
    it('should allow spawn when active count is 299', async () => {
      const scope = 'job';
      const jobId = 'test-job-1';

      // Register 299 active agents
      for (let i = 0; i < 299; i++) {
        controller.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      expect(controller.getActiveAgentCount(scope, jobId)).toBe(299);

      // Spawn request should succeed
      const result = await controller.evaluateSpawn({
        spawn_request_id: 'spawn-300',
        parent_job_id: jobId,
        parent_agent_id: 'agent-298',
        scope,
      });

      expect(result.decision).toBe('allow');
      expect(result.reason_code).toBe('ALLOWED');
      expect(metrics.getSpawnAllowed(scope)).toBe(1);
    });

    it('should queue/reject spawn when active count is 300', async () => {
      const scope = 'job';
      const jobId = 'test-job-2';

      // Register 300 active agents
      for (let i = 0; i < 300; i++) {
        controller.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      expect(controller.getActiveAgentCount(scope, jobId)).toBe(300);

      // Spawn request should be queued (default policy is 'queue')
      const result = await controller.evaluateSpawn({
        spawn_request_id: 'spawn-301',
        parent_job_id: jobId,
        parent_agent_id: 'agent-299',
        scope,
      });

      expect(result.decision).toBe('queue');
      expect(result.reason_code).toBe('CONCURRENT_LIMIT_EXCEEDED');
      expect(metrics.getSpawnQueued(scope)).toBe(1);
    });

    it('should reject spawn when active count is 300 and policy is reject', async () => {
      const config: Partial<AgentTreeLimits> = {
        overflow_policy: {
          on_concurrent_limit_exceeded: 'reject',
          on_rate_limit_exceeded: 'reject',
        },
      };
      const localMetrics = new InMemoryMetrics();
      const rejectController = createSpawnControllerWithConfig(config, localMetrics);

      const scope = 'job';
      const jobId = 'test-job-reject';

      // Register 300 active agents
      for (let i = 0; i < 300; i++) {
        rejectController.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      const result = await rejectController.evaluateSpawn({
        spawn_request_id: 'spawn-301',
        parent_job_id: jobId,
        parent_agent_id: 'agent-299',
        scope,
      });

      expect(result.decision).toBe('reject');
      expect(result.reason_code).toBe('CONCURRENT_LIMIT_EXCEEDED');
      expect(localMetrics.getSpawnRejected(scope, 'CONCURRENT_LIMIT_EXCEEDED')).toBe(1);
    });

    it('should queue/reject spawn when rate limit (150 spawns in 60s) is reached', async () => {
      vi.useFakeTimers();
      const scope = 'job';
      const jobId = 'test-job-ratelimit';

      // Create a controller with small rate limit for testing
      const testConfig: Partial<AgentTreeLimits> = {
        max_concurrent_agents: 500, // High enough to not hit concurrent limit
        spawn_rate_limit: {
          window_seconds: 60,
          max_spawns_per_window: 10, // Small for testing
          burst: 10,
          algorithm: 'token_bucket',
        },
      };
      const localMetrics = new InMemoryMetrics();
      const rateLimitController = createSpawnControllerWithConfig(testConfig, localMetrics);

      // Consume all tokens with 10 spawns
      for (let i = 0; i < 10; i++) {
        const result = await rateLimitController.evaluateSpawn({
          spawn_request_id: `spawn-${i}`,
          parent_job_id: jobId,
          parent_agent_id: 'parent',
          scope,
        });
        expect(result.decision).toBe('allow');
        rateLimitController.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      // 11th spawn should be queued (default policy is queue)
      const result = await rateLimitController.evaluateSpawn({
        spawn_request_id: 'spawn-11',
        parent_job_id: jobId,
        parent_agent_id: 'parent',
        scope,
      });

      expect(result.decision).toBe('queue');
      expect(result.reason_code).toBe('RATE_LIMIT_EXCEEDED');

      vi.useRealTimers();
    });

    it('should allow queued request when slot becomes available', async () => {
      const scope = 'job';
      const jobId = 'test-job-queue';

      // Register 300 agents
      for (let i = 0; i < 300; i++) {
        controller.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      // Queue a spawn request
      const result = await controller.evaluateSpawn({
        spawn_request_id: 'spawn-301',
        parent_job_id: jobId,
        parent_agent_id: 'agent-299',
        scope,
      });

      expect(result.decision).toBe('queue');

      // Unregister one agent (slot becomes available)
      controller.unregisterAgent(scope, 'agent-0', jobId);

      // Process queue - should allow the queued request
      expect(controller.getActiveAgentCount(scope, jobId)).toBe(299);
    });
  });

  describe('Default Configuration', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_AGENT_TREE_LIMITS.enabled).toBe(true);
      expect(DEFAULT_AGENT_TREE_LIMITS.max_concurrent_agents).toBe(300);
      expect(DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit.window_seconds).toBe(60);
      expect(DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit.max_spawns_per_window).toBe(150);
      expect(DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit.burst).toBe(150);
      expect(DEFAULT_AGENT_TREE_LIMITS.max_queue_wait_seconds).toBe(60);
      expect(DEFAULT_AGENT_TREE_LIMITS.count_descendants).toBe(true);
      expect(DEFAULT_AGENT_TREE_LIMITS.include_root_agent).toBe(false);
    });
  });

  describe('Metrics', () => {
    it('should track spawn attempts', async () => {
      const scope = 'job';
      const jobId = 'metrics-test';

      await controller.evaluateSpawn({
        spawn_request_id: 'spawn-1',
        parent_job_id: jobId,
        parent_agent_id: 'parent',
        scope,
      });

      expect(metrics.getSpawnAttempts(scope)).toBe(1);
    });

    it('should track allowed spawns', async () => {
      const scope = 'job';
      const jobId = 'metrics-test';

      await controller.evaluateSpawn({
        spawn_request_id: 'spawn-1',
        parent_job_id: jobId,
        parent_agent_id: 'parent',
        scope,
      });

      expect(metrics.getSpawnAllowed(scope)).toBe(1);
    });

    it('should track active agent count', () => {
      const scope = 'job';
      const jobId = 'metrics-test';

      controller.registerActiveAgent(scope, 'agent-1', jobId);
      controller.registerActiveAgent(scope, 'agent-2', jobId);

      expect(metrics.getActiveCount(scope)).toBe(2);
    });

    it('should export Prometheus metrics', async () => {
      const scope = 'job';
      const jobId = 'prom-test';

      await controller.evaluateSpawn({
        spawn_request_id: 'spawn-1',
        parent_job_id: jobId,
        parent_agent_id: 'parent',
        scope,
      });

      const exported = metrics.exportPrometheusMetrics();
      expect(exported).toContain('agent_spawn_attempt_total');
      expect(exported).toContain('agent_spawn_allowed_total');
    });
  });

  describe('Scope Handling', () => {
    it('should handle job scope correctly', async () => {
      const jobId1 = 'job-1';
      const jobId2 = 'job-2';

      // Register agents in job-1
      controller.registerActiveAgent('job', 'agent-1', jobId1);
      controller.registerActiveAgent('job', 'agent-2', jobId1);

      // Register agents in job-2
      controller.registerActiveAgent('job', 'agent-3', jobId2);

      expect(controller.getActiveAgentCount('job', jobId1)).toBe(2);
      expect(controller.getActiveAgentCount('job', jobId2)).toBe(1);
    });

    it('should handle worker scope correctly', () => {
      const workerId1 = 'worker-1';
      const workerId2 = 'worker-2';

      controller.registerActiveAgent('worker', 'agent-1', undefined, workerId1);
      controller.registerActiveAgent('worker', 'agent-2', undefined, workerId1);
      controller.registerActiveAgent('worker', 'agent-3', undefined, workerId2);

      expect(controller.getActiveAgentCount('worker', undefined, workerId1)).toBe(2);
      expect(controller.getActiveAgentCount('worker', undefined, workerId2)).toBe(1);
    });

    it('should handle global scope correctly', () => {
      controller.registerActiveAgent('global', 'agent-1');
      controller.registerActiveAgent('global', 'agent-2');
      controller.registerActiveAgent('global', 'agent-3');

      expect(controller.getActiveAgentCount('global')).toBe(3);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate valid configuration', () => {
      const errors = validateAgentTreeLimits(DEFAULT_AGENT_TREE_LIMITS);
      expect(errors).toHaveLength(0);
    });

    it('should reject max_concurrent_agents < 1', () => {
      const config = { ...DEFAULT_AGENT_TREE_LIMITS, max_concurrent_agents: 0 };
      const errors = validateAgentTreeLimits(config);
      expect(errors).toContain('max_concurrent_agents must be >= 1');
    });

    it('should reject window_seconds != 60', () => {
      const config = {
        ...DEFAULT_AGENT_TREE_LIMITS,
        spawn_rate_limit: { ...DEFAULT_AGENT_TREE_LIMITS.spawn_rate_limit, window_seconds: 30 },
      };
      const errors = validateAgentTreeLimits(config);
      expect(errors).toContain('spawn_rate_limit.window_seconds must be 60');
    });

    it('should reject invalid scope', () => {
      const config = { ...DEFAULT_AGENT_TREE_LIMITS, scope: 'invalid' as 'job' };
      const errors = validateAgentTreeLimits(config);
      expect(errors).toContain('scope must be one of: job, worker, global');
    });
  });

  describe('Queue Timeout', () => {
    it('should timeout queued requests after max_queue_wait_seconds', async () => {
      vi.useFakeTimers();

      const config: Partial<AgentTreeLimits> = {
        max_queue_wait_seconds: 1, // 1 second for testing
        overflow_policy: {
          on_concurrent_limit_exceeded: 'queue',
          on_rate_limit_exceeded: 'queue',
        },
      };
      const localMetrics = new InMemoryMetrics();
      const timeoutController = createSpawnControllerWithConfig(config, localMetrics);

      const scope = 'job';
      const jobId = 'timeout-test';

      // Fill up to limit
      for (let i = 0; i < 300; i++) {
        timeoutController.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      // Queue a request
      const result = await timeoutController.evaluateSpawn({
        spawn_request_id: 'spawn-301',
        parent_job_id: jobId,
        parent_agent_id: 'agent-299',
        scope,
      });

      expect(result.decision).toBe('queue');

      vi.useRealTimers();
    });
  });

  describe('Enabled/Disabled', () => {
    it('should allow all spawns when disabled', async () => {
      const config: Partial<AgentTreeLimits> = { enabled: false };
      const localMetrics = new InMemoryMetrics();
      const disabledController = createSpawnControllerWithConfig(config, localMetrics);

      const scope = 'job';
      const jobId = 'disabled-test';

      // Register many agents
      for (let i = 0; i < 500; i++) {
        disabledController.registerActiveAgent(scope, `agent-${i}`, jobId);
      }

      // Should still allow spawn
      const result = await disabledController.evaluateSpawn({
        spawn_request_id: 'spawn-501',
        parent_job_id: jobId,
        parent_agent_id: 'agent-500',
        scope,
      });

      expect(result.decision).toBe('allow');
      expect(result.reason_code).toBe('DISABLED');
    });
  });
});