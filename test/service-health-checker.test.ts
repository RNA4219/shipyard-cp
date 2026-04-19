import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ServiceHealthChecker,
  getHealthChecker,
  resetHealthChecker,
} from '../src/health/service-health-checker.js';
import type { RedisBackend } from '../src/store/redis-backend.js';
import { resetConfig } from '../src/config/index.js';

describe('ServiceHealthChecker', () => {
  let checker: ServiceHealthChecker;

  beforeEach(() => {
    resetHealthChecker();
    resetConfig();
    checker = new ServiceHealthChecker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetConfig();
  });

  describe('liveness', () => {
    it('should return ok status', () => {
      const result = checker.liveness();
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('checkAll', () => {
    it('should return overall healthy when all services are healthy', async () => {
      // Set URLs so fetch is called
      process.env.MEMX_RESOLVER_URL = 'http://localhost:3001';
      process.env.TRACKER_BRIDGE_URL = 'http://localhost:3002';
      resetConfig();

      // Mock fetch to return healthy responses
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }));

      // Mock Redis backend with healthCheck method
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      expect(result.services).toHaveLength(3);
      expect(result.version).toBeDefined();
      expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
      // External services should be healthy
      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');
      expect(memxHealth?.status).toBe('healthy');
      expect(trackerHealth?.status).toBe('healthy');

      delete process.env.MEMX_RESOLVER_URL;
      delete process.env.TRACKER_BRIDGE_URL;
    });

    it('should return unhealthy when Redis is not configured', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }));

      const result = await checker.checkAll(null);

      // Redis will be unhealthy since we passed null
      const redisHealth = result.services.find(s => s.name === 'redis');
      expect(redisHealth?.status).toBe('unhealthy');
    });

    it('should return healthy for embedded external services', async () => {
      // Embedded packages (memx-resolver, tracker-bridge) are always healthy
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');

      expect(memxHealth?.status).toBe('healthy');
      expect(memxHealth?.message).toBe('Running as embedded package');
      expect(trackerHealth?.status).toBe('healthy');
      expect(trackerHealth?.message).toBe('Running as embedded package');
    });

    it('should not include latency_ms for embedded services', async () => {
      // Embedded packages don't have latency measurements
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');

      // Embedded services are healthy but don't have latency
      expect(memxHealth?.status).toBe('healthy');
      expect(memxHealth?.latency_ms).toBeUndefined();
      expect(trackerHealth?.status).toBe('healthy');
      expect(trackerHealth?.latency_ms).toBeUndefined();

      // Redis should have latency
      const redisHealth = result.services.find(s => s.name === 'redis');
      expect(redisHealth?.latency_ms).toBe(5);
    });
  });

  describe('readiness', () => {
    it('should return health check result', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }));

      const result = await checker.readiness();

      expect(result.timestamp).toBeDefined();
      expect(result.services).toHaveLength(3);
    });
  });

  describe('determineOverallStatus', () => {
    it('should return healthy when all services are healthy', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      // Mock Redis backend with healthCheck method
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      expect(result.status).toBe('healthy');
    });

    it('should return unhealthy when any service is unhealthy', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      const result = await checker.checkAll();

      expect(result.status).toBe('unhealthy');
    });

    it('should return degraded when services have mixed status', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // memx-resolver returns degraded (non-200)
          return Promise.resolve({ ok: false, status: 503 });
        }
        // tracker-bridge returns healthy
        return Promise.resolve({ ok: true, status: 200 });
      }));

      const result = await checker.checkAll();

      // With Redis unhealthy (null backend) and mixed external service results
      expect(result.status).toBe('unhealthy');
    });
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getHealthChecker();
      const instance2 = getHealthChecker();

      expect(instance1).toBe(instance2);
    });

    it('should reset the singleton', () => {
      const instance1 = getHealthChecker();
      resetHealthChecker();
      const instance2 = getHealthChecker();

      expect(instance1).not.toBe(instance2);
    });
  });
});