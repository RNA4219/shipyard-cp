import Fastify, { type FastifyInstance } from 'fastify';

import { registerRoutes } from './routes/task-routes.js';
import { monitoringPlugin } from './monitoring/plugins/monitoring-plugin.js';
import type { ControlPlaneStore } from './store/control-plane-store.js';

export interface BuildAppOptions {
  logger?: boolean;
  monitoring?: {
    enabled: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    metricsEnabled?: boolean;
    metricsPath?: string;
  };
}

export async function buildApp(options?: BuildAppOptions): Promise<FastifyInstance & { store: ControlPlaneStore }> {
  const app = Fastify({ logger: options?.logger ?? true });

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

  const store = await registerRoutes(app);
  return Object.assign(app, { store }) as FastifyInstance & { store: ControlPlaneStore };
}

// Export for testing
export { ControlPlaneStore } from './store/control-plane-store.js';