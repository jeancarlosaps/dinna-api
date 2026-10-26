import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { openDatabase, type Db } from './db/client.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { ordersRoutes } from './modules/orders/orders.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import { registerErrorHandling } from './shared/http/error-handler.js';

export interface BuildAppOptions extends FastifyServerOptions {
  /** Caminho SQLite. Padrão `:memory:` (ideal para testes). */
  databasePath?: string;
  /** Popula seed se a tabela estiver vazia. Padrão `true`. */
  seed?: boolean;
}

/**
 * Monta a aplicação sem abrir porta, para ser usada pelo server e pelos testes (app.inject).
 * Novos módulos (recommendations) entram aqui via app.register.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { databasePath = ':memory:', seed = true, ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);
  const db: Db = openDatabase({ path: databasePath, seed });

  registerErrorHandling(app);
  app.register(healthRoutes);
  app.register(productsRoutes(db));
  app.register(ordersRoutes(db));

  app.addHook('onClose', () => {
    db.close();
  });

  return app;
}
