import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { openDatabase, type Db } from './db/client.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { ordersRoutes } from './modules/orders/orders.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import {
  createGeminiProvider,
  type RecommendationProvider,
} from './modules/recommendations/provider.js';
import { recommendationsRoutes } from './modules/recommendations/recommendations.routes.js';
import { registerErrorHandling } from './shared/http/error-handler.js';

export interface RecommendationOptions {
  /** Fake dos testes. Quando presente, a chave e o fetch não são usados. */
  provider?: RecommendationProvider;
  /** Chave da API Gemini. Ausente ou em branco usa o fallback, sem chamada. */
  apiKey?: string;
  /** Milissegundos. A validação 1000–15000 fica em `loadEnv`. */
  timeoutMs?: number;
  /** Substitui o `fetch` global. Testes não abrem rede. */
  fetchImpl?: typeof fetch;
}

export interface BuildAppOptions extends FastifyServerOptions {
  /** Caminho SQLite. Padrão `:memory:` (ideal para testes). */
  databasePath?: string;
  /** Popula seed se a tabela estiver vazia. Padrão `true`. */
  seed?: boolean;
  recommendation?: RecommendationOptions;
}

/**
 * Monta a aplicação sem abrir porta, para ser usada pelo server e pelos testes (app.inject).
 * Novos módulos (recommendations) entram aqui via app.register.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { databasePath = ':memory:', seed = true, recommendation, ...fastifyOptions } = options;
  const app = Fastify(fastifyOptions);
  const db: Db = openDatabase({ path: databasePath, seed });

  registerErrorHandling(app);
  app.register(healthRoutes);
  app.register(productsRoutes(db));
  app.register(ordersRoutes(db));
  app.register(recommendationsRoutes(db, resolveRecommendationProvider(recommendation)));

  app.addHook('onClose', () => {
    db.close();
  });

  return app;
}

function resolveRecommendationProvider(
  recommendation: RecommendationOptions | undefined,
): RecommendationProvider | undefined {
  if (!recommendation) {
    return undefined;
  }
  if (recommendation.provider) {
    return recommendation.provider;
  }

  const apiKey = recommendation.apiKey?.trim();
  if (!apiKey) {
    return undefined;
  }

  return createGeminiProvider({
    apiKey,
    timeoutMs: recommendation.timeoutMs,
    fetchImpl: recommendation.fetchImpl,
  });
}
