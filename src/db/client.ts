import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { SEED_PRODUCTS } from './seed.js';

export type Db = DatabaseSync;

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
  db.exec(SCHEMA_SQL);

  if (seed) {
    seedProductsIfEmpty(db);
  }

  return db;
}

function seedProductsIfEmpty(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get() as unknown as {
    count: number;
  };
  if (row.count > 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO products (id, name, description, category, price_cents, image_url, available)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const product of SEED_PRODUCTS) {
      insert.run(
        product.id,
        product.name,
        product.description,
        product.category,
        product.priceCents,
        product.imageUrl,
        product.available ? 1 : 0,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
