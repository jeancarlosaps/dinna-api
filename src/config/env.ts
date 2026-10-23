const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

export interface Env {
  host: string;
  port: number;
  logLevel: LogLevel;
  /** Arquivo SQLite local. Use `:memory:` só em testes. */
  databasePath: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT inválida: "${source.PORT}"`);
  }

  const logLevel = (source.LOG_LEVEL ?? 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL inválido: "${source.LOG_LEVEL}"`);
  }

  const databasePath = source.DATABASE_PATH ?? 'data/dinna.sqlite';
  if (databasePath.trim() === '') {
    throw new Error('DATABASE_PATH inválida: string vazia');
  }

  return {
    host: source.HOST ?? '0.0.0.0',
    port,
    logLevel,
    databasePath,
  };
}
