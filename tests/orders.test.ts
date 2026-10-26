import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import { createOrder, listOrders } from '../src/modules/orders/orders.repository.js';
import { AppError } from '../src/shared/errors/app-error.js';

describe('orders', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    const openedApp = app;
    app = undefined;
    await openedApp?.close();
  });

  it('GET /orders lista pedidos, inclui itens e filtra por status e mesa', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const firstOrder = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '12', items: [{ productId: 'p1', quantity: 2, note: 'sem cebola' }] },
    });
    const secondOrder = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '8', items: [{ productId: 'p2', quantity: 1 }] },
    });
    expect(firstOrder.statusCode).toBe(201);
    expect(secondOrder.statusCode).toBe(201);

    const filtered = await currentApp.inject({
      method: 'GET',
      url: '/orders?status=received&table=12',
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual([
      {
        id: firstOrder.json().id,
        table: '12',
        status: 'received',
        items: [{ productId: 'p1', quantity: 2, note: 'sem cebola' }],
        totalCents: 6580,
        createdAt: firstOrder.json().createdAt,
      },
    ]);

    const noMatches = await currentApp.inject({ method: 'GET', url: '/orders?table=missing' });
    expect(noMatches.statusCode).toBe(200);
    expect(noMatches.json()).toEqual([]);

    const invalidStatus = await currentApp.inject({ method: 'GET', url: '/orders?status=unknown' });
    expect(invalidStatus.statusCode).toBe(400);
    expect(invalidStatus.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('POST /orders cria pedido, calcula o total e inicia em received', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const response = await currentApp.inject({
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
    const currentApp = buildApp();
    app = currentApp;

    const invalidBody = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '12', items: [{ productId: 'p1', quantity: 0 }] },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const emptyItems = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '12', items: [] },
    });
    expect(emptyItems.statusCode).toBe(400);
    expect(emptyItems.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('POST /orders rejeita produto inexistente ou indisponível', async () => {
    const currentApp = buildApp();
    app = currentApp;

    for (const productId of ['nao-existe', 'p8']) {
      const response = await currentApp.inject({
        method: 'POST',
        url: '/orders',
        payload: { table: '12', items: [{ productId, quantity: 1 }] },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'PRODUCT_NOT_FOUND' } });
    }
  });

  it('POST /orders rejeita quantidades e totais sem precisão segura em centavos', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const unsafeQuantity = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        table: '12',
        items: [{ productId: 'p1', quantity: Number.MAX_SAFE_INTEGER + 1 }],
      },
    });
    expect(unsafeQuantity.statusCode).toBe(400);
    expect(unsafeQuantity.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const unsafeTotal = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        table: '12',
        items: [{ productId: 'p1', quantity: 10_000_000_000_001 }],
      },
    });
    expect(unsafeTotal.statusCode).toBe(400);
    expect(unsafeTotal.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('createOrder rejeita total sem precisão segura antes de persistir', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      expect(() =>
        createOrder(db, {
          table: '12',
          items: [{ productId: 'p1', quantity: 10_000_000_000_001 }],
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>),
      );

      const orderCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get() as {
        count: number;
      };
      expect(orderCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it('listOrders ordena a fila e filtra sem perder itens ou observações', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      const newerOrder = createOrder(db, {
        table: '8',
        items: [{ productId: 'p2', quantity: 1 }],
      });
      const olderOrder = createOrder(db, {
        table: '12',
        items: [{ productId: 'p1', quantity: 2, note: 'sem cebola' }],
      });

      db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(
        '2026-10-25T10:02:00.000Z',
        newerOrder.id,
      );
      db.prepare('UPDATE orders SET created_at = ?, status = ? WHERE id = ?').run(
        '2026-10-25T10:01:00.000Z',
        'preparing',
        olderOrder.id,
      );

      expect(listOrders(db)).toEqual([
        { ...olderOrder, status: 'preparing', createdAt: '2026-10-25T10:01:00.000Z' },
        { ...newerOrder, createdAt: '2026-10-25T10:02:00.000Z' },
      ]);
      expect(listOrders(db, { status: 'preparing', table: '12' })).toEqual([
        { ...olderOrder, status: 'preparing', createdAt: '2026-10-25T10:01:00.000Z' },
      ]);
      expect(listOrders(db, { table: 'missing' })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('createOrder desfaz pedido e item anterior quando um insert de item falha', () => {
    const db = openDatabase({ path: ':memory:' });

    try {
      db.exec(`
        CREATE TRIGGER fail_second_order_item
        BEFORE INSERT ON order_items
        WHEN NEW.product_id = 'p2'
        BEGIN
          SELECT RAISE(ABORT, 'simulated second item insert failure');
        END;
      `);

      expect(() =>
        createOrder(db, {
          table: '12',
          items: [
            { productId: 'p1', quantity: 1 },
            { productId: 'p2', quantity: 1 },
          ],
        }),
      ).toThrow('simulated second item insert failure');

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
