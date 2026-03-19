import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ServiceHealthChecker,
  getHealthChecker,
  resetHealthChecker,
} from '../src/health/service-health-checker.js';

// Mock fetch for external service tests
const originalFetch = global.fetch;

describe('ServiceHealthChecker', () => {
  let checker: ServiceHealthChecker;

  beforeEach(() => {
    resetHealthChecker();
    checker = new ServiceHealthChecker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  describe('liveness', () => {
    it('should return ok status', () => {
      const result = checker.liveness();
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('checkAll', () => {
    it('should return overall healthy when all services are healthy', async () => {
      // Mock fetch to return healthy responses
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      // Mock Redis backend
      const mockRedisBackend = {
        get: vi.fn().mockResolvedValue('ping'),
        set: vi.fn().mockResolvedValue(undefined),
      };

      const result = await checker.checkAll(mockRedisBackend as any);

      expect(result.services).toHaveLength(3);
      expect(result.version).toBeDefined();
      expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
      // External services should be healthy
      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');
      expect(memxHealth?.status).toBe('healthy');
      expect(trackerHealth?.status).toBe('healthy');
    });

    it('should return unhealthy when Redis is not configured', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checker.checkAll(null);

      // Redis will be unhealthy since we passed null
      const redisHealth = result.services.find(s => s.name === 'redis');
      expect(redisHealth?.status).toBe('unhealthy');
    });

    it('should return degraded when external services timeout', async () => {
      // Mock fetch to abort (timeout)
      global.fetch = vi.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      const result = await checker.checkAll();

      // External services will be degraded due to timeout
      const memxHealth = result.services.find(s => s.name === 'memx-resolver');
      const trackerHealth = result.services.find(s => s.name === 'tracker-bridge');

      expect(memxHealth?.status).toBe('degraded');
      expect(trackerHealth?.status).toBe('degraded');
    });

    it('should include latency_ms for each service', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checker.checkAll();

      for (const service of result.services) {
        if (service.status === 'healthy') {
          expect(service.latency_ms).toBeDefined();
          expect(service.latency_ms).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('readiness', () => {
    it('should return health check result', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checker.readiness();

      expect(result.timestamp).toBeDefined();
      expect(result.services).toHaveLength(3);
    });
  });

  describe('determineOverallStatus', () => {
    it('should return healthy when all services are healthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      // Mock Redis backend
      const mockRedisBackend = {
        get: vi.fn().mockResolvedValue('ping'),
        set: vi.fn().mockResolvedValue(undefined),
      };

      const result = await checker.checkAll(mockRedisBackend as any);

      expect(result.status).toBe('healthy');
    });

    it('should return unhealthy when any service is unhealthy', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await checker.checkAll();

      expect(result.status).toBe('unhealthy');
    });

    it('should return degraded when services have mixed status', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // memx-resolver returns degraded (non-200)
          return Promise.resolve({ ok: false, status: 503 });
        }
        // tracker-bridge returns healthy
        return Promise.resolve({ ok: true, status: 200 });
      });

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