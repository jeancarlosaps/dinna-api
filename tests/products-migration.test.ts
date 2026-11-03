import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        table: '4',
        status: 'received',
        items: [{ productId: 'p_legacy', quantity: 1, note: 'sem molho' }],
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
