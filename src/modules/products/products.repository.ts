import { randomBytes } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { Product, ProductInput, ProductListQuery } from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';

/** Teto de um prato do cardápio acadêmico. Acima disso a requisição é inválida. */
export const MAX_PRODUCT_INGREDIENTS = 30;

/** Mesmo teto de `category`: nome curto, não uma frase de descrição. */
export const MAX_PRODUCT_INGREDIENT_LENGTH = 80;

/**
 * Exige caractere visível e proíbe espaço nas pontas.
 * Espaço interno e a grafia original permanecem.
 */
export const PRODUCT_INGREDIENT_PATTERN = '^\\S(?:.*\\S)?$';

const ingredientNamePattern = new RegExp(PRODUCT_INGREDIENT_PATTERN, 'u');

interface ProductRow {
  id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  image_url: string | null;
  available: number;
  ingredients: string;
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
    ingredients: parseStoredIngredients(row.ingredients),
  };
}

function newProductId(): string {
  return `p_${randomBytes(4).toString('hex')}`;
}

/** O schema JSON conta pontos de código. `string.length` conta unidades UTF-16. */
function unicodeLength(value: string): number {
  return [...value].length;
}

function isIngredientName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    unicodeLength(value) >= 1 &&
    unicodeLength(value) <= MAX_PRODUCT_INGREDIENT_LENGTH &&
    ingredientNamePattern.test(value)
  );
}

function assertIngredients(value: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ingredients deve ser uma lista de strings');
  }
  if (value.length > MAX_PRODUCT_INGREDIENTS) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `ingredients aceita no máximo ${MAX_PRODUCT_INGREDIENTS} itens`,
    );
  }

  const names: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isIngredientName(item)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `ingredients[${index}] deve ser um nome de 1 a ${MAX_PRODUCT_INGREDIENT_LENGTH} caracteres, sem espaço nas pontas`,
      );
    }
    names.push(item);
  }
  return names;
}

/** Coluna TEXT com JSON array. Esta é a única conversão do campo. */
export function productIngredientsToColumn(ingredients: readonly string[]): string {
  return JSON.stringify(assertIngredients(ingredients));
}

function parseStoredIngredients(stored: unknown): string[] {
  if (typeof stored !== 'string') {
    throw new Error('products.ingredients persistido é inválido');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error('products.ingredients persistido é inválido');
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => isIngredientName(item))) {
    throw new Error('products.ingredients persistido é inválido');
  }
  if (parsed.length > MAX_PRODUCT_INGREDIENTS) {
    throw new Error('products.ingredients persistido é inválido');
  }

  return parsed;
}

function ingredientsForCreate(input: ProductInput): string[] {
  return assertIngredients(input.ingredients ?? []);
}

/**
 * Campo ausente não apaga a lista de um cliente que ainda não envia `ingredients`.
 * `[]` explícito substitui pela lista vazia. Os demais campos não passam por aqui.
 */
function ingredientsForUpdate(input: ProductInput, existing: Product): string[] {
  if (input.ingredients === undefined) {
    return existing.ingredients;
  }
  return assertIngredients(input.ingredients);
}

const productColumns =
  'id, name, description, category, price_cents, image_url, available, ingredients';

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
  const sql = `SELECT ${productColumns}
    FROM products ${where}
    ORDER BY category ASC, name ASC`;

  const rows = db.prepare(sql).all(...params) as unknown as ProductRow[];
  return rows.map(mapRow);
}

export function getProductById(db: Db, id: string): Product | undefined {
  const row = db
    .prepare(`SELECT ${productColumns} FROM products WHERE id = ?`)
    .get(id) as unknown as ProductRow | undefined;

  return row ? mapRow(row) : undefined;
}

export function insertProduct(db: Db, product: Product): void {
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
    productIngredientsToColumn(product.ingredients),
  );
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
    ingredients: ingredientsForCreate(input),
  };

  insertProduct(db, product);
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
    ingredients: ingredientsForUpdate(input, existing),
  };

  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, category = ?, price_cents = ?, image_url = ?, available = ?, ingredients = ?
     WHERE id = ?`,
  ).run(
    updated.name,
    updated.description,
    updated.category,
    updated.priceCents,
    updated.imageUrl,
    updated.available ? 1 : 0,
    productIngredientsToColumn(updated.ingredients),
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
