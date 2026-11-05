import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('usa valores padrão quando variáveis não estão definidas', () => {
    expect(loadEnv({})).toEqual({
      host: '0.0.0.0',
      port: 3333,
      logLevel: 'info',
      databasePath: 'data/dinna.sqlite',
      geminiApiKey: undefined,
      geminiTimeoutMs: 8000,
    });
  });

  it('rejeita PORT inválida', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejeita LOG_LEVEL inválido', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('rejeita DATABASE_PATH vazia', () => {
    expect(() => loadEnv({ DATABASE_PATH: '   ' })).toThrow(/DATABASE_PATH/);
  });

  it('trata chave Gemini ausente ou em branco como indisponível', () => {
    expect(loadEnv({}).geminiApiKey).toBeUndefined();
    expect(loadEnv({ GEMINI_API_KEY: '   ' }).geminiApiKey).toBeUndefined();
    expect(loadEnv({ GEMINI_API_KEY: '  abc  ' }).geminiApiKey).toBe('abc');
  });

  it('aceita GEMINI_TIMEOUT_MS entre 1000 e 15000 e rejeita o resto', () => {
    expect(loadEnv({ GEMINI_TIMEOUT_MS: '1000' }).geminiTimeoutMs).toBe(1000);
    expect(loadEnv({ GEMINI_TIMEOUT_MS: '15000' }).geminiTimeoutMs).toBe(15000);
    expect(loadEnv({ GEMINI_TIMEOUT_MS: '   ' }).geminiTimeoutMs).toBe(8000);
    expect(() => loadEnv({ GEMINI_TIMEOUT_MS: '999' })).toThrow(/GEMINI_TIMEOUT_MS/);
    expect(() => loadEnv({ GEMINI_TIMEOUT_MS: '15001' })).toThrow(/GEMINI_TIMEOUT_MS/);
    expect(() => loadEnv({ GEMINI_TIMEOUT_MS: '8.5' })).toThrow(/GEMINI_TIMEOUT_MS/);
  });
});
