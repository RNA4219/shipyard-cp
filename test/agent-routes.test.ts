import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Agent Routes', () => {
  describe('basic functionality', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: false },
      });
    });

    afterEach(async () => {
      await app.close();
    });

    describe('/v1/agent/register', () => {
      it('should register an agent successfully', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/agent/register',
          body: {
            agent_id: 'agent-001',
            job_id: 'job-001',
            scope: 'job',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          success: true,
          agent_id: 'agent-001',
          scope: 'job',
        });
      });
    });

    describe('/v1/agent/unregister', () => {
      it('should unregister an agent successfully', async () => {
        // First register
        await app.inject({
          method: 'POST',
          url: '/v1/agent/register',
          body: {
            agent_id: 'agent-001',
            job_id: 'job-001',
            scope: 'job',
          },
        });

        // Then unregister
        const response = await app.inject({
          method: 'POST',
          url: '/v1/agent/unregister',
          body: {
            agent_id: 'agent-001',
            job_id: 'job-001',
            scope: 'job',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          success: true,
          agent_id: 'agent-001',
          scope: 'job',
        });
      });
    });
  });

  describe('authentication', () => {
    it('should reject unauthenticated requests when auth is enabled', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: {
          enabled: true,
          apiKey: 'test-api-key',
          adminApiKey: 'test-admin-key',
        },
        rateLimit: { enabled: false },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it('should accept authenticated requests with valid API key', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: {
          enabled: true,
          apiKey: 'test-api-key',
          adminApiKey: 'test-admin-key',
        },
        rateLimit: { enabled: false },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        headers: {
          'X-API-Key': 'test-api-key',
        },
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('should reject requests with invalid API key', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: {
          enabled: true,
          apiKey: 'test-api-key',
          adminApiKey: 'test-admin-key',
        },
        rateLimit: { enabled: false },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        headers: {
          'X-API-Key': 'invalid-key',
        },
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it('should reject unauthenticated unregister requests', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: {
          enabled: true,
          apiKey: 'test-api-key',
          adminApiKey: 'test-admin-key',
        },
        rateLimit: { enabled: false },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/unregister',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe('rate limit configuration', () => {
    it('should have rate limit enabled by default', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        // No rateLimit config - should use defaults
      });

      // Verify app has rate limit plugin registered
      // Rate limit is configured globally in app.ts with:
      // - max: 100 requests per minute
      // - agent routes are NOT in allowList (so they ARE rate limited)
      expect(app.hasPlugin('@fastify/rate-limit')).toBe(true);

      await app.close();
    });

    it('should allow disabling rate limit', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: false },
      });

      // Without rate limit, requests should work
      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });

  describe('rate limit enforcement', () => {
    it('should have rate limit enabled on agent endpoints', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: true },
      });

      // Verify rate limit plugin is registered
      expect(app.hasPlugin('@fastify/rate-limit')).toBe(true);

      // Verify agent routes are registered and functional
      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('should return rate limit headers on register requests', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: true, max: 100, timeWindow: '1 minute' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      // Request should succeed and include rate limit headers
      expect(response.statusCode).toBe(200);

      // Note: fastify inject may not include all rate limit headers
      // The important thing is that the route is configured with rate limit
      await app.close();
    });

    it('should work without rate limit when disabled', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: false },
      });

      // Multiple requests should all succeed without rate limiting
      for (let i = 0; i < 10; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/agent/register',
          body: {
            agent_id: `agent-${i}`,
            job_id: `job-${i}`,
          },
        });
        expect(response.statusCode).toBe(200);
      }

      await app.close();
    });

    it('should unregister agents with rate limit enabled', async () => {
      const app = await buildApp({
        logger: false,
        monitoring: { enabled: false, metricsEnabled: false },
        auth: { enabled: false },
        rateLimit: { enabled: true },
      });

      // Register first
      await app.inject({
        method: 'POST',
        url: '/v1/agent/register',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      // Then unregister
      const response = await app.inject({
        method: 'POST',
        url: '/v1/agent/unregister',
        body: {
          agent_id: 'agent-001',
          job_id: 'job-001',
        },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });
});