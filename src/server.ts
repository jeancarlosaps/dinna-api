import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = buildApp({
  logger: { level: env.logLevel },
  databasePath: env.databasePath,
  apiToken: env.apiToken,
  recommendation: {
    apiKey: env.geminiApiKey,
    timeoutMs: env.geminiTimeoutMs,
    diagnostics: env.geminiDiagnostics,
  },
});

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`SQLite: ${env.databasePath}`);
  app.log.info(`Proteção por token: ${env.apiToken === undefined ? 'desligada' : 'ligada'}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
