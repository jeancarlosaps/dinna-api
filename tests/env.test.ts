import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('usa valores padrão quando variáveis não estão definidas', () => {
    expect(loadEnv({})).toEqual({ host: '0.0.0.0', port: 3333, logLevel: 'info' });
  });

  it('rejeita PORT inválida', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejeita LOG_LEVEL inválido', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
