import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = buildApp({
  logger: { level: env.logLevel },
  databasePath: env.databasePath,
});

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`SQLite: ${env.databasePath}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
