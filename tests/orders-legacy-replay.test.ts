import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import type { CreateOrderInput } from '../src/db/types.js';
import { fingerprintCreateOrderInput } from '../src/modules/orders/order-idempotency.js';
import {
  createOrderItemResponseSchema,
  createOrderResponseSchema,
  orderItemResponseSchema,
  orderResponseSchema,
} from '../src/modules/orders/orders.routes.js';

const LEGACY_KEY = '550e8400-e29b-41d4-a716-446655440000';
const LEGACY_CREATED_AT = '2026-10-16T18:00:00.000Z';

const legacyPayload: CreateOrderInput = {
  table: '12',
  items: [{ productId: 'p_legacy', quantity: 2, note: 'sem molho' }],
};

const legacyResponse = {
  id: 'o_legacy',
  table: '12',
  status: 'received',
  items: [{ productId: 'p_legacy', quantity: 2, note: 'sem molho' }],
  totalCents: 5000,
  createdAt: LEGACY_CREATED_AT,
};

const migratedItem = {
  productId: 'p_legacy',
  name: 'Prato antigo',
  quantity: 2,
  unitPriceCents: 2500,
  lineTotalCents: 5000,
  note: 'sem molho',
};

/** Schema de order_items e da resposta de POST anteriores ao snapshot de nome e preços. */
const PRE_SNAPSHOT_SQL = `
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  ingredients TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  table_label TEXT NOT NULL,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  note TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  response_json TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
`;

interface WorkerResult {
  statusCode: number;
  body: {
    id?: string;
    error?: { code?: string };
  };
}

interface StoredKeyRow {
  key: string;
  request_hash: string;
  order_id: string;
  response_json: string;
}

function countRows(
  db: DatabaseSync,
  table: 'products' | 'orders' | 'order_items' | 'idempotency_keys',
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function postOrder(app: FastifyInstance, payload: CreateOrderInput, idempotencyKey: string) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'idempotency-key': idempotencyKey },
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

function createPreSnapshotDatabase(options?: { orphanKey?: boolean }): {
  path: string;
  responseJson: string;
  requestHash: string;
} {
  const directory = mkdtempSync(join(tmpdir(), 'dinna-legacy-replay-'));
  const path = join(directory, 'dinna.sqlite');
  const responseJson = JSON.stringify(
    options?.orphanKey ? { ...legacyResponse, id: 'o_ausente' } : legacyResponse,
  );
  const requestHash = fingerprintCreateOrderInput(legacyPayload);
  const orderId = options?.orphanKey ? 'o_ausente' : legacyResponse.id;
  const db = new DatabaseSync(path);
  db.exec(PRE_SNAPSHOT_SQL);
  db.prepare(
    `INSERT INTO products (id, name, description, category, price_cents, image_url, available, ingredients)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('p_legacy', 'Prato antigo', 'Descrição já gravada', 'burgers', 2500, null, 1, '[]');

  if (!options?.orphanKey) {
    db.prepare(
      `INSERT INTO orders (id, table_label, status, total_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(legacyResponse.id, '12', 'received', 5000, LEGACY_CREATED_AT);
    db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, note) VALUES (?, ?, ?, ?)`,
    ).run(legacyResponse.id, 'p_legacy', 2, 'sem molho');
  } else {
    db.exec('PRAGMA foreign_keys = OFF');
  }

  db.prepare(
    `INSERT INTO idempotency_keys (key, request_hash, order_id, created_at, response_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(LEGACY_KEY, requestHash, orderId, LEGACY_CREATED_AT, responseJson);
  db.close();

  return { path, responseJson, requestHash };
}

describe('contratos de serialização de pedido', () => {
  it('exige snapshot em GET e PATCH e aceita o corpo legado só no POST', () => {
    expect(orderItemResponseSchema.additionalProperties).toBe(false);
    expect(createOrderItemResponseSchema.additionalProperties).toBe(false);
    expect(orderResponseSchema.additionalProperties).toBe(false);
    expect(createOrderResponseSchema.additionalProperties).toBe(false);
    expect([...orderItemResponseSchema.required]).toEqual([
      'productId',
      'name',
      'quantity',
      'unitPriceCents',
      'lineTotalCents',
    ]);
    expect([...createOrderItemResponseSchema.required]).toEqual(['productId', 'quantity']);
    expect(Object.keys(createOrderItemResponseSchema.properties)).toEqual([
      'productId',
      'name',
      'quantity',
      'unitPriceCents',
      'lineTotalCents',
      'note',
    ]);
    expect(orderResponseSchema.properties.items.items).toBe(orderItemResponseSchema);
    expect(createOrderResponseSchema.properties.items.items).toBe(createOrderItemResponseSchema);
  });
});

describe('replay de pedido anterior ao snapshot', () => {
  const directories: string[] = [];
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    const openedApp = app;
    app = undefined;
    await openedApp?.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function track(path: string): string {
    directories.push(dirname(path));
    return path;
  }

  it('repete o response_json legado sem inventar snapshot nem alterar o registro', async () => {
    const created = createPreSnapshotDatabase();
    const databasePath = track(created.path);
    const before = new DatabaseSync(databasePath);
    expect(countRows(before, 'products')).toBe(1);
    expect(countRows(before, 'orders')).toBe(1);
    expect(countRows(before, 'order_items')).toBe(1);
    expect(countRows(before, 'idempotency_keys')).toBe(1);
    before.close();

    const currentApp = buildApp({ databasePath, seed: false });
    app = currentApp;

    const renamed = await currentApp.inject({
      method: 'PUT',
      url: '/products/p_legacy',
      payload: {
        name: 'Prato reajustado',
        description: 'Descrição já gravada',
        category: 'burgers',
        priceCents: 9999,
        available: true,
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Prato reajustado', priceCents: 9999 });

    const replay = await postOrder(currentApp, legacyPayload, LEGACY_KEY);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-retention']).toBe('permanent');
    expect(replay.json()).toEqual(legacyResponse);
    expect(Object.keys(replay.json().items[0])).toEqual(['productId', 'quantity', 'note']);

    const detail = await currentApp.inject({ method: 'GET', url: '/orders/o_legacy' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({
      ...legacyResponse,
      orderNumber: 1,
      items: [migratedItem],
    });

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([detail.json()]);

    const patched = await currentApp.inject({
      method: 'PATCH',
      url: '/orders/o_legacy/status',
      payload: { status: 'preparing' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({
      ...legacyResponse,
      orderNumber: 1,
      status: 'preparing',
      items: [migratedItem],
    });

    const replayAfterPatch = await postOrder(currentApp, legacyPayload, LEGACY_KEY);
    expect(replayAfterPatch.statusCode).toBe(201);
    expect(replayAfterPatch.json()).toEqual(legacyResponse);

    await currentApp.close();
    app = undefined;

    const stored = openDatabase({ path: databasePath, seed: false });
    try {
      expect(countRows(stored, 'products')).toBe(1);
      expect(countRows(stored, 'orders')).toBe(1);
      expect(countRows(stored, 'order_items')).toBe(1);
      expect(countRows(stored, 'idempotency_keys')).toBe(1);

      const key = stored
        .prepare(
          `SELECT key, request_hash, order_id, response_json
           FROM idempotency_keys WHERE key = ?`,
        )
        .get(LEGACY_KEY) as unknown as StoredKeyRow;
      expect(key.key).toBe(LEGACY_KEY);
      expect(key.request_hash).toBe(created.requestHash);
      expect(key.order_id).toBe('o_legacy');
      expect(key.response_json).toBe(created.responseJson);
      expect(JSON.parse(key.response_json)).toEqual(legacyResponse);

      const order = stored.prepare('SELECT status FROM orders WHERE id = ?').get('o_legacy') as {
        status: string;
      };
      expect(order.status).toBe('preparing');

      const item = stored
        .prepare(
          `SELECT product_name, unit_price_cents, line_total_cents, quantity, note
           FROM order_items WHERE order_id = ?`,
        )
        .get('o_legacy') as {
        product_name: string;
        unit_price_cents: number;
        line_total_cents: number;
        quantity: number;
        note: string;
      };
      expect(item).toEqual({
        product_name: 'Prato antigo',
        unit_price_cents: 2500,
        line_total_cents: 5000,
        quantity: 2,
        note: 'sem molho',
      });

      const product = stored
        .prepare('SELECT name, price_cents, ingredients FROM products WHERE id = ?')
        .get('p_legacy') as { name: string; price_cents: number; ingredients: string };
      expect(product).toEqual({
        name: 'Prato reajustado',
        price_cents: 9999,
        ingredients: '[]',
      });
    } finally {
      stored.close();
    }
  });

  it('repete pedido novo preservando name e preços', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const idempotencyKey = randomUUID();
    const payload: CreateOrderInput = {
      table: '12',
      items: [
        { productId: 'p1', quantity: 2, note: 'sem cebola' },
        { productId: 'p2', quantity: 1 },
      ],
    };

    const created = await postOrder(currentApp, payload, idempotencyKey);
    const replay = await postOrder(currentApp, payload, idempotencyKey);

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(replay.json().items).toEqual([
      {
        productId: 'p1',
        name: 'Burger Clássico',
        quantity: 2,
        unitPriceCents: 3290,
        lineTotalCents: 6580,
        note: 'sem cebola',
      },
      {
        productId: 'p2',
        name: 'Burger Smoke',
        quantity: 1,
        unitPriceCents: 3890,
        lineTotalCents: 3890,
      },
    ]);

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(1);
  });

  it('responde 409 quando a chave legada recebe outro payload', async () => {
    const databasePath = track(createPreSnapshotDatabase().path);
    const currentApp = buildApp({ databasePath, seed: false });
    app = currentApp;

    const conflict = await postOrder(
      currentApp,
      { table: '12', items: [{ productId: 'p_legacy', quantity: 1 }] },
      LEGACY_KEY,
    );

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'A Idempotency-Key já foi usada com um payload diferente',
      },
    });

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].id).toBe('o_legacy');
  });

  it('mantém IDEMPOTENCY_STATE_INVALID quando a chave legada não tem o pedido', async () => {
    const databasePath = track(createPreSnapshotDatabase({ orphanKey: true }).path);
    const currentApp = buildApp({ databasePath, seed: false });
    app = currentApp;

    const response = await postOrder(currentApp, legacyPayload, LEGACY_KEY);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'IDEMPOTENCY_STATE_INVALID',
        message: 'A chave de idempotência não possui o pedido correspondente',
      },
    });

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.json()).toEqual([]);

    await currentApp.close();
    app = undefined;
    const stored = openDatabase({ path: databasePath, seed: false });
    try {
      expect(countRows(stored, 'orders')).toBe(0);
      expect(countRows(stored, 'order_items')).toBe(0);
      expect(countRows(stored, 'idempotency_keys')).toBe(1);
    } finally {
      stored.close();
    }
  });

  it('não duplica o pedido legado em repetições concorrentes', async () => {
    const created = createPreSnapshotDatabase();
    const databasePath = track(created.path);
    const setup = buildApp({ databasePath, seed: false });
    await setup.close();

    const [first, second] = await Promise.all([
      runConcurrentPost(databasePath, LEGACY_KEY, legacyPayload),
      runConcurrentPost(databasePath, LEGACY_KEY, legacyPayload),
    ]);

    expect(first.statusCode, JSON.stringify(first)).toBe(201);
    expect(second.statusCode, JSON.stringify(second)).toBe(201);
    expect(first.body).toEqual(legacyResponse);
    expect(second.body).toEqual(legacyResponse);

    const stored = openDatabase({ path: databasePath, seed: false });
    try {
      expect(countRows(stored, 'orders')).toBe(1);
      expect(countRows(stored, 'order_items')).toBe(1);
      expect(countRows(stored, 'idempotency_keys')).toBe(1);
      const key = stored
        .prepare('SELECT response_json, request_hash FROM idempotency_keys WHERE key = ?')
        .get(LEGACY_KEY) as { response_json: string; request_hash: string };
      expect(key.response_json).toBe(created.responseJson);
      expect(key.request_hash).toBe(created.requestHash);
    } finally {
      stored.close();
    }
  });
});
