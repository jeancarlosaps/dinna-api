import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { openDatabase, type Db } from './db/client.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { ordersRoutes } from './modules/orders/orders.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import {
  createGeminiProvider,
  type GeminiDiagnostic,
  type RecommendationProvider,
} from './modules/recommendations/provider.js';
import { recommendationsRoutes } from './modules/recommendations/recommendations.routes.js';
import { registerApiTokenProtection } from './shared/http/api-token.js';
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
  /** Log local do estágio da chamada. Desligado por padrão. */
  diagnostics?: boolean;
}

export interface BuildAppOptions extends FastifyServerOptions {
  /** Caminho SQLite. Padrão `:memory:` (ideal para testes). */
  databasePath?: string;
  /** Popula seed se a tabela estiver vazia. Padrão `true`. */
  seed?: boolean;
  recommendation?: RecommendationOptions;
  /**
   * Token exigido em `X-Dinna-Api-Token` por todas as rotas, menos `GET /health`.
   * Ausente, a API fica aberta (execução local e testes). Validação em `loadEnv`.
   */
  apiToken?: string;
}

/**
 * Monta a aplicação sem abrir porta, para ser usada pelo server e pelos testes (app.inject).
 * Novos módulos (recommendations) entram aqui via app.register.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const {
    databasePath = ':memory:',
    seed = true,
    recommendation,
    apiToken,
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);
  const db: Db = openDatabase({ path: databasePath, seed });

  registerErrorHandling(app);
  if (apiToken !== undefined) {
    registerApiTokenProtection(app, apiToken);
  }
  app.register(healthRoutes);
  app.register(productsRoutes(db));
  app.register(ordersRoutes(db));
  app.register(
    recommendationsRoutes(db, resolveRecommendationProvider(app, recommendation), {
      diagnostics: recommendation?.diagnostics === true,
    }),
  );

  app.addHook('onClose', () => {
    db.close();
  });

  return app;
}

function resolveRecommendationProvider(
  app: FastifyInstance,
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

  const diagnostics = recommendation.diagnostics === true;
  return createGeminiProvider({
    apiKey,
    timeoutMs: recommendation.timeoutMs,
    fetchImpl: recommendation.fetchImpl,
    diagnostics,
    onDiagnostic: diagnostics
      ? (event: GeminiDiagnostic) => {
          app.log.warn({ gemini: event }, 'Diagnóstico do provedor de recomendação');
        }
      : undefined,
  });
}
