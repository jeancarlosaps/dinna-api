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

  if (seed) {
    seedProductsIfEmpty(db);
  }

  return db;
}

/**
 * `CREATE TABLE IF NOT EXISTS` não adiciona coluna em banco já existente.
 * A coluna guarda um JSON array. Produtos antigos passam a `[]` pelo DEFAULT,
 * sem recriar o arquivo e sem alterar pedidos.
 */
function ensureProductIngredientsColumn(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(products)').all() as unknown as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === 'ingredients')) {
    return;
  }

  db.exec("ALTER TABLE products ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'");
}

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
