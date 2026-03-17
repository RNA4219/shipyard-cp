import Fastify from 'fastify';

import { registerRoutes } from './routes/task-routes.js';

export async function buildApp(options?: { logger?: boolean }) {
  const app = Fastify({ logger: options?.logger ?? true });
  await registerRoutes(app);
  return app;
}
