import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const LEGACY_SQL = `
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
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
`;

function updateProductInWorker(
  databasePath: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: { ingredients?: string[] } }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      pathToFileURL(join(process.cwd(), 'tests/helpers/update-product-worker.ts')),
      {
        execArgv: ['--import', 'tsx'],
        workerData: { databasePath, productId: 'p_legacy', payload },
      },
    );
    let result: { statusCode: number; body: { ingredients?: string[] } } | undefined;

    worker.on('message', (message: { statusCode: number; body: { ingredients?: string[] } }) => {
      result = message;
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker encerrou com código ${code}`));
        return;
      }
      if (!result) {
        reject(new Error('worker encerrou sem resultado'));
        return;
      }
      resolve(result);
    });
  });
}

function openDatabaseInWorker(databasePath: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      pathToFileURL(join(process.cwd(), 'tests/helpers/open-database-worker.ts')),
      { execArgv: ['--import', 'tsx'], workerData: { databasePath } },
    );
    let result: { ok: boolean; message?: string } | undefined;

    worker.on('message', (message: { ok: boolean; message?: string }) => {
      result = message;
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker encerrou com código ${code}`));
        return;
      }
      if (!result) {
        reject(new Error('worker encerrou sem resultado'));
        return;
      }
      resolve(result);
    });
  });
}

describe('migração de ingredients em banco já existente', () => {
  const directories: string[] = [];
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createLegacyDatabase(): string {
    const directory = mkdtempSync(join(tmpdir(), 'dinna-ingredients-'));
    directories.push(directory);
    const path = join(directory, 'dinna.sqlite');
    const db = new DatabaseSync(path);
    db.exec(LEGACY_SQL);
    db.prepare(
      `INSERT INTO products (id, name, description, category, price_cents, image_url, available)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('p_legacy', 'Prato antigo', 'Descrição já gravada', 'burgers', 2500, null, 1);
    db.prepare(
      `INSERT INTO orders (id, table_label, status, total_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('o_legacy', '4', 'received', 2500, '2026-10-16T18:00:00.000Z');
    db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, note)
       VALUES (?, ?, ?, ?)`,
    ).run('o_legacy', 'p_legacy', 1, 'sem molho');
    db.close();
    return path;
  }

  async function openApp(path: string): Promise<FastifyInstance> {
    await app?.close();
    app = buildApp({ databasePath: path, seed: false });
    return app;
  }

  it('preserva produto e pedido antigos e passa a responder ingredients vazio', async () => {
    const path = createLegacyDatabase();
    const currentApp = await openApp(path);

    const product = await currentApp.inject({ method: 'GET', url: '/products/p_legacy' });
    expect(product.statusCode).toBe(200);
    expect(product.json()).toMatchObject({
      id: 'p_legacy',
      name: 'Prato antigo',
      description: 'Descrição já gravada',
      category: 'burgers',
      priceCents: 2500,
      imageUrl: null,
      available: true,
      ingredients: [],
    });

    const orders = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(orders.statusCode).toBe(200);
    expect(orders.json()).toEqual([
      {
        id: 'o_legacy',
        orderNumber: 1,
        table: '4',
        status: 'received',
        items: [
          {
            productId: 'p_legacy',
            name: 'Prato antigo',
            quantity: 1,
            unitPriceCents: 2500,
            lineTotalCents: 2500,
            note: 'sem molho',
          },
        ],
        totalCents: 2500,
        createdAt: '2026-10-16T18:00:00.000Z',
      },
    ]);

    const another = await currentApp.inject({
      method: 'POST',
      url: '/orders',
      payload: { table: '9', items: [{ productId: 'p_legacy', quantity: 2 }] },
    });
    expect(another.statusCode).toBe(201);
    expect(another.json()).toMatchObject({ table: '9', totalCents: 5000, status: 'received' });
  });

  it('mantém ingredients depois de fechar e reabrir o arquivo', async () => {
    const path = createLegacyDatabase();
    const currentApp = await openApp(path);

    const updated = await currentApp.inject({
      method: 'PUT',
      url: '/products/p_legacy',
      payload: {
        name: 'Prato antigo',
        description: 'Descrição já gravada',
        category: 'burgers',
        priceCents: 2500,
        imageUrl: null,
        available: true,
        ingredients: ['Pão', 'Queijo cheddar'],
      },
    });
    expect(updated.statusCode).toBe(200);

    const reopened = await openApp(path);
    const detail = await reopened.inject({ method: 'GET', url: '/products/p_legacy' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().ingredients).toEqual(['Pão', 'Queijo cheddar']);

    const preserved = await reopened.inject({
      method: 'PUT',
      url: '/products/p_legacy',
      payload: {
        name: 'Prato antigo',
        description: 'Descrição já gravada',
        category: 'burgers',
        priceCents: 2600,
        available: true,
      },
    });
    expect(preserved.statusCode).toBe(200);
    expect(preserved.json()).toMatchObject({
      priceCents: 2600,
      ingredients: ['Pão', 'Queijo cheddar'],
    });

    const orders = await reopened.inject({ method: 'GET', url: '/orders' });
    expect(orders.statusCode).toBe(200);
    expect(orders.json()[0].id).toBe('o_legacy');
  });

  it('não deixa um PUT sem ingredients regravar uma composição concorrente', async () => {
    const path = createLegacyDatabase();
    const currentApp = await openApp(path);
    const seeded = await currentApp.inject({
      method: 'PUT',
      url: '/products/p_legacy',
      payload: {
        name: 'Prato antigo',
        description: 'Descrição já gravada',
        category: 'burgers',
        priceCents: 2500,
        available: true,
        ingredients: ['Pão'],
      },
    });
    expect(seeded.statusCode).toBe(200);
    await currentApp.close();
    app = undefined;

    const base = {
      description: 'Descrição já gravada',
      category: 'burgers',
      priceCents: 2500,
      available: true,
    };
    const [withIngredients, omitted] = await Promise.all([
      updateProductInWorker(path, {
        ...base,
        name: 'Composto',
        ingredients: ['Queijo cheddar'],
      }),
      updateProductInWorker(path, { ...base, name: 'Renomeado' }),
    ]);

    expect(withIngredients.statusCode).toBe(200);
    expect(omitted.statusCode).toBe(200);

    const reopened = await openApp(path);
    const detail = await reopened.inject({ method: 'GET', url: '/products/p_legacy' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().ingredients).toEqual(['Queijo cheddar']);
  });

  it('abre o banco antigo em paralelo sem falhar na coluna nova', async () => {
    const path = createLegacyDatabase();

    const results = await Promise.all([openDatabaseInWorker(path), openDatabaseInWorker(path)]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });

  it('não confirma outro campo quando a lista persistida é inválida', async () => {
    const path = createLegacyDatabase();
    await openApp(path);
    await app?.close();
    app = undefined;

    const db = new DatabaseSync(path);
    db.prepare('UPDATE products SET ingredients = ? WHERE id = ?').run('[" "]', 'p_legacy');
    db.close();

    const currentApp = await openApp(path);
    const updated = await currentApp.inject({
      method: 'PUT',
      url: '/products/p_legacy',
      payload: {
        name: 'Nome novo',
        description: 'Descrição já gravada',
        category: 'burgers',
        priceCents: 2600,
        available: true,
      },
    });
    expect(updated.statusCode).toBe(500);
    await currentApp.close();
    app = undefined;

    const check = new DatabaseSync(path);
    const row = check
      .prepare('SELECT name, price_cents FROM products WHERE id = ?')
      .get('p_legacy') as {
      name: string;
      price_cents: number;
    };
    check.close();
    expect(row).toEqual({ name: 'Prato antigo', price_cents: 2500 });
  });

  it('não grava total de migração fora da faixa segura e tenta de novo depois', async () => {
    const path = createLegacyDatabase();
    const db = new DatabaseSync(path);
    db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(2, 'p_legacy');
    db.prepare('UPDATE orders SET total_cents = ? WHERE id = ?').run(
      Number.MAX_SAFE_INTEGER,
      'o_legacy',
    );
    db.prepare('UPDATE order_items SET quantity = ?, note = NULL WHERE order_id = ?').run(
      Number.MAX_SAFE_INTEGER,
      'o_legacy',
    );
    db.close();

    const currentApp = await openApp(path);
    const listed = await currentApp.inject({ method: 'GET', url: '/orders' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      {
        id: 'o_legacy',
        orderNumber: 1,
        table: '4',
        status: 'received',
        items: [],
        totalCents: Number.MAX_SAFE_INTEGER,
        createdAt: '2026-10-16T18:00:00.000Z',
      },
    ]);

    const detail = await currentApp.inject({ method: 'GET', url: '/orders/o_legacy' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().items).toEqual([]);

    const patched = await currentApp.inject({
      method: 'PATCH',
      url: '/orders/o_legacy/status',
      payload: { status: 'preparing' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ id: 'o_legacy', status: 'preparing', items: [] });
    await currentApp.close();
    app = undefined;

    const blocked = new DatabaseSync(path);
    const blockedItem = blocked
      .prepare(
        `SELECT product_name, unit_price_cents, line_total_cents, quantity
         FROM order_items WHERE order_id = ?`,
      )
      .get('o_legacy') as {
      product_name: string;
      unit_price_cents: number | null;
      line_total_cents: number | null;
      quantity: number;
    };
    expect(blockedItem).toEqual({
      product_name: 'Prato antigo',
      unit_price_cents: null,
      line_total_cents: null,
      quantity: Number.MAX_SAFE_INTEGER,
    });
    blocked.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(1, 'p_legacy');
    blocked.close();

    const reconciled = await openApp(path);
    const recovered = await reconciled.inject({ method: 'GET', url: '/orders/o_legacy' });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().items).toEqual([
      {
        productId: 'p_legacy',
        name: 'Prato antigo',
        quantity: Number.MAX_SAFE_INTEGER,
        unitPriceCents: 1,
        lineTotalCents: Number.MAX_SAFE_INTEGER,
      },
    ]);
  });

  it('migra quantidade no limite seguro quando o preço unitário é 1', async () => {
    const path = createLegacyDatabase();
    const db = new DatabaseSync(path);
    db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(1, 'p_legacy');
    db.prepare('UPDATE orders SET total_cents = ? WHERE id = ?').run(
      Number.MAX_SAFE_INTEGER,
      'o_legacy',
    );
    db.prepare('UPDATE order_items SET quantity = ? WHERE order_id = ?').run(
      Number.MAX_SAFE_INTEGER,
      'o_legacy',
    );
    db.close();

    const currentApp = await openApp(path);
    const detail = await currentApp.inject({ method: 'GET', url: '/orders/o_legacy' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().items).toEqual([
      {
        productId: 'p_legacy',
        name: 'Prato antigo',
        quantity: Number.MAX_SAFE_INTEGER,
        unitPriceCents: 1,
        lineTotalCents: Number.MAX_SAFE_INTEGER,
        note: 'sem molho',
      },
    ]);
  });

  it('não transforma JSON persistido inválido em lista vazia', async () => {
    const path = createLegacyDatabase();
    await openApp(path);
    await app?.close();
    app = undefined;

    const db = new DatabaseSync(path);
    db.prepare('UPDATE products SET ingredients = ? WHERE id = ?').run('[" "]', 'p_legacy');
    db.close();

    const currentApp = await openApp(path);
    const detail = await currentApp.inject({ method: 'GET', url: '/products/p_legacy' });
    expect(detail.statusCode).toBe(500);
    expect(detail.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
  });
});
