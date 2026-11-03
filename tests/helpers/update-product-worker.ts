import { parentPort, workerData } from 'node:worker_threads';
import { buildApp } from '../../src/app.js';

interface UpdateProductWorkerData {
  databasePath: string;
  productId: string;
  payload: Record<string, unknown>;
}

const data = workerData as UpdateProductWorkerData;

try {
  const app = buildApp({ databasePath: data.databasePath, seed: false, logger: false });
  try {
    const response = await app.inject({
      method: 'PUT',
      url: `/products/${data.productId}`,
      payload: data.payload,
    });
    parentPort?.postMessage({ statusCode: response.statusCode, body: response.json() });
  } finally {
    await app.close();
  }
} catch (error) {
  parentPort?.postMessage({
    statusCode: 0,
    body: { message: error instanceof Error ? error.message : 'erro desconhecido' },
  });
}
