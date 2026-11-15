import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../../src/db/client.js';

const data = workerData as { databasePath: string };

try {
  const db = openDatabase({ path: data.databasePath, seed: false });
  try {
    const columns = db.prepare('PRAGMA table_info(products)').all() as unknown as Array<{
      name: string;
    }>;
    const row = db.prepare('SELECT COUNT(*) AS count FROM products').get() as unknown as {
      count: number;
    };
    parentPort?.postMessage({
      ok: columns.some((column) => column.name === 'ingredients') && row.count === 1,
    });
  } finally {
    db.close();
  }
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : 'erro desconhecido',
  });
}
