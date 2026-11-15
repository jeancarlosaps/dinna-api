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
  /** Log local do estágio da chamada. Desligado, salvo `1` ou `true`. */
  geminiDiagnostics: boolean;
  /**
   * Token compartilhado exigido no header `X-Dinna-Api-Token`.
   * Definido só quando `DINNA_REQUIRE_API_TOKEN` está ligado; ausente, a API fica aberta (uso local).
   */
  apiToken: string | undefined;
}

/** Mínimo de 32 caracteres ASCII visíveis, sem espaço (cabe em header HTTP). */
const API_TOKEN_PATTERN = /^[\x21-\x7E]{32,}$/;

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
    geminiDiagnostics: readGeminiDiagnostics(source.GEMINI_DIAGNOSTICS),
    apiToken: readApiToken(source.DINNA_REQUIRE_API_TOKEN, source.DINNA_API_TOKEN),
  };
}

/**
 * Proteção ligada exige token válido; desligada não aceita token definido.
 * Qualquer inconsistência impede a subida. As mensagens nunca trazem o valor do token.
 */
function readApiToken(
  requireValue: string | undefined,
  tokenValue: string | undefined,
): string | undefined {
  const required = readRequireApiToken(requireValue);
  const token = tokenValue?.trim() ?? '';

  if (!required) {
    if (token !== '') {
      throw new Error(
        'DINNA_API_TOKEN definido sem DINNA_REQUIRE_API_TOKEN=true. Ligue a proteção ou remova o token.',
      );
    }
    return undefined;
  }

  if (token === '') {
    throw new Error('DINNA_REQUIRE_API_TOKEN=true exige DINNA_API_TOKEN');
  }
  if (!API_TOKEN_PATTERN.test(token)) {
    throw new Error(
      'DINNA_API_TOKEN inválido: use ao menos 32 caracteres ASCII visíveis, sem espaços',
    );
  }
  return token;
}

function readRequireApiToken(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === '0' || normalized === 'false') {
    return false;
  }
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  throw new Error('DINNA_REQUIRE_API_TOKEN inválido. Use true ou false.');
}

function readGeminiDiagnostics(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
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
