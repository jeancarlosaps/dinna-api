import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase, type Db } from '../src/db/client.js';
import {
  assertDemoIngredientsDatabasePath,
  backfillDemoIngredients,
  DemoIngredientsRefusedError,
  DemoIngredientsUsageError,
  openDemoIngredientsDatabase,
  parseDemoIngredientArgs,
  type DemoIngredientReport,
} from '../src/db/demo-ingredients.js';
import { SEED_PRODUCTS } from '../src/db/seed.js';
import type { Product } from '../src/db/types.js';

interface StoredProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  image_url: string | null;
  available: number;
  ingredients: string;
}

interface DatabaseSnapshot {
  products: StoredProduct[];
  orders: unknown[];
  items: unknown[];
  keys: unknown[];
}

function seedById(id: string): Product {
  const product = SEED_PRODUCTS.find((item) => item.id === id);
  if (!product) {
    throw new Error(`produto de seed ausente: ${id}`);
  }
  return product;
}

function snapshot(path: string): DatabaseSnapshot {
  const db = new DatabaseSync(path);
  try {
    return {
      products: db
        .prepare(
          `SELECT id, name, description, category, price_cents, image_url, available, ingredients
           FROM products ORDER BY id`,
        )
        .all() as unknown as StoredProduct[],
      orders: db.prepare('SELECT * FROM orders ORDER BY id').all(),
      items: db.prepare('SELECT * FROM order_items ORDER BY id').all(),
      keys: db.prepare('SELECT * FROM idempotency_keys ORDER BY key').all(),
    };
  } finally {
    db.close();
  }
}

function withoutIngredients(
  products: readonly StoredProduct[],
): Omit<StoredProduct, 'ingredients'>[] {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price_cents: product.price_cents,
    image_url: product.image_url,
    available: product.available,
  }));
}

function insertEmptySeedProduct(db: Db, product: Product, ingredients = '[]'): void {
  db.prepare(
    `INSERT INTO products (id, name, description, category, price_cents, image_url, available, ingredients)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    product.id,
    product.name,
    product.description,
    product.category,
    product.priceCents,
    product.imageUrl,
    product.available ? 1 : 0,
    ingredients,
  );
}

function createRawDatabase(setup: (db: DatabaseSync) => void): string {
  const directory = mkdtempSync(join(tmpdir(), 'dinna-demo-ingredients-'));
  directories.push(directory);
  const path = join(directory, 'dinna.sqlite');
  const db = new DatabaseSync(path);
  try {
    setup(db);
  } finally {
    db.close();
  }
  return path;
}

function createDatabase(setup: (db: Db) => void): string {
  const directory = mkdtempSync(join(tmpdir(), 'dinna-demo-ingredients-'));
  directories.push(directory);
  const path = join(directory, 'dinna.sqlite');
  const db = openDatabase({ path, seed: false });
  try {
    setup(db);
  } finally {
    db.close();
  }
  return path;
}

function createOldCatalog(): string {
  return createDatabase((db) => {
    for (const product of SEED_PRODUCTS) {
      insertEmptySeedProduct(db, product);
    }

    db.prepare(
      `UPDATE products
       SET name = ?, ingredients = ?
       WHERE id = 'p2'`,
    ).run('Burger do Gabriel', '["Queijo do Gabriel"]');
    db.prepare(`UPDATE products SET ingredients = ? WHERE id = 'p3'`).run('["Batata doce"]');
    db.prepare(`UPDATE products SET description = ?, price_cents = ? WHERE id = 'p4'`).run(
      'Porção editada',
      999,
    );
    db.prepare(`UPDATE products SET ingredients = ? WHERE id = 'p6'`).run('["Laranja"]');
    db.prepare(
      `INSERT INTO products (id, name, description, category, price_cents, image_url, available, ingredients)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'p_custom',
      'Burger Clássico',
      'Receita da casa',
      'burgers',
      1000,
      null,
      1,
      '["Receita própria"]',
    );

    db.prepare(
      `INSERT INTO orders (id, order_number, table_label, status, total_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('o_demo', 1, '7', 'preparing', 3290, '2026-10-20T12:00:00.000Z');
    db.prepare(
      `INSERT INTO order_items (
         order_id, product_id, product_name, unit_price_cents, line_total_cents, quantity, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('o_demo', 'p1', 'Burger Clássico', 3290, 3290, 1, 'sem cebola');
    db.prepare(
      `INSERT INTO idempotency_keys (key, request_hash, order_id, created_at, response_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      '11111111-1111-4111-8111-111111111111',
      'hash-demo',
      'o_demo',
      '2026-10-20T12:00:00.000Z',
      '{"id":"o_demo","status":"received"}',
    );
  });
}

function runBackfill(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/db/backfill-demo-ingredients.ts', ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  );

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const directories: string[] = [];
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ingredientes ilustrativos do cardápio de demonstração', () => {
  it('banco novo devolve o seed em GET /products e GET /products/:id', async () => {
    expect(
      SEED_PRODUCTS.filter((product) => product.ingredients.length === 0).map(
        (product) => product.id,
      ),
    ).toEqual(['p5', 'p6']);

    app = buildApp();
    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.statusCode).toBe(200);

    const byId = new Map((list.json() as Product[]).map((product) => [product.id, product]));
    expect(byId.size).toBe(SEED_PRODUCTS.length);

    for (const seed of SEED_PRODUCTS) {
      expect(byId.get(seed.id)).toEqual(seed);
    }

    const classic = await app.inject({ method: 'GET', url: '/products/p1' });
    expect(classic.statusCode).toBe(200);
    expect(classic.json()).toEqual(seedById('p1'));

    const brownie = await app.inject({ method: 'GET', url: '/products/p7' });
    expect(brownie.json().ingredients).toEqual([
      'Chocolate',
      'Farinha de trigo',
      'Ovos',
      'Manteiga',
      'Açúcar',
      'Calda de chocolate',
    ]);

    const soda = await app.inject({ method: 'GET', url: '/products/p5' });
    const juice = await app.inject({ method: 'GET', url: '/products/p6' });
    expect(soda.json().ingredients).toEqual([]);
    expect(juice.json().ingredients).toEqual([]);
  });

  it('abrir um banco que já tem produtos não preenche ingredients nem altera pedidos', async () => {
    const path = createOldCatalog();
    const before = snapshot(path);

    app = buildApp({ databasePath: path, seed: true });
    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(SEED_PRODUCTS.length + 1);
    expect(list.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'p1', ingredients: [] }),
        expect.objectContaining({ id: 'p5', ingredients: [] }),
        expect.objectContaining({ id: 'p_custom', ingredients: ['Receita própria'] }),
      ]),
    );

    const orders = await app.inject({ method: 'GET', url: '/orders' });
    expect(orders.statusCode).toBe(200);
    expect(orders.json()).toEqual([
      {
        id: 'o_demo',
        orderNumber: 1,
        table: '7',
        status: 'preparing',
        items: [
          {
            productId: 'p1',
            name: 'Burger Clássico',
            quantity: 1,
            unitPriceCents: 3290,
            lineTotalCents: 3290,
            note: 'sem cebola',
          },
        ],
        totalCents: 3290,
        createdAt: '2026-10-20T12:00:00.000Z',
      },
    ]);

    await app.close();
    app = undefined;
    expect(snapshot(path)).toEqual(before);
  });

  it('atualiza só produtos elegíveis, preserva o resto e pode rodar de novo', async () => {
    const path = createOldCatalog();
    const before = snapshot(path);
    const db = openDatabase({ path, seed: false });

    let preview: DemoIngredientReport;
    let applied: DemoIngredientReport;
    let repeated: DemoIngredientReport;
    try {
      preview = backfillDemoIngredients(db, { apply: false });
      expect(snapshot(path)).toEqual(before);

      applied = backfillDemoIngredients(db, { apply: true });
    } finally {
      db.close();
    }

    const after = snapshot(path);
    const again = openDatabase({ path, seed: false });
    try {
      repeated = backfillDemoIngredients(again, { apply: true });
    } finally {
      again.close();
    }

    const expectedIds = ['p1', 'p4', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'];
    expect(preview.mode).toBe('dry-run');
    expect(applied.mode).toBe('applied');
    expect(preview.updates.map((update) => update.id)).toEqual(expectedIds);
    expect(applied.updates.map((update) => update.id)).toEqual(expectedIds);
    expect(applied.updates.map((update) => update.ingredients)).toEqual(
      expectedIds.map((id) => [...seedById(id).ingredients]),
    );
    expect(preview.skipped).toEqual([
      {
        id: 'p2',
        name: 'Burger Smoke',
        reason: 'identity',
        foundName: 'Burger do Gabriel',
      },
      { id: 'p3', name: 'Batata Rústica', reason: 'already-set' },
      { id: 'p5', name: 'Refrigerante Lata', reason: 'illustrative-empty' },
      { id: 'p6', name: 'Suco Natural', reason: 'already-set' },
    ]);
    expect(repeated.updates).toEqual([]);
    expect(snapshot(path)).toEqual(after);
    expect(after.orders).toEqual(before.orders);
    expect(after.items).toEqual(before.items);
    expect(after.keys).toEqual(before.keys);
    expect(withoutIngredients(after.products)).toEqual(withoutIngredients(before.products));

    const stored = new Map(after.products.map((product) => [product.id, product]));
    expect(stored.get('p1')?.ingredients).toBe(JSON.stringify(seedById('p1').ingredients));
    expect(stored.get('p4')).toMatchObject({
      description: 'Porção editada',
      price_cents: 999,
      ingredients: JSON.stringify(seedById('p4').ingredients),
    });
    expect(stored.get('p8')).toMatchObject({
      available: 0,
      ingredients: JSON.stringify(seedById('p8').ingredients),
    });
    expect(stored.get('p2')).toMatchObject({
      name: 'Burger do Gabriel',
      ingredients: '["Queijo do Gabriel"]',
    });
    expect(stored.get('p3')?.ingredients).toBe('["Batata doce"]');
    expect(stored.get('p5')?.ingredients).toBe('[]');
    expect(stored.get('p6')?.ingredients).toBe('["Laranja"]');
    expect(stored.get('p_custom')).toMatchObject({
      name: 'Burger Clássico',
      ingredients: '["Receita própria"]',
    });

    app = buildApp({ databasePath: path, seed: true });
    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.statusCode).toBe(200);
    const listed = new Map((list.json() as Product[]).map((product) => [product.id, product]));
    expect(listed.get('p1')?.ingredients).toEqual(seedById('p1').ingredients);
    expect(listed.get('p4')).toMatchObject({
      description: 'Porção editada',
      priceCents: 999,
      ingredients: seedById('p4').ingredients,
    });
    expect(listed.get('p5')?.ingredients).toEqual([]);
    expect(listed.get('p6')?.ingredients).toEqual(['Laranja']);
    expect(listed.get('p2')).toMatchObject({
      name: 'Burger do Gabriel',
      ingredients: ['Queijo do Gabriel'],
    });
    expect(listed.get('p_custom')?.ingredients).toEqual(['Receita própria']);

    const detail = await app.inject({ method: 'GET', url: '/products/p1' });
    const empty = await app.inject({ method: 'GET', url: '/products/p5' });
    expect(detail.json().ingredients).toEqual(seedById('p1').ingredients);
    expect(empty.json().ingredients).toEqual([]);

    const orders = await app.inject({ method: 'GET', url: '/orders' });
    expect(orders.json()).toEqual([
      {
        id: 'o_demo',
        orderNumber: 1,
        table: '7',
        status: 'preparing',
        items: [
          {
            productId: 'p1',
            name: 'Burger Clássico',
            quantity: 1,
            unitPriceCents: 3290,
            lineTotalCents: 3290,
            note: 'sem cebola',
          },
        ],
        totalCents: 3290,
        createdAt: '2026-10-20T12:00:00.000Z',
      },
    ]);
  });

  it('não insere produtos ausentes e não normaliza a lista vazia de propósito', () => {
    const path = createDatabase((db) => {
      insertEmptySeedProduct(db, seedById('p3'), '[ ]');
      insertEmptySeedProduct(db, seedById('p5'), '[ ]');
      insertEmptySeedProduct(db, seedById('p9'), 'nao-json');
    });

    const db = openDatabase({ path, seed: true });
    let report: DemoIngredientReport;
    try {
      report = backfillDemoIngredients(db, { apply: true });
    } finally {
      db.close();
    }

    expect(report.updates.map((update) => update.id)).toEqual(['p3']);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { id: 'p5', name: 'Refrigerante Lata', reason: 'illustrative-empty' },
        { id: 'p1', name: 'Burger Clássico', reason: 'missing' },
        { id: 'p9', name: 'Burger Cheddar Duplo', reason: 'invalid' },
      ]),
    );

    const after = snapshot(path);
    expect(after.products).toHaveLength(3);
    const stored = new Map(after.products.map((product) => [product.id, product]));
    expect(stored.get('p3')?.ingredients).toBe(JSON.stringify(seedById('p3').ingredients));
    expect(stored.get('p5')?.ingredients).toBe('[ ]');
    expect(stored.get('p9')?.ingredients).toBe('nao-json');
    expect(after.orders).toEqual([]);
    expect(after.keys).toEqual([]);
  });

  it('recusa gravar em produção e mantém a prévia', () => {
    const path = createDatabase((db) => {
      insertEmptySeedProduct(db, seedById('p1'));
    });
    const before = snapshot(path);
    const db = openDatabase({ path, seed: false });

    try {
      expect(() =>
        backfillDemoIngredients(db, {
          apply: true,
          env: { NODE_ENV: 'production' },
        }),
      ).toThrow(DemoIngredientsRefusedError);

      const preview = backfillDemoIngredients(db, {
        apply: false,
        env: { NODE_ENV: 'production' },
      });
      expect(preview.updates.map((update) => update.id)).toEqual(['p1']);
      expect(snapshot(path)).toEqual(before);
    } finally {
      db.close();
    }

    expect(snapshot(path).products[0]?.ingredients).toBe('[]');
  });

  it('recusa argumentos e caminhos que não devem gravar', () => {
    expect(parseDemoIngredientArgs([])).toEqual({ apply: false });
    expect(parseDemoIngredientArgs(['--dry-run'])).toEqual({ apply: false });
    expect(parseDemoIngredientArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseDemoIngredientArgs(['--apply', '--dry-run'])).toThrow(
      DemoIngredientsUsageError,
    );
    expect(() => parseDemoIngredientArgs(['--allow-production'])).toThrow(
      DemoIngredientsUsageError,
    );
    expect(() => parseDemoIngredientArgs(['--force'])).toThrow(DemoIngredientsUsageError);
    expect(() => assertDemoIngredientsDatabasePath(':memory:')).toThrow(DemoIngredientsUsageError);
  });

  it('o comando não cria arquivo ausente e só grava com --apply', () => {
    const missing = join(tmpdir(), `dinna-ausente-${Date.now()}.sqlite`);
    const refused = runBackfill([], {
      DATABASE_PATH: missing,
      NODE_ENV: 'development',
      PORT: '3333',
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('não cria nem apaga');
    expect(existsSync(missing)).toBe(false);

    const path = createDatabase((db) => {
      insertEmptySeedProduct(db, seedById('p1'));
      insertEmptySeedProduct(db, seedById('p5'));
    });
    const env = { DATABASE_PATH: path, NODE_ENV: 'development', PORT: '3333' };

    const preview = runBackfill([], env);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain('Modo: prévia');
    expect(preview.stdout).toContain('p1 Burger Clássico');
    expect(snapshot(path).products.find((product) => product.id === 'p1')?.ingredients).toBe('[]');

    const blocked = runBackfill(['--apply'], { ...env, NODE_ENV: 'production' });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('NODE_ENV=production');
    expect(snapshot(path).products.find((product) => product.id === 'p1')?.ingredients).toBe('[]');

    const bypass = runBackfill(['--apply', '--allow-production'], {
      ...env,
      NODE_ENV: 'production',
    });
    expect(bypass.status).toBe(1);
    expect(bypass.stderr).toContain('Argumento desconhecido');
    expect(snapshot(path).products.find((product) => product.id === 'p1')?.ingredients).toBe('[]');

    const applied = runBackfill(['--apply'], env);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('Modo: aplicado');
    expect(snapshot(path).products.find((product) => product.id === 'p1')?.ingredients).toBe(
      JSON.stringify(seedById('p1').ingredients),
    );
    expect(snapshot(path).products.find((product) => product.id === 'p5')?.ingredients).toBe('[]');

    const again = runBackfill(['--apply'], env);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('Atualizados: 0');
  });

  it('prévia e gravação recusam banco sem a coluna e não migram o schema', () => {
    const path = createRawDatabase((raw) => {
      raw.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          price_cents INTEGER NOT NULL,
          image_url TEXT,
          available INTEGER NOT NULL
        );
      `);
      raw
        .prepare(
          `INSERT INTO products (id, name, description, category, price_cents, image_url, available)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'p1',
          'Burger Clássico',
          'Pão brioche, blend 180g, queijo cheddar e salada',
          'burgers',
          3290,
          null,
          1,
        );
    });

    expect(() => openDemoIngredientsDatabase(path, true)).toThrow(DemoIngredientsUsageError);
    expect(() => openDemoIngredientsDatabase(path, false)).toThrow(DemoIngredientsUsageError);

    const env = { DATABASE_PATH: path, NODE_ENV: 'development', PORT: '3333' };
    const preview = runBackfill([], env);
    const applied = runBackfill(['--apply'], env);
    expect(preview.status).toBe(1);
    expect(applied.status).toBe(1);
    expect(preview.stderr).toContain('não criam tabela nem coluna');
    expect(applied.stderr).toContain('não criam tabela nem coluna');

    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(products)').all() as unknown as Array<{
        name: string;
      }>;
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
      expect(columns.some((column) => column.name === 'ingredients')).toBe(false);
      expect(tables).toEqual([{ name: 'products' }]);
    } finally {
      db.close();
    }
  });
});
