import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

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
}

export async function buildApp(options?: BuildAppOptions): Promise<FastifyInstance & { store: ControlPlaneStore }> {
  const app = Fastify({ logger: options?.logger ?? true });

  // Register WebSocket plugin
  await app.register(websocket);

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
    enabled: options?.auth?.enabled ?? false,
    apiKey: options?.auth?.apiKey,
    adminApiKey: options?.auth?.adminApiKey,
    publicPaths: options?.auth?.publicPaths,
  };
  const authHook = createAuthHook(authConfig);
  app.addHook('onRequest', authHook);

  const store = await registerRoutes(app);

  // Register WebSocket routes for real-time updates
  await registerWebSocketRoutes(app, store);

  // Register agent routes for spawn control and metrics
  await registerAgentRoutes(app);

  return Object.assign(app, { store }) as FastifyInstance & { store: ControlPlaneStore };
}

// Export for testing
export { ControlPlaneStore } from './store/control-plane-store.js';