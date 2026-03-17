import Fastify from 'fastify';

import { registerRoutes } from './routes/task-routes.js';
import type { ControlPlaneStore } from './store/control-plane-store.js';

export async function buildApp(options?: { logger?: boolean }): Promise<FastifyInstance & { store: ControlPlaneStore }> {
  const app = Fastify({ logger: options?.logger ?? true });
  const store = await registerRoutes(app);
  return Object.assign(app, { store });
}

// Export for testing
export { ControlPlaneStore } from './store/control-plane-store.js';
