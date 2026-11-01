import { parentPort, workerData } from 'node:worker_threads';
import { buildApp } from '../../src/app.js';
import type { OrderItem } from '../../src/db/types.js';

interface CreateOrderWorkerData {
  databasePath: string;
  idempotencyKey: string;
  payload: {
    table: string;
    items: OrderItem[];
  };
}

const data = workerData as CreateOrderWorkerData;

try {
  const app = buildApp({ databasePath: data.databasePath, seed: false, logger: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': data.idempotencyKey },
      payload: data.payload,
    });

    parentPort?.postMessage({
      statusCode: response.statusCode,
      body: response.json(),
    });
  } finally {
    await app.close();
  }
} catch (error) {
  parentPort?.postMessage({
    statusCode: 0,
    body: {
      error: {
        code: 'WORKER_ERROR',
        message: error instanceof Error ? error.message : 'erro desconhecido',
      },
    },
  });
}
