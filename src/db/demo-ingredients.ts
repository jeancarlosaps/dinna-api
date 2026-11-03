import { productIngredientsToColumn } from '../modules/products/products.repository.js';
import type { Db } from './client.js';
import { SEED_PRODUCTS } from './seed.js';

/**
 * Atualiza só `ingredients` dos produtos de demonstração p1–p12.
 *
 * Não roda na abertura do banco. A prévia não grava. A gravação exige
 * o mesmo id e o mesmo nome do seed, e só preenche lista ainda vazia.
 * O UPDATE não cita pedidos nem chaves de idempotência.
 */

export class DemoIngredientsUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoIngredientsUsageError';
  }
}

export class DemoIngredientsRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoIngredientsRefusedError';
  }
}

export interface DemoIngredientCommand {
  apply: boolean;
  allowProduction: boolean;
}

export type DemoIngredientSkipReason =
  'missing' | 'identity' | 'already-set' | 'illustrative-empty' | 'invalid';

export interface DemoIngredientUpdate {
  id: string;
  name: string;
  ingredients: string[];
}

export interface DemoIngredientSkip {
  id: string;
  name: string;
  reason: DemoIngredientSkipReason;
  /** Nome gravado quando o id do seed pertence a outro produto. */
  foundName?: string;
}

export interface DemoIngredientReport {
  mode: 'dry-run' | 'applied';
  updates: DemoIngredientUpdate[];
  skipped: DemoIngredientSkip[];
}

export interface BackfillDemoIngredientsOptions {
  apply: boolean;
  /** Única forma de gravar com NODE_ENV=production. A prévia não usa isto. */
  allowProduction?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface ProductIdentityRow {
  id: string;
  name: string;
  ingredients: string;
}

export function parseDemoIngredientArgs(argv: readonly string[]): DemoIngredientCommand {
  let apply = false;
  let dryRun = false;
  let allowProduction = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--allow-production') {
      allowProduction = true;
    } else {
      throw new DemoIngredientsUsageError(
        `Argumento desconhecido: ${arg}. Use --dry-run ou --apply.`,
      );
    }
  }

  if (apply && dryRun) {
    throw new DemoIngredientsUsageError('Use só um modo: --dry-run ou --apply.');
  }

  return { apply, allowProduction };
}

export function assertDemoIngredientsDatabasePath(databasePath: string): void {
  if (databasePath === ':memory:') {
    throw new DemoIngredientsUsageError(
      'DATABASE_PATH=:memory: não persiste. Aponte para o arquivo SQLite de desenvolvimento.',
    );
  }
}

export function assertDemoIngredientsApplyAllowed(
  env: NodeJS.ProcessEnv,
  options: { apply: boolean; allowProduction?: boolean },
): void {
  if (options.apply && env.NODE_ENV === 'production' && options.allowProduction !== true) {
    throw new DemoIngredientsRefusedError(
      'Backfill de demonstração recusado com NODE_ENV=production. Nada foi gravado.',
    );
  }
}

function parseIngredientColumn(stored: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function backfillDemoIngredients(
  db: Db,
  options: BackfillDemoIngredientsOptions,
): DemoIngredientReport {
  const env = options.env ?? process.env;
  assertDemoIngredientsApplyAllowed(env, options);

  const updates: DemoIngredientUpdate[] = [];
  const skipped: DemoIngredientSkip[] = [];
  let started = false;

  try {
    db.exec(options.apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
    started = true;

    const select = db.prepare('SELECT id, name, ingredients FROM products WHERE id = ?');
    const update = db.prepare(
      'UPDATE products SET ingredients = ? WHERE id = ? AND name = ? AND ingredients = ?',
    );

    for (const seed of SEED_PRODUCTS) {
      const row = select.get(seed.id) as unknown as ProductIdentityRow | undefined;
      if (!row) {
        skipped.push({ id: seed.id, name: seed.name, reason: 'missing' });
        continue;
      }

      if (row.name !== seed.name) {
        skipped.push({
          id: seed.id,
          name: seed.name,
          reason: 'identity',
          foundName: row.name,
        });
        continue;
      }

      const current = parseIngredientColumn(row.ingredients);
      if (current === undefined) {
        skipped.push({ id: seed.id, name: seed.name, reason: 'invalid' });
        continue;
      }

      if (current.length > 0) {
        skipped.push({ id: seed.id, name: seed.name, reason: 'already-set' });
        continue;
      }

      if (seed.ingredients.length === 0) {
        skipped.push({ id: seed.id, name: seed.name, reason: 'illustrative-empty' });
        continue;
      }

      const column = productIngredientsToColumn(seed.ingredients);
      if (options.apply) {
        const result = update.run(column, seed.id, seed.name, row.ingredients);
        if (Number(result.changes) !== 1) {
          throw new Error(`não foi possível atualizar ingredients de ${seed.id}`);
        }
      }

      updates.push({
        id: seed.id,
        name: seed.name,
        ingredients: [...seed.ingredients],
      });
    }

    db.exec(options.apply ? 'COMMIT' : 'ROLLBACK');
    started = false;
    return { mode: options.apply ? 'applied' : 'dry-run', updates, skipped };
  } catch (error) {
    if (started) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}
