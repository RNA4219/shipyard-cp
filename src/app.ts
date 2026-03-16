import Fastify from 'fastify';

import { registerRoutes } from './routes/task-routes.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await registerRoutes(app);
  return app;
}
