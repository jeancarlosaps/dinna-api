import { randomBytes } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { Product, ProductInput, ProductListQuery } from '../../db/types.js';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  image_url: string | null;
  available: number;
}

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    available: row.available === 1,
  };
}

function newProductId(): string {
  return `p_${randomBytes(4).toString('hex')}`;
}

export function listProducts(db: Db, query: ProductListQuery = {}): Product[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (query.category !== undefined) {
    clauses.push('category = ?');
    params.push(query.category);
  }

  if (query.available !== undefined) {
    clauses.push('available = ?');
    params.push(query.available ? 1 : 0);
  }

  if (query.q !== undefined && query.q.length > 0) {
    clauses.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)');
    const like = `%${query.q.toLowerCase()}%`;
    params.push(like, like);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT id, name, description, category, price_cents, image_url, available
    FROM products ${where}
    ORDER BY category ASC, name ASC`;

  const rows = db.prepare(sql).all(...params) as unknown as ProductRow[];
  return rows.map(mapRow);
}

export function getProductById(db: Db, id: string): Product | undefined {
  const row = db
    .prepare(
      `SELECT id, name, description, category, price_cents, image_url, available
       FROM products WHERE id = ?`,
    )
    .get(id) as unknown as ProductRow | undefined;

  return row ? mapRow(row) : undefined;
}

export function createProduct(db: Db, input: ProductInput): Product {
  const product: Product = {
    id: newProductId(),
    name: input.name,
    description: input.description,
    category: input.category,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl ?? null,
    available: input.available ?? true,
  };

  db.prepare(
    `INSERT INTO products (id, name, description, category, price_cents, image_url, available)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    product.id,
    product.name,
    product.description,
    product.category,
    product.priceCents,
    product.imageUrl,
    product.available ? 1 : 0,
  );

  return product;
}

export function updateProduct(db: Db, id: string, input: ProductInput): Product | undefined {
  const existing = getProductById(db, id);
  if (!existing) {
    return undefined;
  }

  const updated: Product = {
    id,
    name: input.name,
    description: input.description,
    category: input.category,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl ?? null,
    available: input.available ?? true,
  };

  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, category = ?, price_cents = ?, image_url = ?, available = ?
     WHERE id = ?`,
  ).run(
    updated.name,
    updated.description,
    updated.category,
    updated.priceCents,
    updated.imageUrl,
    updated.available ? 1 : 0,
    id,
  );

  return updated;
}

/** Soft-delete: marca available = 0. Idempotente se já estiver indisponível. */
export function softDeleteProduct(db: Db, id: string): boolean {
  const existing = getProductById(db, id);
  if (!existing) {
    return false;
  }

  if (existing.available) {
    db.prepare('UPDATE products SET available = 0 WHERE id = ?').run(id);
  }

  return true;
}
