import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import { createOrder } from '../src/modules/orders/orders.repository.js';
import { AppError } from '../src/shared/errors/app-error.js';

describe('orders', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('POST /orders cria pedido, calcula o total e inicia em received', async () => {
    app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        table: '12',
        items: [
          { productId: 'p1', quantity: 2, note: 'sem cebola' },
          { productId: 'p2', quantity: 1 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      table: '12',
      status: 'received',
      items: [
        { productId: 'p1', quantity: 2, note: 'sem cebola' },
        { productId: 'p2', quantity: 1 },
      ],
      totalCents: 10470,
    });
    expect(response.json().id).toMatch(/^o_[0-9a-f-]{36}$/);
    expect(response.json().createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('POST /orders rejeita corpo inválido e lista vazia', async () => {
    app = buildApp();

    const invalidBody = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '12', items: [{ productId: 'p1', quantity: 0 }] },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const emptyItems = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '12', items: [] },
    });
    expect(emptyItems.statusCode).toBe(400);
    expect(emptyItems.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('POST /orders rejeita produto inexistente ou indisponível', async () => {
    app = buildApp();

    for (const productId of ['nao-existe', 'p8']) {
      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        payload: { table: '12', items: [{ productId, quantity: 1 }] },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'PRODUCT_NOT_FOUND' } });
    }
  });

  it('createOrder desfaz toda a gravação quando um item é inválido', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      expect(() =>
        createOrder(db, {
          table: '12',
          items: [
            { productId: 'p1', quantity: 1 },
            { productId: 'p8', quantity: 1 },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' } satisfies Partial<AppError>),
      );

      const orderCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get() as {
        count: number;
      };
      const itemCount = db.prepare('SELECT COUNT(*) AS count FROM order_items').get() as {
        count: number;
      };
      expect(orderCount.count).toBe(0);
      expect(itemCount.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
