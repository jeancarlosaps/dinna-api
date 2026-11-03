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

  it('devolve ingredients na listagem e no detalhe', async () => {
    app = buildApp();

    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().every((product: { ingredients: unknown }) => Array.isArray(product.ingredients)),
    ).toBe(true);

    const detail = await app.inject({ method: 'GET', url: '/products/p1' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().ingredients).toEqual([]);
  });

  it('cria com ingredients e também sem o campo', async () => {
    app = buildApp();

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Prato da casa',
        description: 'Texto de apresentação',
        category: 'burgers',
        priceCents: 2590,
        ingredients: ['Pão', 'Queijo cheddar', 'Pão'],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ingredients).toEqual(['Pão', 'Queijo cheddar', 'Pão']);

    const omitted = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Sem composição',
        description: 'Pão, queijo e salada',
        category: 'burgers',
        priceCents: 1000,
      },
    });
    expect(omitted.statusCode).toBe(201);
    expect(omitted.json().ingredients).toEqual([]);
    expect(omitted.json().description).toBe('Pão, queijo e salada');
  });

  it('substitui, preserva ou limpa ingredients conforme o body do PUT', async () => {
    app = buildApp();

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Prato',
        description: 'Apresentação',
        category: 'burgers',
        priceCents: 1500,
        ingredients: ['Pão', 'Queijo cheddar'],
      },
    });
    const id = created.json().id as string;

    const preserved = await app.inject({
      method: 'PUT',
      url: `/products/${id}`,
      payload: {
        name: 'Prato renomeado',
        description: 'Apresentação nova',
        category: 'burgers',
        priceCents: 1600,
        available: true,
      },
    });
    expect(preserved.statusCode).toBe(200);
    expect(preserved.json()).toMatchObject({
      id,
      name: 'Prato renomeado',
      priceCents: 1600,
      ingredients: ['Pão', 'Queijo cheddar'],
    });

    const replaced = await app.inject({
      method: 'PUT',
      url: `/products/${id}`,
      payload: {
        name: 'Prato renomeado',
        description: 'Apresentação nova',
        category: 'burgers',
        priceCents: 1600,
        ingredients: ['Molho'],
      },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().ingredients).toEqual(['Molho']);

    const cleared = await app.inject({
      method: 'PUT',
      url: `/products/${id}`,
      payload: {
        name: 'Prato renomeado',
        description: 'Apresentação nova',
        category: 'burgers',
        priceCents: 1600,
        ingredients: [],
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().ingredients).toEqual([]);
  });

  it('aceita 80 pontos de código Unicode e rejeita o 81º', async () => {
    app = buildApp();

    const accepted = `${'a'.repeat(79)}🥖`;
    const rejected = `${'a'.repeat(80)}🥖`;
    expect([...accepted].length).toBe(80);
    expect(accepted.length).toBe(81);
    expect([...rejected].length).toBe(81);

    const created = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Com emoji',
        description: 'Apresentação',
        category: 'burgers',
        priceCents: 1000,
        ingredients: [accepted, 'Cogumelo 👩‍🍳'],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ingredients).toEqual([accepted, 'Cogumelo 👩‍🍳']);

    const detail = await app.inject({ method: 'GET', url: `/products/${created.json().id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().ingredients).toEqual([accepted, 'Cogumelo 👩‍🍳']);

    const invalid = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        name: 'Emoji a mais',
        description: 'Apresentação',
        category: 'burgers',
        priceCents: 1000,
        ingredients: [rejected],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejeita ingredients fora do contrato', async () => {
    app = buildApp();

    const payloads: Record<string, unknown>[] = [
      { ingredients: 'Pão' },
      { ingredients: null },
      { ingredients: [1] },
      { ingredients: [''] },
      { ingredients: [' '] },
      { ingredients: ['\u200B'] },
      { ingredients: ['\u200D'] },
      { ingredients: ['\u0000'] },
      { ingredients: [' Pão'] },
      { ingredients: ['Pão '] },
      { ingredients: ['a'.repeat(81)] },
      { ingredients: Array.from({ length: 31 }, () => 'Pão') },
    ];

    for (const extra of payloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/products',
        payload: {
          name: 'Inválido',
          description: 'Não deve gravar',
          category: 'burgers',
          priceCents: 100,
          ...extra,
        },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }

    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.json().some((product: { name: string }) => product.name === 'Inválido')).toBe(
      false,
    );
  });
});
