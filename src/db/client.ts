import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { insertProduct } from '../modules/products/products.repository.js';
import { SCHEMA_SQL } from './schema.js';
import { SEED_PRODUCTS } from './seed.js';

export type Db = DatabaseSync;

/**
 * Tempo máximo de espera por um lock de escrita.
 * Sem isso, dois POST /orders simultâneos com a mesma chave recebem SQLITE_BUSY
 * em vez de serializar na transação.
 */
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface OpenDatabaseOptions {
  /** Caminho do arquivo ou `:memory:` (padrão nos testes). */
  path: string;
  /** Se true, popula o cardápio quando a tabela products estiver vazia. */
  seed?: boolean;
}

export function openDatabase(options: OpenDatabaseOptions): Db {
  const { path, seed = true } = options;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec(SCHEMA_SQL);
  ensureProductIngredientsColumn(db);
  migrateOrderItemsSnapshot(db);
  migrateOrderNumbers(db);

  if (seed) {
    seedProductsIfEmpty(db);
  }

  return db;
}

/**
 * `CREATE TABLE IF NOT EXISTS` não adiciona coluna em banco já existente.
 * A coluna guarda um JSON array. Produtos antigos passam a `[]` pelo DEFAULT,
 * sem recriar o arquivo e sem alterar pedidos.
 *
 * `BEGIN IMMEDIATE` segura o lock de escrita. Sem isso, duas aberturas do mesmo
 * banco antigo podem ver a coluna ausente e a segunda quebra com
 * "duplicate column name".
 */
function ensureProductIngredientsColumn(db: Db): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!productsTableHasIngredients(db)) {
      db.exec("ALTER TABLE products ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function productsTableHasIngredients(db: Db): boolean {
  const columns = db.prepare('PRAGMA table_info(products)').all() as unknown as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === 'ingredients');
}

interface OrderItemSnapshotRow {
  id: number;
  product_id: string;
  quantity: number;
  product_name: string | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
}

/**
 * `unitPrice * quantity` só entra no banco se o resultado for inteiro seguro.
 * Fora dessa faixa o `node:sqlite` não consegue ler a coluna.
 */
function safeLineTotalCents(unitPriceCents: number, quantity: number): number | undefined {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
    return undefined;
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return undefined;
  }

  const lineTotalCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(lineTotalCents)) {
    return undefined;
  }

  return lineTotalCents;
}

/**
 * Bancos criados antes do snapshot recebem as colunas na abertura.
 * Linhas antigas são preenchidas a partir do cardápio atual (melhor esforço).
 * Preço vezes quantidade fora da faixa segura não é gravado e não é substituído
 * por outro número. A linha fica sem esses dois campos e a abertura seguinte tenta de novo.
 */
function migrateOrderItemsSnapshot(db: Db): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(order_items)').all() as unknown as Array<{
      name: string;
    }>;
    const names = new Set(columns.map((column) => column.name));

    if (!names.has('product_name')) {
      db.exec('ALTER TABLE order_items ADD COLUMN product_name TEXT');
    }
    if (!names.has('unit_price_cents')) {
      db.exec('ALTER TABLE order_items ADD COLUMN unit_price_cents INTEGER');
    }
    if (!names.has('line_total_cents')) {
      db.exec('ALTER TABLE order_items ADD COLUMN line_total_cents INTEGER');
    }

    backfillOrderItemSnapshots(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function backfillOrderItemSnapshots(db: Db): void {
  const items = db
    .prepare(
      `SELECT id, product_id, quantity, product_name, unit_price_cents, line_total_cents
       FROM order_items
       WHERE product_name IS NULL OR unit_price_cents IS NULL OR line_total_cents IS NULL`,
    )
    .all() as unknown as OrderItemSnapshotRow[];
  const findProduct = db.prepare('SELECT name, price_cents FROM products WHERE id = ?');
  const updateSnapshot = db.prepare(
    `UPDATE order_items
     SET product_name = ?, unit_price_cents = ?, line_total_cents = ?
     WHERE id = ?`,
  );
  const updateName = db.prepare('UPDATE order_items SET product_name = ? WHERE id = ?');

  for (const item of items) {
    const product = findProduct.get(item.product_id) as unknown as
      { name: string; price_cents: number } | undefined;
    const productName = item.product_name ?? product?.name ?? 'Produto';
    const unitPriceCents = item.unit_price_cents ?? product?.price_cents ?? 0;
    const lineTotalCents =
      item.line_total_cents ?? safeLineTotalCents(unitPriceCents, item.quantity);

    if (lineTotalCents === undefined) {
      if (item.product_name === null) {
        updateName.run(productName, item.id);
      }
      continue;
    }

    updateSnapshot.run(productName, unitPriceCents, lineTotalCents, item.id);
  }
}

/**
 * Dá número público a todo pedido sem número e alinha o contador.
 *
 * Banco antigo recebe a coluna. Pedidos sem número são numerados na ordem da
 * fila (`created_at`, depois `id`), a partir do maior número já usado. O id,
 * os itens, o status, o total e as chaves de idempotência não mudam.
 *
 * Tudo roda em `BEGIN IMMEDIATE`: uma falha desfaz a coluna, os números e o
 * contador juntos, e duas aberturas simultâneas não numeram a mesma linha.
 * Rodar de novo não altera nada. Pedido gravado sem número por uma versão
 * anterior da API (rollback) recebe o próximo número na abertura seguinte.
 */
function migrateOrderNumbers(db: Db): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(orders)').all() as unknown as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'order_number')) {
      db.exec('ALTER TABLE orders ADD COLUMN order_number INTEGER CHECK (order_number >= 1)');
    }

    const sequence = db
      .prepare('SELECT last_value FROM order_number_sequence WHERE id = 1')
      .get() as unknown as { last_value: number } | undefined;
    const used = db.prepare('SELECT MAX(order_number) AS max FROM orders').get() as unknown as {
      max: number | null;
    };
    let lastValue = Math.max(sequence?.last_value ?? 0, used.max ?? 0);

    const unnumbered = db
      .prepare('SELECT id FROM orders WHERE order_number IS NULL ORDER BY created_at ASC, id ASC')
      .all() as unknown as Array<{ id: string }>;
    const assign = db.prepare('UPDATE orders SET order_number = ? WHERE id = ?');
    for (const order of unnumbered) {
      lastValue += 1;
      assign.run(lastValue, order.id);
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number)');
    db.prepare(
      `INSERT INTO order_number_sequence (id, last_value) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_value = MAX(last_value, excluded.last_value)`,
    ).run(lastValue);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Insere o cardápio só quando `products` está vazia.
 * Linha já gravada não é atualizada. Ingredientes ilustrativos de um banco
 * antigo entram por `demo:ingredients`, nunca nesta abertura.
 */
function seedProductsIfEmpty(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get() as unknown as {
    count: number;
  };
  if (row.count > 0) {
    return;
  }

  db.exec('BEGIN');
  try {
    for (const product of SEED_PRODUCTS) {
      insertProduct(db, product);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
