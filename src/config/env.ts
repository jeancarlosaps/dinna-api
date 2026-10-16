const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

export interface Env {
  host: string;
  port: number;
  logLevel: LogLevel;
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

  return {
    host: source.HOST ?? '0.0.0.0',
    port,
    logLevel,
  };
}
