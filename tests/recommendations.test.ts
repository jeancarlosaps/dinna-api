import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { RecommendationProvider } from '../src/modules/recommendations/provider.js';

const EXAMPLE = {
  table: '12',
  preferences: {
    budget: 'from_36_to_60',
    hunger: 'normal',
    protein: 'beef',
    style: 'balanced',
    taste: 'savory',
    restrictions: ['no_onion'],
  },
  limit: 3,
};

const P2_REASON = 'Carne, R$ 36\u201360, Salgado, sem cebola na lista cadastrada';

function preferences(
  overrides: Record<string, unknown> = {},
  restrictions?: string[],
): Record<string, unknown> {
  return {
    table: '12',
    limit: 3,
    preferences: {
      budget: 'unlimited',
      hunger: 'little',
      protein: 'beef',
      style: 'balanced',
      taste: 'savory',
      ...(restrictions ? { restrictions } : {}),
      ...overrides,
    },
  };
}

async function post(app: FastifyInstance, payload: unknown, headers?: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/ai/recommendation',
    payload: payload as Record<string, unknown>,
    headers,
  });
}

describe('POST /ai/recommendation', () => {
  let app: FastifyInstance;
  const directories: string[] = [];

  afterEach(async () => {
    await app.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('responde o exemplo do contrato pelo fallback, sem chave', async () => {
    app = buildApp();

    const response = await post(app, EXAMPLE);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: 'unavailable',
      outcome: 'suggestions',
      products: [{ productId: 'p2', reason: P2_REASON }],
    });
    expect(response.json()).not.toHaveProperty('name');
    expect(response.json().products[0]).not.toHaveProperty('priceCents');

    const big = await post(app, {
      ...EXAMPLE,
      preferences: { ...EXAMPLE.preferences, hunger: 'big' },
    });
    expect(big.json()).toEqual(response.json());
  });

  it('rejeita payload fora do contrato com VALIDATION_ERROR', async () => {
    app = buildApp();
    const cases: unknown[] = [
      {},
      { ...EXAMPLE, preferences: undefined },
      { ...EXAMPLE, text: 'quero carne' },
      { ...EXAMPLE, preferences: 'quero carne' },
      { ...EXAMPLE, preferences: { ...EXAMPLE.preferences, text: 'sem cebola' } },
      { ...EXAMPLE, preferences: { ...EXAMPLE.preferences, budget: undefined } },
      { ...EXAMPLE, limit: 0 },
      { ...EXAMPLE, limit: 4 },
      { ...EXAMPLE, limit: null },
      { ...EXAMPLE, limit: 1.5 },
      { ...EXAMPLE, limit: '3' },
      {
        ...EXAMPLE,
        preferences: { ...EXAMPLE.preferences, restrictions: ['no_onion', 'no_onion'] },
      },
      { ...EXAMPLE, preferences: { ...EXAMPLE.preferences, restrictions: null } },
      { ...EXAMPLE, preferences: { ...EXAMPLE.preferences, restrictions: 'no_onion' } },
      { ...EXAMPLE, table: ' 12' },
      { ...EXAMPLE, table: '12 ' },
      { ...EXAMPLE, table: '' },
      { ...EXAMPLE, table: 'a'.repeat(41) },
      { ...EXAMPLE, preferences: { ...EXAMPLE.preferences, budget: 'ate_20' } },
    ];

    for (const [index, payload] of cases.entries()) {
      const response = await post(app, payload);
      expect(response.statusCode, `caso ${index}`).toBe(400);
      expect(response.json().error.code, `caso ${index}`).toBe('VALIDATION_ERROR');
    }

    const missingFields = ['budget', 'hunger', 'protein', 'style', 'taste'] as const;
    for (const field of missingFields) {
      const body = structuredClone(EXAMPLE);
      delete body.preferences[field];
      const response = await post(app, body);
      expect(response.statusCode, field).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('recusa combinação contraditória antes do cardápio e do provedor', async () => {
    let calls = 0;
    const provider: RecommendationProvider = async () => {
      calls += 1;
      return ['p2'];
    };
    app = buildApp({ seed: false, recommendation: { provider } });

    const contradictory = [
      preferences({ protein: 'fish', budget: 'unlimited' }, ['no_seafood']),
      preferences({ protein: 'chicken' }, ['vegan']),
      preferences({ protein: 'fish' }, ['vegan']),
      preferences({ protein: 'beef', budget: 'from_36_to_60' }, ['vegan', 'no_onion']),
    ];

    for (const payload of contradictory) {
      const response = await post(app, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(calls).toBe(0);
  });

  it('distingue cardápio vazio, bebida, esgotado e prato incompatível', async () => {
    let calls = 0;
    const provider: RecommendationProvider = async () => {
      calls += 1;
      return ['p3'];
    };
    app = buildApp({ seed: false, recommendation: { provider } });

    const empty = await post(app, preferences({ protein: 'vegetarian', budget: 'up_to_20' }));
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      provider: 'not_called',
      outcome: 'empty_catalog',
      products: [],
    });

    await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Lata',
        description: 'Frango',
        category: 'bebidas',
        priceCents: 790,
        ingredients: ['Frango'],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Frango esgotado',
        description: 'Fora',
        category: 'burgers',
        priceCents: 100,
        available: false,
        ingredients: ['Frango'],
      },
    });

    const drinks = await post(app, preferences({ protein: 'chicken' }));
    expect(drinks.json()).toEqual({
      provider: 'not_called',
      outcome: 'no_compatible_products',
      products: [],
    });

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Frango grelhado',
        description: 'Prato',
        category: 'burgers',
        priceCents: 2500,
        ingredients: ['Frango'],
      },
    });
    const chickenId = created.json().id as string;
    const matched = await post(app, preferences({ protein: 'chicken', hunger: 'little' }));
    expect(matched.json().products.map((item: { productId: string }) => item.productId)).toEqual([
      chickenId,
    ]);
    expect(calls).toBe(1);
  });

  it('cobre os cenários do seed no fallback', async () => {
    app = buildApp();

    const vegetarian = await post(
      app,
      preferences({ budget: 'up_to_20', hunger: 'normal', protein: 'vegetarian', style: 'light' }),
    );
    expect(vegetarian.json()).toEqual({
      provider: 'unavailable',
      outcome: 'suggestions',
      products: [{ productId: 'p3', reason: 'Vegetariano, Até R$ 20, Salgado' }],
    });

    const full = await post(
      app,
      preferences({ budget: 'up_to_20', hunger: 'normal', protein: 'vegetarian', style: 'full' }),
    );
    expect(productIds(full)).toEqual(productIds(vegetarian));

    const little = await post(app, preferences({ hunger: 'little', style: 'light' }));
    const sameStyle = await post(app, preferences({ hunger: 'little', style: 'full' }));
    expect(productIds(little)).toEqual(['p1', 'p2', 'p9']);
    expect(productIds(sameStyle)).toEqual(['p1', 'p2', 'p9']);
    expect(little.json().provider).toBe('unavailable');
    expect(little.json().products[0].reason).toBe('Carne, Salgado');

    const big = await post(app, preferences({ hunger: 'big' }));
    expect(productIds(big)).toEqual(['p9', 'p2', 'p1']);

    const omittedLimit = preferences({ hunger: 'little' });
    delete omittedLimit.limit;
    const withoutLimit = await post(app, omittedLimit);
    expect(productIds(withoutLimit)).toEqual(['p1', 'p2', 'p9']);

    const chicken = await post(app, preferences({ protein: 'chicken' }));
    expect(chicken.json()).toEqual({
      provider: 'not_called',
      outcome: 'no_compatible_products',
      products: [],
    });
    const fish = await post(app, preferences({ protein: 'fish', hunger: 'normal' }));
    expect(fish.json().outcome).toBe('no_compatible_products');
    expect(fish.json().provider).toBe('not_called');
  });

  it('não chama o provedor quando a restrição crítica esvazia o conjunto', async () => {
    let calls = 0;
    app = buildApp({
      recommendation: {
        provider: async () => {
          calls += 1;
          return ['p3'];
        },
      },
    });

    for (const restriction of ['no_gluten', 'no_lactose', 'vegan', 'no_seafood']) {
      const response = await post(
        app,
        preferences({ protein: 'vegetarian', budget: 'unlimited' }, [restriction]),
      );
      expect(response.json(), restriction).toEqual({
        provider: 'not_called',
        outcome: 'no_compatible_products',
        products: [],
      });
    }
    expect(calls).toBe(0);
  });

  it('valida os ids do provedor e não completa com o fallback', async () => {
    const cases: { ids: string[]; expectedIds: string[]; providerName: string }[] = [
      { ids: ['p9', 'p1', 'p2'], expectedIds: ['p9', 'p1', 'p2'], providerName: 'answered' },
      { ids: ['nao-existe', 'p2'], expectedIds: ['p2'], providerName: 'answered' },
      { ids: ['p8', 'p2'], expectedIds: ['p2'], providerName: 'answered' },
      { ids: ['p3', 'p2'], expectedIds: ['p2'], providerName: 'answered' },
      { ids: ['p2', 'p2', 'p1'], expectedIds: ['p2', 'p1'], providerName: 'answered' },
      { ids: ['nao-existe', 'p9'], expectedIds: ['p9'], providerName: 'answered' },
      { ids: ['p8', 'p3', 'sumiu'], expectedIds: ['p1', 'p2', 'p9'], providerName: 'unavailable' },
    ];

    for (const item of cases) {
      app = buildApp({
        recommendation: {
          provider: async () => item.ids,
        },
      });
      const response = await post(app, preferences({ hunger: 'little' }));
      expect(productIds(response), item.ids.join(',')).toEqual(item.expectedIds);
      expect(response.json().provider).toBe(item.providerName);
      expect(response.json().products[0].reason).toBe('Carne, Salgado');
      await app.close();
    }

    app = buildApp({
      recommendation: {
        provider: async () => ['p9'],
      },
    });
    const partial = await post(app, preferences({ hunger: 'little' }));
    expect(partial.json()).toMatchObject({
      provider: 'answered',
      outcome: 'suggestions',
      products: [{ productId: 'p9', reason: 'Carne, Salgado' }],
    });
    expect(partial.json().products).toHaveLength(1);
  });

  it('usa fallback em timeout, rede, json inválido e chave ausente', async () => {
    const expected = {
      provider: 'unavailable',
      outcome: 'suggestions',
      products: [{ productId: 'p2', reason: P2_REASON }],
    };

    app = buildApp({
      recommendation: {
        apiKey: 'test-key',
        timeoutMs: 30,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              reject(new Error('sem AbortSignal'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(signal.reason);
            });
          }),
      },
    });
    expect((await post(app, EXAMPLE)).json()).toEqual(expected);
    await app.close();

    app = buildApp({
      recommendation: {
        apiKey: 'test-key',
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
      },
    });
    expect((await post(app, EXAMPLE)).json()).toEqual(expected);
    await app.close();

    app = buildApp({
      recommendation: {
        apiKey: 'test-key',
        fetchImpl: async () => new Response('nao-json', { status: 200 }),
      },
    });
    expect((await post(app, EXAMPLE)).json()).toEqual(expected);
    await app.close();

    let called = false;
    app = buildApp({
      recommendation: {
        apiKey: '   ',
        fetchImpl: async () => {
          called = true;
          return new Response('{}', { status: 200 });
        },
      },
    });
    expect((await post(app, EXAMPLE)).json()).toEqual(expected);
    expect(called).toBe(false);
  });

  it('aceita ids do modelo só dentro do conjunto elegível', async () => {
    app = buildApp({
      recommendation: {
        apiKey: 'test-key',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          productIds: ['p9', 'p2'],
                          name: 'Inventado',
                          priceCents: 1,
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      },
    });

    const response = await post(app, EXAMPLE);
    expect(response.json()).toEqual({
      provider: 'answered',
      outcome: 'suggestions',
      products: [{ productId: 'p2', reason: P2_REASON }],
    });
  });

  it('não grava produto, pedido, item nem chave e ignora Idempotency-Key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-recommendation-'));
    directories.push(directory);
    const databasePath = join(directory, 'dinna.sqlite');
    app = buildApp({ databasePath });

    const before = fingerprint(databasePath);
    const response = await post(app, EXAMPLE, {
      'idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['idempotency-retention']).toBeUndefined();
    expect(fingerprint(databasePath)).toEqual(before);

    const order = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': '550e8400-e29b-41d4-a716-446655440000' },
      payload: { table: '12', items: [{ productId: 'p1', quantity: 1 }] },
    });
    expect(order.statusCode).toBe(201);
    const after = fingerprint(databasePath);
    expect(after.orders).toBe(1);
    expect(after.orderItems).toBe(1);
    expect(after.keys).toBe(1);
    expect(after.products).toBe(before.products);
    expect(after.rows).toEqual(before.rows);
  });
});

function productIds(response: { json: () => { products: { productId: string }[] } }): string[] {
  return response.json().products.map((item) => item.productId);
}

function fingerprint(path: string): {
  products: number;
  orders: number;
  orderItems: number;
  keys: number;
  rows: unknown[];
} {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
    return {
      products: count('SELECT COUNT(*) AS count FROM products'),
      orders: count('SELECT COUNT(*) AS count FROM orders'),
      orderItems: count('SELECT COUNT(*) AS count FROM order_items'),
      keys: count('SELECT COUNT(*) AS count FROM idempotency_keys'),
      rows: db
        .prepare(
          `SELECT id, name, description, category, price_cents, image_url, available, ingredients
           FROM products ORDER BY id`,
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
