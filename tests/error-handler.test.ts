import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/shared/errors/app-error.js';

describe('tratamento de erros', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('responde 404 padronizado para rota inexistente', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('responde 400 padronizado quando o body falha na validação', async () => {
    app = buildApp();
    app.post(
      '/echo',
      {
        schema: {
          body: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
          },
        },
      },
      async (request) => request.body,
    );

    const response = await app.inject({ method: 'POST', url: '/echo', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('converte AppError no status e código informados', async () => {
    app = buildApp();
    app.get('/conflict', async () => {
      throw new AppError(409, 'CONFLICT', 'Conflito');
    });

    const response = await app.inject({ method: 'GET', url: '/conflict' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'CONFLICT', message: 'Conflito' } });
  });

  it('oculta detalhes de erros inesperados com 500', async () => {
    app = buildApp();
    app.get('/boom', async () => {
      throw new Error('detalhe interno');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
  });
});
