/**
 * External Services Health Check
 *
 * Provides health check functionality for external services
 * (memx-resolver, tracker-bridge, Redis).
 */

import { getConfig } from '../config/index.js';
import { getLogger } from '../monitoring/index.js';
import type { RedisBackend } from '../store/redis-backend.js';

/**
 * Health status for a single service
 */
export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency_ms?: number;
  error?: string;
  last_check: string;
  details?: Record<string, unknown>;
}

/**
 * Overall health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime_seconds: number;
  services: ServiceHealth[];
}

/**
 * Service checker function type
 */
type ServiceChecker = () => Promise<ServiceHealth>;

/**
 * Health checker for external services
 */
export class ServiceHealthChecker {
  private readonly startTime = Date.now();
  private readonly logger = getLogger().child({ component: 'ServiceHealthChecker' });

  /**
   * Run all health checks.
   */
  async checkAll(redisBackend?: RedisBackend | null): Promise<HealthCheckResult> {
    const services = await Promise.all([
      this.checkRedis(redisBackend),
      this.checkMemxResolver(),
      this.checkTrackerBridge(),
    ]);

    // Determine overall status
    const status = this.determineOverallStatus(services);

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      services,
    };
  }

  /**
   * Quick liveness check - just returns ok.
   */
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness check - checks if service can accept requests.
   */
  async readiness(redisBackend?: RedisBackend | null): Promise<HealthCheckResult> {
    return this.checkAll(redisBackend);
  }

  // --- Individual service checks ---

  /**
   * Check Redis connectivity.
   */
  private async checkRedis(redisBackend?: RedisBackend | null): Promise<ServiceHealth> {
    const name = 'redis';
    const start = Date.now();

    try {
      if (!redisBackend) {
        return {
          name,
          status: 'unhealthy',
          error: 'Redis backend not configured',
          last_check: new Date().toISOString(),
        };
      }

      // Use the healthCheck method
      const result = await redisBackend.healthCheck();

      if (!result.healthy) {
        throw new Error(result.error || 'Redis health check failed');
      }

      return {
        name,
        status: 'healthy',
        latency_ms: result.latencyMs ?? Date.now() - start,
        last_check: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Redis health check failed', { name, error: errorMsg });

      return {
        name,
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: errorMsg,
        last_check: new Date().toISOString(),
      };
    }
  }

  /**
   * Check memx-resolver connectivity.
   */
  private async checkMemxResolver(): Promise<ServiceHealth> {
    const name = 'memx-resolver';
    const config = getConfig();
    const url = config.externalServices.memxResolverUrl;

    return this.checkHttpService(name, url, '/health');
  }

  /**
   * Check tracker-bridge connectivity.
   */
  private async checkTrackerBridge(): Promise<ServiceHealth> {
    const name = 'tracker-bridge';
    const config = getConfig();
    const url = config.externalServices.trackerBridgeUrl;

    return this.checkHttpService(name, url, '/health');
  }

  /**
   * Generic HTTP service health check.
   */
  private async checkHttpService(
    name: string,
    baseUrl: string,
    healthPath: string,
  ): Promise<ServiceHealth> {
    const start = Date.now();

    try {
      const url = `${baseUrl.replace(/\/$/, '')}${healthPath}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (response.ok) {
        return {
          name,
          status: 'healthy',
          latency_ms: latency,
          last_check: new Date().toISOString(),
          details: {
            url: baseUrl,
            http_status: response.status,
          },
        };
      }

      return {
        name,
        status: 'degraded',
        latency_ms: latency,
        error: `HTTP ${response.status}`,
        last_check: new Date().toISOString(),
        details: {
          url: baseUrl,
          http_status: response.status,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const latency = Date.now() - start;

      // Check if it's a timeout or connection error
      const isTimeout = errorMsg.includes('abort') || errorMsg.includes('timeout');

      this.logger.warn({ name, error: errorMsg, latency_ms: latency }, `${name} health check failed`);

      return {
        name,
        status: isTimeout ? 'degraded' : 'unhealthy',
        latency_ms: latency,
        error: errorMsg,
        last_check: new Date().toISOString(),
        details: {
          url: baseUrl,
        },
      };
    }
  }

  /**
   * Determine overall status from individual service statuses.
   */
  private determineOverallStatus(services: ServiceHealth[]): 'healthy' | 'unhealthy' | 'degraded' {
    const statuses = services.map(s => s.status);

    if (statuses.every(s => s === 'healthy')) {
      return 'healthy';
    }

    if (statuses.some(s => s === 'unhealthy')) {
      return 'unhealthy';
    }

    return 'degraded';
  }
}

// Singleton instance
let _healthChecker: ServiceHealthChecker | null = null;

/**
 * Get the health checker instance.
 */
export function getHealthChecker(): ServiceHealthChecker {
  if (!_healthChecker) {
    _healthChecker = new ServiceHealthChecker();
  }
  return _healthChecker;
}

/**
 * Reset the health checker (for testing).
 */
export function resetHealthChecker(): void {
  _healthChecker = null;
}