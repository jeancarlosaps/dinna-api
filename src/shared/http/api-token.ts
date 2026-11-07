import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';

/** Header que carrega o token compartilhado. Node entrega o nome em minúsculas. */
export const API_TOKEN_HEADER = 'x-dinna-api-token';

/**
 * Rotas liberadas sem token, pelo padrão registrado no Fastify (não pela URL bruta).
 * Toda rota fora desta lista, inclusive rotas novas e 404, exige o token.
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/health']);

/**
 * Exige `X-Dinna-Api-Token` em todas as rotas, menos as públicas.
 *
 * Precisa ser registrado na instância raiz antes das rotas. Roda em `onRequest`,
 * então requisições sem token são recusadas antes de o body ser lido.
 */
export function registerApiTokenProtection(app: FastifyInstance, token: string): void {
  if (token.trim() === '') {
    throw new Error('Proteção por token habilitada sem token');
  }
  const expected = digest(token);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const routeUrl = request.routeOptions.url;
    if (routeUrl !== undefined && PUBLIC_ROUTES.has(routeUrl)) {
      return;
    }

    const received = request.headers[API_TOKEN_HEADER];
    if (typeof received !== 'string' || !timingSafeEqual(digest(received), expected)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente ou inválido');
    }
  });
}

/** Hash de tamanho fixo: `timingSafeEqual` exige buffers do mesmo tamanho. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
