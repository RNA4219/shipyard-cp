import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';

import { registerRoutes } from './routes/task-routes.js';
import { registerWebSocketRoutes } from './routes/ws-routes.js';
import { registerAgentRoutes } from './routes/agent-routes.js';
import { monitoringPlugin } from './monitoring/plugins/monitoring-plugin.js';
import { createAuthHook, type AuthConfig } from './auth/index.js';
import type { ControlPlaneStore } from './store/control-plane-store.js';

export interface BuildAppOptions {
  logger?: boolean;
  monitoring?: {
    enabled: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    metricsEnabled?: boolean;
    metricsPath?: string;
  };
  auth?: {
    enabled?: boolean;
    apiKey?: string;
    adminApiKey?: string;
    publicPaths?: string[];
  };
  rateLimit?: {
    enabled?: boolean;
    max?: number;
    timeWindow?: string | number;
    allowList?: string[];
  };
  cors?: {
    enabled?: boolean;
    origin?: string | string[] | boolean;
    methods?: string[];
    allowedHeaders?: string[];
    credentials?: boolean;
  };
}

/**
 * Default rate limit configuration
 * - 100 requests per minute per IP for API endpoints
 * - Health and metrics endpoints are exempt
 */
const DEFAULT_RATE_LIMIT_CONFIG = {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['/healthz', '/health', '/health/ready', '/metrics', '/openapi.yaml', '/schemas'],
  errorResponseBuilder: () => ({
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please slow down.',
  }),
};

/**
 * Default CORS configuration
 * - In development: allows all origins (localhost, etc.)
 * - In production: must be configured with allowed origins via CORS_ORIGIN env var
 */
const DEFAULT_CORS_CONFIG = {
  // In development, allow all origins; in production, require explicit configuration
  origin: process.env.NODE_ENV === 'production' ? false : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
  credentials: true,
};

export async function buildApp(options?: BuildAppOptions): Promise<FastifyInstance & { store: ControlPlaneStore }> {
  const app = Fastify({ logger: options?.logger ?? true });
  const authEnabled = options?.auth?.enabled ?? false;
  const rateLimitEnabled = options?.rateLimit?.enabled ?? true;
  const corsEnabled = options?.cors?.enabled ?? true;

  // Register WebSocket plugin
  await app.register(websocket);

  // Register CORS plugin
  // Security: In production, CORS_ORIGIN must be explicitly set to allowed domains
  if (corsEnabled) {
    const corsOrigin = options?.cors?.origin ?? process.env.CORS_ORIGIN ?? DEFAULT_CORS_CONFIG.origin;
    await app.register(cors, {
      origin: corsOrigin,
      methods: options?.cors?.methods ?? DEFAULT_CORS_CONFIG.methods,
      allowedHeaders: options?.cors?.allowedHeaders ?? DEFAULT_CORS_CONFIG.allowedHeaders,
      credentials: options?.cors?.credentials ?? DEFAULT_CORS_CONFIG.credentials,
    });
  }

  // Register rate limiting plugin
  if (rateLimitEnabled) {
    await app.register(rateLimit, {
      max: options?.rateLimit?.max ?? DEFAULT_RATE_LIMIT_CONFIG.max,
      timeWindow: options?.rateLimit?.timeWindow ?? DEFAULT_RATE_LIMIT_CONFIG.timeWindow,
      allowList: options?.rateLimit?.allowList ?? DEFAULT_RATE_LIMIT_CONFIG.allowList,
      errorResponseBuilder: DEFAULT_RATE_LIMIT_CONFIG.errorResponseBuilder,
    });
  }

  // Register monitoring plugin
  await app.register(monitoringPlugin, {
    config: {
      enabled: options?.monitoring?.enabled ?? true,
      logLevel: options?.monitoring?.logLevel ?? 'info',
      metricsEnabled: options?.monitoring?.metricsEnabled ?? true,
      metricsPath: options?.monitoring?.metricsPath ?? '/metrics',
    },
    endpoint: options?.monitoring?.metricsPath ?? '/metrics',
    enableRequestMetrics: true,
  });

  // Register authentication hook directly (not via plugin to avoid encapsulation)
  const authConfig: AuthConfig = {
    enabled: authEnabled,
    apiKey: options?.auth?.apiKey,
    adminApiKey: options?.auth?.adminApiKey,
    publicPaths: options?.auth?.publicPaths,
  };
  const authHook = createAuthHook(authConfig);
  app.addHook('onRequest', authHook);

  const store = await registerRoutes(app, authEnabled);

  // Register WebSocket routes for real-time updates
  await registerWebSocketRoutes(app, store);

  // Register agent routes for spawn control and metrics
  await registerAgentRoutes(app, authEnabled);

  return Object.assign(app, { store }) as FastifyInstance & { store: ControlPlaneStore };
}

// Export for testing
export { ControlPlaneStore } from './store/control-plane-store.js';
