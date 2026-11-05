const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

export interface Env {
  host: string;
  port: number;
  logLevel: LogLevel;
  /** Arquivo SQLite local. Use `:memory:` só em testes. */
  databasePath: string;
  /**
   * Chave da API Gemini. Ausente ou em branco deixa o provedor indisponível.
   * Não é crédito de assinatura de estudante.
   */
  geminiApiKey: string | undefined;
  /** Tempo limite da chamada, em milissegundos. Padrão 8000. Intervalo 1000–15000. */
  geminiTimeoutMs: number;
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
    geminiApiKey: readGeminiApiKey(source.GEMINI_API_KEY),
    geminiTimeoutMs: readGeminiTimeoutMs(source.GEMINI_TIMEOUT_MS),
  };
}

function readGeminiApiKey(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readGeminiTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 8_000;
  }

  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 15_000) {
    throw new Error(`GEMINI_TIMEOUT_MS inválido: "${value}"`);
  }
  return timeout;
}
