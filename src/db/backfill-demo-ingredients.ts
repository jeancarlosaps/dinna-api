import { existsSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { openDatabase, type Db } from './client.js';
import {
  assertDemoIngredientsApplyAllowed,
  assertDemoIngredientsDatabasePath,
  backfillDemoIngredients,
  DemoIngredientsRefusedError,
  DemoIngredientsUsageError,
  parseDemoIngredientArgs,
  type DemoIngredientReport,
  type DemoIngredientSkipReason,
} from './demo-ingredients.js';

/**
 * Ingredientes ilustrativos para um banco de desenvolvimento já existente.
 *
 *   npm run demo:ingredients
 *   npm run demo:ingredients -- --apply
 *
 * A prévia é o padrão. --apply grava. NODE_ENV=production recusa a gravação.
 */

const SKIP_LABELS: Record<DemoIngredientSkipReason, string> = {
  missing: 'ausente no banco; nada foi inserido',
  identity: 'id existe com outro nome; produto preservado',
  'already-set': 'já possui ingredientes; lista preservada',
  'illustrative-empty': 'lista vazia de propósito; sabor ou fabricante variam',
  invalid: 'ingredients inválido; linha preservada',
};

function printReport(databasePath: string, report: DemoIngredientReport): void {
  console.log(`Banco: ${databasePath}`);
  if (report.mode === 'applied') {
    console.log('Modo: aplicado');
  } else {
    console.log('Modo: prévia (nenhuma escrita)');
    console.log('Para gravar: npm run demo:ingredients -- --apply');
  }

  const heading = report.mode === 'applied' ? 'Atualizados' : 'Seriam atualizados';
  console.log(`${heading}: ${report.updates.length}`);
  for (const update of report.updates) {
    console.log(`- ${update.id} ${update.name}: ${update.ingredients.join(', ')}`);
  }

  console.log(`Sem alteração: ${report.skipped.length}`);
  for (const skip of report.skipped) {
    const found = skip.foundName === undefined ? '' : ` (nome no banco: ${skip.foundName})`;
    console.log(`- ${skip.id} ${skip.name}: ${SKIP_LABELS[skip.reason]}${found}`);
  }
}

async function main(): Promise<number> {
  let db: Db | undefined;

  try {
    const command = parseDemoIngredientArgs(process.argv.slice(2));
    const env = loadEnv();
    assertDemoIngredientsDatabasePath(env.databasePath);
    assertDemoIngredientsApplyAllowed(process.env, command);

    if (!existsSync(env.databasePath)) {
      throw new DemoIngredientsUsageError(
        [
          `Não encontrei o arquivo SQLite em "${env.databasePath}".`,
          'Este comando não cria nem apaga o banco.',
          'Para um arquivo novo, suba a API com npm run dev.',
        ].join('\n'),
      );
    }

    db = openDatabase({ path: env.databasePath, seed: false });
    const report = backfillDemoIngredients(db, {
      apply: command.apply,
      allowProduction: command.allowProduction,
    });
    printReport(env.databasePath, report);
    return 0;
  } catch (error) {
    if (
      error instanceof DemoIngredientsUsageError ||
      error instanceof DemoIngredientsRefusedError
    ) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    db?.close();
  }
}

process.exitCode = await main();
