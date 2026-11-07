import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

// Valor fictício, só para os testes.
const TOKEN = 'token-de-teste-0123456789abcdefghijklmnop';
const HEADER = 'x-dinna-api-token';

const UNAUTHORIZED = {
  error: { code: 'UNAUTHORIZED', message: 'Token de acesso ausente ou inválido' },
};

const PRODUCT = {
  name: 'Milkshake',
  description: 'Baunilha',
  category: 'bebidas',
  priceCents: 1890,
};
const ORDER = { table: '12', items: [{ productId: 'p1', quantity: 1 }] };
const RECOMMENDATION = {
  preferences: {
    budget: 'from_36_to_60',
    hunger: 'normal',
    protein: 'beef',
    style: 'balanced',
    taste: 'savory',
  },
};

/** Todas as rotas de negócio. `o_teste` não existe: com token a resposta é 404 da regra, não 401. */
const PROTECTED_ROUTES: InjectOptions[] = [
  { method: 'GET', url: '/products' },
  { method: 'GET', url: '/products/p1' },
  { method: 'POST', url: '/products', payload: PRODUCT },
  { method: 'PUT', url: '/products/p1', payload: PRODUCT },
  { method: 'DELETE', url: '/products/p1' },
  { method: 'GET', url: '/orders' },
  { method: 'GET', url: '/orders/o_teste' },
  { method: 'POST', url: '/orders', payload: ORDER },
  { method: 'PATCH', url: '/orders/o_teste/status', payload: { status: 'preparing' } },
  { method: 'POST', url: '/ai/recommendation', payload: RECOMMENDATION },
];

function routeName(route: InjectOptions): string {
  return `${route.method} ${route.url}`;
}

describe('proteção por token', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    const openedApp = app;
    app = undefined;
    await openedApp?.close();
  });

  function protectedApp(options: BuildAppOptions = {}): FastifyInstance {
    app = buildApp({ apiToken: TOKEN, ...options });
    return app;
  }

  function withToken(route: InjectOptions, token: string = TOKEN): InjectOptions {
    return { ...route, headers: { ...route.headers, [HEADER]: token } };
  }

  describe('configuração', () => {
    it('sem variáveis, a proteção fica desligada (execução local)', () => {
      expect(loadEnv({}).apiToken).toBeUndefined();
      expect(loadEnv({ DINNA_REQUIRE_API_TOKEN: 'false' }).apiToken).toBeUndefined();
      expect(loadEnv({ DINNA_REQUIRE_API_TOKEN: ' 0 ' }).apiToken).toBeUndefined();
    });

    it('com proteção ligada e token válido, devolve o token', () => {
      expect(
        loadEnv({ DINNA_REQUIRE_API_TOKEN: 'true', DINNA_API_TOKEN: `  ${TOKEN}  ` }).apiToken,
      ).toBe(TOKEN);
      expect(loadEnv({ DINNA_REQUIRE_API_TOKEN: ' 1 ', DINNA_API_TOKEN: TOKEN }).apiToken).toBe(
        TOKEN,
      );
    });

    it('impede a subida com proteção ligada e token ausente ou em branco', () => {
      expect(() => loadEnv({ DINNA_REQUIRE_API_TOKEN: 'true' })).toThrow(/DINNA_API_TOKEN/);
      expect(() => loadEnv({ DINNA_REQUIRE_API_TOKEN: 'true', DINNA_API_TOKEN: '   ' })).toThrow(
        /DINNA_API_TOKEN/,
      );
    });

    it('impede a subida com token curto ou com espaço, sem ecoar o valor', () => {
      const short = 'curto-demais';
      const spaced = 'token com espaco 0123456789abcdefghij';
      for (const token of [short, spaced]) {
        let message = '';
        try {
          loadEnv({ DINNA_REQUIRE_API_TOKEN: 'true', DINNA_API_TOKEN: token });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toMatch(/DINNA_API_TOKEN inválido/);
        expect(message).not.toContain(token);
      }
    });

    it('impede a subida com token definido e proteção desligada', () => {
      let message = '';
      try {
        loadEnv({ DINNA_API_TOKEN: TOKEN });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/DINNA_REQUIRE_API_TOKEN=true/);
      expect(message).not.toContain(TOKEN);
      expect(() => loadEnv({ DINNA_REQUIRE_API_TOKEN: 'false', DINNA_API_TOKEN: TOKEN })).toThrow(
        /DINNA_REQUIRE_API_TOKEN=true/,
      );
    });

    it('rejeita valor desconhecido para a obrigatoriedade, sem ecoar o valor', () => {
      expect(() => loadEnv({ DINNA_REQUIRE_API_TOKEN: 'yes', DINNA_API_TOKEN: TOKEN })).toThrow(
        /DINNA_REQUIRE_API_TOKEN inválido/,
      );
      expect(() => loadEnv({ DINNA_REQUIRE_API_TOKEN: TOKEN })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(TOKEN) as string }),
      );
    });

    it('sobe protegida com token válido', async () => {
      const env = loadEnv({ DINNA_REQUIRE_API_TOKEN: 'true', DINNA_API_TOKEN: TOKEN });
      const current = protectedApp({ apiToken: env.apiToken });

      await expect(current.ready()).resolves.toBe(current);
    });

    it('buildApp recusa token em branco em vez de abrir a API', () => {
      expect(() => buildApp({ apiToken: '   ' })).toThrow(/sem token/);
    });
  });

  describe('sem proteção', () => {
    it.each(PROTECTED_ROUTES)('$method $url responde sem token', async (route) => {
      app = buildApp();

      const response = await app.inject(route);

      expect(response.statusCode).not.toBe(401);
    });
  });

  describe('com proteção', () => {
    it('GET /health responde sem token', async () => {
      const current = protectedApp();

      const response = await current.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });

      const head = await current.inject({ method: 'HEAD', url: '/health' });
      expect(head.statusCode).toBe(200);
    });

    it.each(PROTECTED_ROUTES.map((route) => [routeName(route), route] as const))(
      '%s sem token responde 401',
      async (_name, route) => {
        const response = await protectedApp().inject(route);

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual(UNAUTHORIZED);
      },
    );

    it.each(PROTECTED_ROUTES.map((route) => [routeName(route), route] as const))(
      '%s com token incorreto responde 401',
      async (_name, route) => {
        const current = protectedApp();

        for (const token of ['errado', `${TOKEN}x`, TOKEN.toUpperCase(), '']) {
          const response = await current.inject(withToken(route, token));
          expect(response.statusCode).toBe(401);
          expect(response.json()).toEqual(UNAUTHORIZED);
        }
      },
    );

    it('rota inexistente sem token responde 401, sem revelar que não existe', async () => {
      const current = protectedApp();

      const anonymous = await current.inject({ method: 'GET', url: '/admin' });
      expect(anonymous.statusCode).toBe(401);

      const authenticated = await current.inject(withToken({ method: 'GET', url: '/admin' }));
      expect(authenticated.statusCode).toBe(404);
    });

    it('a liberação do health não vale para outra rota com /health na URL', async () => {
      const current = protectedApp();

      for (const url of ['/orders?/health', '/orders?x=/health', '/health/../orders']) {
        const response = await current.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(401);
      }
    });

    it('recusa sem token antes de ler o body, mesmo malformado ou acima do limite', async () => {
      const current = protectedApp();
      const json = { 'content-type': 'application/json' };
      const oversized = JSON.stringify({ table: 'x'.repeat(1024 * 1024 + 1), items: [] });

      for (const url of ['/orders', '/products', '/ai/recommendation']) {
        const malformed = await current.inject({
          method: 'POST',
          url,
          headers: json,
          payload: '{',
        });
        expect(malformed.statusCode).toBe(401);
        expect(malformed.json()).toEqual(UNAUTHORIZED);

        const large = await current.inject({
          method: 'POST',
          url,
          headers: json,
          payload: oversized,
        });
        expect(large.statusCode).toBe(401);
        expect(large.json()).toEqual(UNAUTHORIZED);
      }

      // Com token, os mesmos bodies chegam ao parser: confirma que o caso acima não é trivial.
      const withValidToken = await current.inject(
        withToken({ method: 'POST', url: '/orders', headers: json, payload: '{' }),
      );
      expect(withValidToken.statusCode).toBe(400);
      const tooLarge = await current.inject(
        withToken({ method: 'POST', url: '/orders', headers: json, payload: oversized }),
      );
      expect(tooLarge.statusCode).toBe(413);
    });

    it('escrita sem token não grava nada', async () => {
      const current = protectedApp();

      expect(
        (await current.inject({ method: 'POST', url: '/orders', payload: ORDER })).statusCode,
      ).toBe(401);
      expect(
        (await current.inject({ method: 'POST', url: '/products', payload: PRODUCT })).statusCode,
      ).toBe(401);

      const orders = await current.inject(withToken({ method: 'GET', url: '/orders' }));
      expect(orders.json()).toEqual([]);
      const products = await current.inject(withToken({ method: 'GET', url: '/products' }));
      expect((products.json() as { name: string }[]).map((p) => p.name)).not.toContain(
        PRODUCT.name,
      );
    });

    it('com token correto, produtos, pedidos e recomendação funcionam normalmente', async () => {
      const current = protectedApp();

      const products = await current.inject(withToken({ method: 'GET', url: '/products' }));
      expect(products.statusCode).toBe(200);

      const product = await current.inject(
        withToken({ method: 'POST', url: '/products', payload: PRODUCT }),
      );
      expect(product.statusCode).toBe(201);

      const order = await current.inject(
        withToken({ method: 'POST', url: '/orders', payload: ORDER }),
      );
      expect(order.statusCode).toBe(201);
      const orderId = (order.json() as { id: string }).id;

      const orders = await current.inject(withToken({ method: 'GET', url: '/orders' }));
      expect(orders.statusCode).toBe(200);
      expect(orders.json()).toHaveLength(1);

      const status = await current.inject(
        withToken({
          method: 'PATCH',
          url: `/orders/${orderId}/status`,
          payload: { status: 'preparing' },
        }),
      );
      expect(status.statusCode).toBe(200);

      const recommendation = await current.inject(
        withToken({ method: 'POST', url: '/ai/recommendation', payload: RECOMMENDATION }),
      );
      expect(recommendation.statusCode).toBe(200);
    });

    it('com token correto, erros de negócio mantêm o formato atual', async () => {
      const response = await protectedApp().inject(
        withToken({ method: 'GET', url: '/orders/o_teste' }),
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: expect.any(String) as string } });
    });

    it('não expõe o token em respostas nem em logs', async () => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          lines.push(String(chunk));
          callback();
        },
      });
      const current = protectedApp({ logger: { level: 'trace', stream } });

      const bodies: string[] = [];
      for (const route of PROTECTED_ROUTES) {
        bodies.push((await current.inject(withToken(route))).body);
        bodies.push((await current.inject(withToken(route, `${TOKEN}-errado`))).body);
      }

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join('\n')).not.toContain(TOKEN);
      expect(bodies.join('\n')).not.toContain(TOKEN);
    });
  });
});
