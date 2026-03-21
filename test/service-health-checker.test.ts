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

    it('should return degraded when external services timeout', async () => {
      // Set URLs so fetch is called
      process.env.MEMX_RESOLVER_URL = 'http://localhost:3001';
      process.env.TRACKER_BRIDGE_URL = 'http://localhost:3002';
      resetConfig();

      // Mock fetch to abort (timeout)
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }));

      // Mock Redis backend with healthy status
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      // External services will be degraded due to timeout
      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');

      expect(memxHealth?.status).toBe('degraded');
      expect(trackerHealth?.status).toBe('degraded');

      delete process.env.MEMX_RESOLVER_URL;
      delete process.env.TRACKER_BRIDGE_URL;
    });

    it('should include latency_ms for each service', async () => {
      // Set URLs so fetch is called
      process.env.MEMX_RESOLVER_URL = 'http://localhost:3001';
      process.env.TRACKER_BRIDGE_URL = 'http://localhost:3002';
      resetConfig();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }));

      // Mock Redis backend with latency
      const mockRedisBackend = {
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      };

      const result = await checker.checkAll(mockRedisBackend as RedisBackend);

      for (const service of result.services) {
        if (service.status === 'healthy') {
          expect(service.latency_ms).toBeDefined();
          expect(service.latency_ms).toBeGreaterThanOrEqual(0);
        }
      }

      delete process.env.MEMX_RESOLVER_URL;
      delete process.env.TRACKER_BRIDGE_URL;
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