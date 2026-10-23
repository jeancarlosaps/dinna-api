import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SEED_PRODUCTS } from '../src/db/seed.js';

describe('products', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /products lista o seed do cardápio', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(SEED_PRODUCTS.length);
    expect(response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'p1', name: 'Burger Clássico' })]),
    );
  });

  it('GET /products filtra por category, q e available', async () => {
    app = buildApp();

    const byCategory = await app.inject({ method: 'GET', url: '/products?category=burgers' });
    expect(byCategory.statusCode).toBe(200);
    expect(byCategory.json().every((p: { category: string }) => p.category === 'burgers')).toBe(
      true,
    );

    const byQuery = await app.inject({ method: 'GET', url: '/products?q=brownie' });
    expect(byQuery.json()).toEqual([expect.objectContaining({ id: 'p7', name: 'Brownie' })]);

    const availableOnly = await app.inject({ method: 'GET', url: '/products?available=true' });
    expect(availableOnly.json().every((p: { available: boolean }) => p.available)).toBe(true);
    expect(availableOnly.json()).toHaveLength(SEED_PRODUCTS.filter((p) => p.available).length);
  });

  it('GET /products/:id retorna o produto ou PRODUCT_NOT_FOUND', async () => {
    app = buildApp();

    const ok = await app.inject({ method: 'GET', url: '/products/p1' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'p1', priceCents: 3290 });

    const missing = await app.inject({ method: 'GET', url: '/products/nao-existe' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Produto nao-existe não encontrado' },
    });
  });

  it('POST /products cria com 201 e id gerado', async () => {
    app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Milkshake',
        description: 'Creme de baunilha',
        category: 'bebidas',
        priceCents: 1890,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Milkshake',
      available: true,
      imageUrl: null,
      priceCents: 1890,
    });
    expect(response.json().id).toMatch(/^p_[a-f0-9]{8}$/);
  });

  it('POST /products rejeita body inválido com VALIDATION_ERROR', async () => {
    app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      payload: { name: 'Sem preço' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('PUT /products/:id atualiza e DELETE faz soft-delete idempotente', async () => {
    app = buildApp();

    const updated = await app.inject({
      method: 'PUT',
      url: '/products/p1',
      payload: {
        name: 'Burger Clássico+',
        description: 'Atualizado',
        category: 'burgers',
        priceCents: 3490,
        available: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: 'p1', name: 'Burger Clássico+', priceCents: 3490 });

    const deleted = await app.inject({ method: 'DELETE', url: '/products/p1' });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');

    const after = await app.inject({ method: 'GET', url: '/products/p1' });
    expect(after.json()).toMatchObject({ id: 'p1', available: false });

    const again = await app.inject({ method: 'DELETE', url: '/products/p1' });
    expect(again.statusCode).toBe(204);

    const missing = await app.inject({ method: 'DELETE', url: '/products/sumiu' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'PRODUCT_NOT_FOUND' } });
  });
});
