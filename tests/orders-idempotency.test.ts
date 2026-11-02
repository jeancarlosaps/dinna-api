import { randomUUID } from 'node:crypto';
import type { OutgoingHttpHeaders } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import type { CreateOrderInput } from '../src/db/types.js';
import {
  fingerprintCreateOrderInput,
  parseIdempotencyKey,
} from '../src/modules/orders/order-idempotency.js';
import { createOrder } from '../src/modules/orders/orders.repository.js';
import { AppError } from '../src/shared/errors/app-error.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const orderPayload: CreateOrderInput = {
  table: '12',
  items: [
    { productId: 'p1', quantity: 2, note: 'sem cebola' },
    { productId: 'p2', quantity: 1 },
  ],
};

interface WorkerResult {
  statusCode: number;
  body: {
    id?: string;
    error?: { code?: string; message?: string };
  };
}

function countRows(
  db: ReturnType<typeof openDatabase>,
  table: 'orders' | 'idempotency_keys',
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function expectPermanentRetention(headers: OutgoingHttpHeaders): void {
  expect(headers['idempotency-retention']).toBe('permanent');
}

function postOrder(app: FastifyInstance, payload: CreateOrderInput, idempotencyKey?: string) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    headers: idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey },
    payload,
  });
}

function runConcurrentPost(
  databasePath: string,
  idempotencyKey: string,
  payload: CreateOrderInput,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      pathToFileURL(join(process.cwd(), 'tests/helpers/create-order-worker.ts')),
      {
        execArgv: ['--import', 'tsx'],
        workerData: { databasePath, idempotencyKey, payload },
      },
    );
    let settled = false;
    let result: WorkerResult | undefined;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      if (!result) {
        reject(new Error('worker encerrou sem resultado'));
        return;
      }
      resolve(result);
    };

    worker.once('message', (message: WorkerResult) => {
      result = message;
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish(new Error(`worker encerrou com código ${code}`));
        return;
      }
      finish();
    });
  });
}

describe('POST /orders idempotência', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    const openedApp = app;
    app = undefined;
    await openedApp?.close();
  });

  it('cria o pedido na primeira requisição com Idempotency-Key', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const response = await postOrder(currentApp, orderPayload, idempotencyKey);

    expect(response.statusCode).toBe(201);
    expectPermanentRetention(response.headers);
    expect(response.json()).toMatchObject({
      table: '12',
      status: 'received',
      items: orderPayload.items,
      totalCents: 10470,
    });
    expect(response.json().id).toMatch(/^o_[0-9a-f-]{36}$/);

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(1);
  });

  it('devolve o pedido original quando a mesma chave e o mesmo payload se repetem', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const first = await postOrder(currentApp, orderPayload, idempotencyKey);
    const replay = await postOrder(currentApp, orderPayload, idempotencyKey.toUpperCase());

    expect(replay.statusCode).toBe(201);
    expectPermanentRetention(replay.headers);
    expect(replay.json()).toEqual(first.json());

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(1);
  });

  it('repete o corpo da criação depois que o status do pedido avança', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const created = await postOrder(currentApp, orderPayload, idempotencyKey);
    const advanced = await currentApp.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/status`,
      payload: { status: 'preparing' },
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({ id: created.json().id, status: 'preparing' });

    const replay = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(replay.statusCode).toBe(201);
    expectPermanentRetention(replay.headers);
    expect(replay.json()).toEqual(created.json());

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toMatchObject([{ id: created.json().id, status: 'preparing' }]);
  });

  it('devolve o snapshot original quando o produto fica indisponível depois da criação', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const created = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(created.statusCode).toBe(201);

    const removed = await currentApp.inject({ method: 'DELETE', url: '/products/p1' });
    expect(removed.statusCode).toBe(204);

    const replay = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toEqual([created.json()]);
  });

  it('devolve o totalCents original quando o preço do produto muda depois da criação', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const created = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(created.statusCode).toBe(201);
    expect(created.json().totalCents).toBe(10470);

    const updated = await currentApp.inject({
      method: 'PUT',
      url: '/products/p1',
      payload: {
        name: 'Burger Clássico',
        description: 'Pão brioche, blend 180g, queijo cheddar e salada',
        category: 'burgers',
        priceCents: 1000,
        available: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: 'p1', priceCents: 1000, available: true });

    const replay = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(replay.json().totalCents).toBe(10470);

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].id).toBe(created.json().id);
  });

  it('retorna 409 quando a mesma chave chega com payload diferente', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const created = await postOrder(currentApp, orderPayload, idempotencyKey);
    const conflict = await postOrder(
      currentApp,
      { table: '12', items: [{ productId: 'p1', quantity: 1 }] },
      idempotencyKey,
    );

    expect(conflict.statusCode).toBe(409);
    expectPermanentRetention(conflict.headers);
    expect(conflict.json()).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'A Idempotency-Key já foi usada com um payload diferente',
      },
    });

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toEqual([created.json()]);
  });

  it('não cria duplicata quando duas requisições concorrentes usam a mesma chave', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-idempotency-'));
    const databasePath = join(directory, 'dinna.sqlite');
    const setup = buildApp({ databasePath });
    await setup.close();

    try {
      const idempotencyKey = randomUUID();
      const [first, second] = await Promise.all([
        runConcurrentPost(databasePath, idempotencyKey, orderPayload),
        runConcurrentPost(databasePath, idempotencyKey, orderPayload),
      ]);

      expect(first.statusCode, JSON.stringify(first)).toBe(201);
      expect(second.statusCode, JSON.stringify(second)).toBe(201);
      expect(first.body.id).toBe(second.body.id);

      const db = openDatabase({ path: databasePath, seed: false });
      try {
        expect(countRows(db, 'orders')).toBe(1);
        expect(countRows(db, 'idempotency_keys')).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('não cria duplicata quando requisições concorrentes usam a mesma chave e payloads diferentes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-idempotency-'));
    const databasePath = join(directory, 'dinna.sqlite');
    const setup = buildApp({ databasePath });
    await setup.close();

    try {
      const idempotencyKey = randomUUID();
      const otherPayload: CreateOrderInput = {
        table: '8',
        items: [{ productId: 'p2', quantity: 1 }],
      };
      const [first, second] = await Promise.all([
        runConcurrentPost(databasePath, idempotencyKey, orderPayload),
        runConcurrentPost(databasePath, idempotencyKey, otherPayload),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses, JSON.stringify([first, second])).toEqual([201, 409]);
      const conflict = first.statusCode === 409 ? first : second;
      expect(conflict.body.error?.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

      const db = openDatabase({ path: databasePath, seed: false });
      try {
        expect(countRows(db, 'orders')).toBe(1);
        expect(countRows(db, 'idempotency_keys')).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('mantém a proteção depois de reiniciar o servidor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-idempotency-'));
    const databasePath = join(directory, 'dinna.sqlite');
    const idempotencyKey = randomUUID();

    try {
      const firstApp = buildApp({ databasePath });
      app = firstApp;
      const created = await postOrder(firstApp, orderPayload, idempotencyKey);
      expect(created.statusCode).toBe(201);
      await firstApp.close();
      app = undefined;

      const restarted = buildApp({ databasePath });
      app = restarted;
      const replay = await postOrder(restarted, orderPayload, idempotencyKey);

      expect(replay.statusCode).toBe(201);
      expectPermanentRetention(replay.headers);
      expect(replay.json()).toEqual(created.json());

      const listed = await restarted.inject({ method: 'GET', url: '/orders' });
      expect(listed.json()).toHaveLength(1);
    } finally {
      const openedApp = app;
      app = undefined;
      await openedApp?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('desfaz chave e pedido quando a transação falha antes do commit', () => {
    const db = openDatabase({ path: ':memory:' });
    const idempotencyKey = randomUUID();

    try {
      db.exec(`
        CREATE TRIGGER fail_idempotency_insert
        BEFORE INSERT ON idempotency_keys
        BEGIN
          SELECT RAISE(ABORT, 'simulated idempotency insert failure');
        END;
      `);

      expect(() => createOrder(db, orderPayload, idempotencyKey)).toThrow(
        'simulated idempotency insert failure',
      );
      expect(countRows(db, 'orders')).toBe(0);
      expect(countRows(db, 'idempotency_keys')).toBe(0);

      db.exec('DROP TRIGGER fail_idempotency_insert');

      const order = createOrder(db, orderPayload, idempotencyKey);
      const replay = createOrder(db, orderPayload, idempotencyKey);
      expect(replay).toEqual(order);
      expect(countRows(db, 'orders')).toBe(1);
      expect(countRows(db, 'idempotency_keys')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('não consome a chave quando o produto é inválido', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();

    const missing = await postOrder(
      currentApp,
      { table: '12', items: [{ productId: 'nao-existe', quantity: 1 }] },
      idempotencyKey,
    );
    expect(missing.statusCode).toBe(404);
    expectPermanentRetention(missing.headers);
    expect(missing.json()).toMatchObject({ error: { code: 'PRODUCT_NOT_FOUND' } });

    const created = await postOrder(currentApp, orderPayload, idempotencyKey);
    expect(created.statusCode).toBe(201);

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toEqual([created.json()]);
  });

  it('cria outro pedido quando a chave é nova', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const first = await postOrder(currentApp, orderPayload, randomUUID());
    const second = await postOrder(currentApp, orderPayload, randomUUID());

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(2);
  });

  it('cria um pedido novo a cada POST quando o header está ausente', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const first = await postOrder(currentApp, orderPayload);
    const second = await postOrder(currentApp, orderPayload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expectPermanentRetention(first.headers);
    expectPermanentRetention(second.headers);
    expect(second.json().id).not.toBe(first.json().id);
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('rejeita header inválido sem gravar pedido', async () => {
    const currentApp = buildApp();
    app = currentApp;

    for (const idempotencyKey of [
      '',
      'pedido-12',
      'not-a-uuid',
      `${randomUUID()},${randomUUID()}`,
    ]) {
      const response = await postOrder(currentApp, orderPayload, idempotencyKey);
      expect(response.statusCode, idempotencyKey).toBe(400);
      expectPermanentRetention(response.headers);
      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'O header Idempotency-Key deve ser um UUID',
        },
      });
    }

    expect(() => parseIdempotencyKey([randomUUID(), randomUUID()])).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      } satisfies Partial<AppError>),
    );

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toEqual([]);
  });

  it('devolve o pedido original depois de 30 dias e mantém 409 para outro payload', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-idempotency-'));
    const databasePath = join(directory, 'dinna.sqlite');
    const idempotencyKey = randomUUID();

    try {
      const firstApp = buildApp({ databasePath });
      app = firstApp;
      const created = await postOrder(firstApp, orderPayload, idempotencyKey);
      expect(created.statusCode).toBe(201);
      await firstApp.close();
      app = undefined;

      const db = openDatabase({ path: databasePath, seed: false });
      try {
        const agedAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
        const updated = db
          .prepare('UPDATE idempotency_keys SET created_at = ? WHERE key = ?')
          .run(agedAt, idempotencyKey);
        expect(Number(updated.changes)).toBe(1);
      } finally {
        db.close();
      }

      const restarted = buildApp({ databasePath });
      app = restarted;
      const replay = await postOrder(restarted, orderPayload, idempotencyKey);
      expect(replay.statusCode).toBe(201);
      expectPermanentRetention(replay.headers);
      expect(replay.json()).toEqual(created.json());

      const conflict = await postOrder(
        restarted,
        { table: '12', items: [{ productId: 'p1', quantity: 1 }] },
        idempotencyKey,
      );
      expect(conflict.statusCode).toBe(409);
      expectPermanentRetention(conflict.headers);
      expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });

      const listed = await restarted.inject({ method: 'GET', url: '/orders' });
      expect(listed.json()).toEqual([created.json()]);

      const storedDb = openDatabase({ path: databasePath, seed: false });
      try {
        expect(countRows(storedDb, 'orders')).toBe(1);
        expect(countRows(storedDb, 'idempotency_keys')).toBe(1);
        const stored = storedDb
          .prepare('SELECT order_id, response_json FROM idempotency_keys WHERE key = ?')
          .get(idempotencyKey) as { order_id: string; response_json: string };
        expect(stored.order_id).toBe(created.json().id);
        expect(JSON.parse(stored.response_json)).toEqual(created.json());
      } finally {
        storedDb.close();
      }
    } finally {
      const openedApp = app;
      app = undefined;
      await openedApp?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('não cria outro pedido quando a chave existe sem o pedido correspondente', () => {
    const db = openDatabase({ path: ':memory:' });
    const idempotencyKey = randomUUID();

    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare(
        `INSERT INTO idempotency_keys (key, request_hash, order_id, created_at, response_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        idempotencyKey,
        fingerprintCreateOrderInput(orderPayload),
        'o_ausente',
        new Date().toISOString(),
        JSON.stringify({
          id: 'o_ausente',
          table: '12',
          status: 'received',
          items: orderPayload.items,
          totalCents: 10470,
          createdAt: new Date().toISOString(),
        }),
      );
      db.exec('PRAGMA foreign_keys = ON');

      expect(() => createOrder(db, orderPayload, idempotencyKey)).toThrowError(
        expect.objectContaining({
          statusCode: 500,
          code: 'IDEMPOTENCY_STATE_INVALID',
        } satisfies Partial<AppError>),
      );
      expect(countRows(db, 'orders')).toBe(0);
      expect(countRows(db, 'idempotency_keys')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('considera equivalente a mesma semântica e diferente a ordem dos itens ou a note vazia', () => {
    const forward = fingerprintCreateOrderInput(orderPayload);
    const reorderedFields = fingerprintCreateOrderInput({
      items: [
        { quantity: 2, note: 'sem cebola', productId: 'p1' },
        { quantity: 1, productId: 'p2' },
      ],
      table: '12',
    });
    expect(reorderedFields).toBe(forward);

    const swappedItems = fingerprintCreateOrderInput({
      table: '12',
      items: [
        { productId: 'p2', quantity: 1 },
        { productId: 'p1', quantity: 2, note: 'sem cebola' },
      ],
    });
    expect(swappedItems).not.toBe(forward);

    const omittedNote = fingerprintCreateOrderInput({
      table: '12',
      items: [{ productId: 'p1', quantity: 1 }],
    });
    const emptyNote = fingerprintCreateOrderInput({
      table: '12',
      items: [{ productId: 'p1', quantity: 1, note: '' }],
    });
    expect(emptyNote).not.toBe(omittedNote);
  });
});
