import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import type { CreateOrderInput } from '../src/db/types.js';
import { fingerprintCreateOrderInput } from '../src/modules/orders/order-idempotency.js';

const payload: CreateOrderInput = {
  table: '12',
  items: [{ productId: 'p1', quantity: 1 }],
};

/** Schema de `dev` antes do número público: sem `order_number` e sem contador. */
const PRE_NUMBER_SQL = `
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
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
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

const LEGACY_KEY = '22222222-2222-4222-8222-222222222222';

/** Três pedidos fora da ordem de inserção; dois empatam no horário. */
const LEGACY_ORDERS = [
  { id: 'o_c', table: '3', status: 'finished', total: 1890, createdAt: '2026-11-07T10:00:00.000Z' },
  {
    id: 'o_b',
    table: '2',
    status: 'preparing',
    total: 3290,
    createdAt: '2026-11-06T09:00:00.000Z',
  },
  { id: 'o_a', table: '1', status: 'received', total: 3290, createdAt: '2026-11-06T09:00:00.000Z' },
] as const;

interface StoredOrderRow {
  id: string;
  order_number: number | null;
  table_label: string;
  status: string;
  total_cents: number;
  created_at: string;
}

function tempDatabasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'dinna-order-number-'));
  return { directory, path: join(directory, 'dinna.sqlite') };
}

/** Banco no formato anterior ao número público, com itens e uma chave de idempotência. */
function createPreNumberDatabase(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(PRE_NUMBER_SQL);
    db.prepare(
      `INSERT INTO products (id, name, description, category, price_cents, image_url, available)
       VALUES ('p1', 'Burger Clássico', 'Pão e carne', 'burgers', 3290, NULL, 1)`,
    ).run();
    const insertOrder = db.prepare(
      'INSERT INTO orders (id, table_label, status, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const insertItem = db.prepare(
      `INSERT INTO order_items (
         order_id, product_id, product_name, unit_price_cents, line_total_cents, quantity, note
       ) VALUES (?, 'p1', 'Burger Clássico', 3290, ?, 1, ?)`,
    );
    for (const order of LEGACY_ORDERS) {
      insertOrder.run(order.id, order.table, order.status, order.total, order.createdAt);
      insertItem.run(order.id, order.total, `nota ${order.id}`);
    }
    const legacyBody: CreateOrderInput = {
      table: '2',
      items: [{ productId: 'p1', quantity: 1 }],
    };
    db.prepare(
      `INSERT INTO idempotency_keys (key, request_hash, order_id, created_at, response_json)
       VALUES (?, ?, 'o_b', ?, ?)`,
    ).run(
      LEGACY_KEY,
      fingerprintCreateOrderInput(legacyBody),
      '2026-11-06T09:00:00.000Z',
      JSON.stringify({
        id: 'o_b',
        table: '2',
        status: 'received',
        items: [{ productId: 'p1', quantity: 1 }],
        totalCents: 3290,
        createdAt: '2026-11-06T09:00:00.000Z',
      }),
    );
  } finally {
    db.close();
  }
}

function readRows(path: string): {
  orders: StoredOrderRow[];
  items: unknown[];
  keys: unknown[];
  sequence: unknown;
} {
  const db = new DatabaseSync(path);
  try {
    return {
      orders: db.prepare('SELECT * FROM orders ORDER BY id').all() as unknown as StoredOrderRow[],
      items: db.prepare('SELECT * FROM order_items ORDER BY id').all(),
      keys: db.prepare('SELECT * FROM idempotency_keys ORDER BY key').all(),
      sequence: db.prepare('SELECT last_value FROM order_number_sequence WHERE id = 1').get(),
    };
  } finally {
    db.close();
  }
}

function hasColumn(path: string, column: string): boolean {
  const db = new DatabaseSync(path);
  try {
    const columns = db.prepare('PRAGMA table_info(orders)').all() as unknown as Array<{
      name: string;
    }>;
    return columns.some((entry) => entry.name === column);
  } finally {
    db.close();
  }
}

function post(app: FastifyInstance, body: CreateOrderInput = payload, key?: string) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    headers: key === undefined ? {} : { 'idempotency-key': key },
    payload: body,
  });
}

interface WorkerResult {
  statusCode: number;
  body: { id?: string; orderNumber?: number };
}

function postInWorker(databasePath: string, idempotencyKey: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      pathToFileURL(join(process.cwd(), 'tests/helpers/create-order-worker.ts')),
      { execArgv: ['--import', 'tsx'], workerData: { databasePath, idempotencyKey, payload } },
    );
    let result: WorkerResult | undefined;
    worker.once('message', (message: WorkerResult) => {
      result = message;
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0 || result === undefined) {
        reject(new Error(`worker encerrou com código ${code} e sem resultado`));
        return;
      }
      resolve(result);
    });
  });
}

describe('número público do pedido', () => {
  let app: FastifyInstance | undefined;
  const directories: string[] = [];

  afterEach(async () => {
    const openedApp = app;
    app = undefined;
    await openedApp?.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('o primeiro pedido recebe 1 e os seguintes seguem em ordem', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const numbers: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await post(currentApp);
      expect(response.statusCode).toBe(201);
      numbers.push(response.json().orderNumber);
    }

    expect(numbers).toEqual([1, 2, 3]);
  });

  it('GET por id técnico, listagem e PATCH devolvem o mesmo número', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const first = (await post(currentApp)).json();
    const second = (
      await post(currentApp, { table: '8', items: [{ productId: 'p2', quantity: 1 }] })
    ).json();

    const detail = await currentApp.inject({ method: 'GET', url: `/orders/${second.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: second.id, orderNumber: 2 });

    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    // A fila ordena por horário e, no empate do milissegundo, pelo id aleatório.
    expect(
      listed
        .json()
        .map((order: { id: string; orderNumber: number }) => [order.id, order.orderNumber])
        .sort((a: [string, number], b: [string, number]) => a[1] - b[1]),
    ).toEqual([
      [first.id, 1],
      [second.id, 2],
    ]);

    const patched = await currentApp.inject({
      method: 'PATCH',
      url: `/orders/${first.id}/status`,
      payload: { status: 'preparing' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ id: first.id, orderNumber: 1, status: 'preparing' });

    const afterPatch = await currentApp.inject({ method: 'GET', url: `/orders/${first.id}` });
    expect(afterPatch.json().orderNumber).toBe(1);
  });

  it('mantém o contrato anterior e só acrescenta orderNumber', async () => {
    const currentApp = buildApp();
    app = currentApp;

    const created = await post(currentApp);
    expect(Object.keys(created.json()).sort()).toEqual(
      ['createdAt', 'id', 'items', 'orderNumber', 'status', 'table', 'totalCents'].sort(),
    );
    expect(created.json().id).toMatch(/^o_[0-9a-f-]{36}$/);
    expect(typeof created.json().orderNumber).toBe('number');
    expect(created.json()).toMatchObject({
      table: '12',
      status: 'received',
      totalCents: 3290,
      items: [
        {
          productId: 'p1',
          name: 'Burger Clássico',
          quantity: 1,
          unitPriceCents: 3290,
          lineTotalCents: 3290,
        },
      ],
    });

    const detail = await currentApp.inject({ method: 'GET', url: `/orders/${created.json().id}` });
    expect(Object.keys(detail.json()).sort()).toEqual(Object.keys(created.json()).sort());
  });

  it('o reenvio com a mesma Idempotency-Key devolve o mesmo número e não consome outro', async () => {
    const currentApp = buildApp();
    app = currentApp;
    const key = randomUUID();

    const first = await post(currentApp, payload, key);
    const replay = await post(currentApp, payload, key);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(replay.json().orderNumber).toBe(1);

    const next = await post(currentApp);
    expect(next.json().orderNumber).toBe(2);
  });

  it('pedido recusado ou transação desfeita não consome número', async () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);

    const setup = buildApp({ databasePath: path });
    const missing = await post(setup, {
      table: '1',
      items: [{ productId: 'p_nao_existe', quantity: 1 }],
    });
    expect(missing.statusCode).toBe(404);
    await setup.close();

    // Falha depois de o número sair do contador, ainda dentro da transação.
    const db = new DatabaseSync(path);
    db.exec(`CREATE TRIGGER fail_item BEFORE INSERT ON order_items
             BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    db.close();

    const failing = buildApp({ databasePath: path, seed: false, logger: false });
    const aborted = await post(failing);
    expect(aborted.statusCode).toBe(500);
    await failing.close();

    const fix = new DatabaseSync(path);
    fix.exec('DROP TRIGGER fail_item');
    fix.close();

    const currentApp = buildApp({ databasePath: path, seed: false });
    app = currentApp;
    const created = await post(currentApp);
    expect(created.statusCode).toBe(201);
    expect(created.json().orderNumber).toBe(1);
    expect(readRows(path).orders).toHaveLength(1);
  });

  it('o índice UNIQUE recusa número repetido', () => {
    const db = openDatabase({ path: ':memory:' });
    try {
      const insert = db.prepare(
        `INSERT INTO orders (id, order_number, table_label, status, total_cents, created_at)
         VALUES (?, 7, '1', 'received', 0, '2026-11-08T00:00:00.000Z')`,
      );
      insert.run('o_um');
      expect(() => insert.run('o_dois')).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('continua a sequência depois de reiniciar e não reutiliza número apagado', async () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);

    const before = buildApp({ databasePath: path });
    await post(before);
    const second = (await post(before)).json();
    await before.close();

    // O último pedido some fora da API. O número 2 não volta a ser usado.
    const db = new DatabaseSync(path);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(second.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(second.id);
    db.close();

    const currentApp = buildApp({ databasePath: path, seed: false });
    app = currentApp;
    const third = await post(currentApp);
    expect(third.json().orderNumber).toBe(3);
  });

  it('gera números distintos e contíguos com POSTs concorrentes em conexões separadas', async () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);
    const setup = buildApp({ databasePath: path });
    await setup.close();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => postInWorker(path, randomUUID())),
    );

    for (const result of results) {
      expect(result.statusCode, JSON.stringify(result)).toBe(201);
    }
    const numbers = results.map((result) => result.body.orderNumber).sort((a, b) => a! - b!);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readRows(path).sequence).toEqual({ last_value: 6 });
  }, 120_000);

  it('numera pedidos legados pela ordem da fila e preserva itens, valores e chaves', async () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);
    createPreNumberDatabase(path);
    const before = readRowsWithoutSequence(path);

    const currentApp = buildApp({ databasePath: path, seed: false });
    app = currentApp;

    const after = readRows(path);
    // created_at ASC e, no empate, id ASC: o_a, o_b, o_c.
    expect(after.orders.map((order) => [order.id, order.order_number])).toEqual([
      ['o_a', 1],
      ['o_b', 2],
      ['o_c', 3],
    ]);
    expect(
      after.orders.map((order) => {
        const rest: Partial<StoredOrderRow> = { ...order };
        delete rest.order_number;
        return rest;
      }),
    ).toEqual(before.orders);
    expect(after.items).toEqual(before.items);
    expect(after.keys).toEqual(before.keys);
    expect(after.sequence).toEqual({ last_value: 3 });

    const legacy = await currentApp.inject({ method: 'GET', url: '/orders/o_c' });
    expect(legacy.json()).toMatchObject({
      id: 'o_c',
      orderNumber: 3,
      status: 'finished',
      totalCents: 1890,
      items: [{ productId: 'p1', note: 'nota o_c' }],
    });

    // Chave gravada antes do número: o replay devolve o corpo original, sem inventar o campo.
    const replay = await post(
      currentApp,
      { table: '2', items: [{ productId: 'p1', quantity: 1 }] },
      LEGACY_KEY,
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe('o_b');
    expect(replay.json()).not.toHaveProperty('orderNumber');

    const next = await post(currentApp);
    expect(next.json().orderNumber).toBe(4);
  });

  it('abrir o banco de novo não muda nenhum número', async () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);
    createPreNumberDatabase(path);

    openDatabase({ path, seed: false }).close();
    const first = readRows(path);
    openDatabase({ path, seed: false }).close();
    openDatabase({ path, seed: false }).close();

    expect(readRows(path)).toEqual(first);
  });

  it('numera na abertura seguinte um pedido gravado sem número por uma versão anterior', () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);
    createPreNumberDatabase(path);
    openDatabase({ path, seed: false }).close();

    // A versão anterior da API grava sem a coluna nova (rollback de deploy).
    const old = new DatabaseSync(path);
    old
      .prepare(
        `INSERT INTO orders (id, table_label, status, total_cents, created_at)
         VALUES ('o_rollback', '9', 'received', 3290, '2026-11-08T12:00:00.000Z')`,
      )
      .run();
    old.close();

    openDatabase({ path, seed: false }).close();
    const rows = readRows(path);
    expect(rows.orders.find((order) => order.id === 'o_rollback')?.order_number).toBe(4);
    expect(rows.sequence).toEqual({ last_value: 4 });
  });

  it('desfaz a migração inteira quando ela falha no meio', () => {
    const { directory, path } = tempDatabasePath();
    directories.push(directory);
    createPreNumberDatabase(path);
    const before = readRowsWithoutSequence(path);

    // A segunda linha numerada (o_b) falha depois que o_a já recebeu número.
    const db = new DatabaseSync(path);
    db.exec(`CREATE TRIGGER fail_number BEFORE UPDATE ON orders
             WHEN NEW.id = 'o_b'
             BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    db.close();

    expect(() => openDatabase({ path, seed: false })).toThrow(/falha simulada/);
    expect(hasColumn(path, 'order_number')).toBe(false);
    expect(readRowsWithoutSequence(path)).toEqual(before);

    const fix = new DatabaseSync(path);
    fix.exec('DROP TRIGGER fail_number');
    fix.close();

    openDatabase({ path, seed: false }).close();
    expect(readRows(path).orders.map((order) => order.order_number)).toEqual([1, 2, 3]);
  });
});

/** Leitura do banco antigo, que ainda não tem a tabela do contador. */
function readRowsWithoutSequence(path: string): {
  orders: unknown[];
  items: unknown[];
  keys: unknown[];
} {
  const db = new DatabaseSync(path);
  try {
    return {
      orders: db.prepare('SELECT * FROM orders ORDER BY id').all(),
      items: db.prepare('SELECT * FROM order_items ORDER BY id').all(),
      keys: db.prepare('SELECT * FROM idempotency_keys ORDER BY key').all(),
    };
  } finally {
    db.close();
  }
}
