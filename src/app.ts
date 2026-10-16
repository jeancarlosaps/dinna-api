import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './modules/health/health.routes.js';
import { registerErrorHandling } from './shared/http/error-handler.js';

/**
 * Monta a aplicação sem abrir porta, para ser usada pelo server e pelos testes (app.inject).
 * Novos módulos (products, orders, recommendations) entram aqui via app.register.
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  registerErrorHandling(app);
  app.register(healthRoutes);

  return app;
}
