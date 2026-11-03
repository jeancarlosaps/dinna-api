import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import type { ProductInput, ProductListQuery } from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  MAX_PRODUCT_INGREDIENT_LENGTH,
  MAX_PRODUCT_INGREDIENTS,
  PRODUCT_INGREDIENT_PATTERN,
  createProduct,
  getProductById,
  listProducts,
  softDeleteProduct,
  updateProduct,
} from './products.repository.js';

const productProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  category: { type: 'string' },
  priceCents: { type: 'integer', minimum: 0 },
  imageUrl: { type: ['string', 'null'] },
  available: { type: 'boolean' },
  ingredients: {
    type: 'array',
    maxItems: MAX_PRODUCT_INGREDIENTS,
    items: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_PRODUCT_INGREDIENT_LENGTH,
      pattern: PRODUCT_INGREDIENT_PATTERN,
    },
  },
} as const;

const productBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'category', 'priceCents'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 2000 },
    category: { type: 'string', minLength: 1, maxLength: 80 },
    priceCents: { type: 'integer', minimum: 0 },
    imageUrl: { type: ['string', 'null'], maxLength: 2048 },
    available: { type: 'boolean' },
    ingredients: productProperties.ingredients,
  },
} as const;

const productResponseSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'description',
    'category',
    'priceCents',
    'imageUrl',
    'available',
    'ingredients',
  ],
  properties: productProperties,
} as const;

/**
 * O Ajv do Fastify usa `coerceTypes: 'array'` e transformaria a string `"Pão"`
 * em `["Pão"]`, ou o número `1` em `"1"`, antes do schema recusar o tipo.
 * O contrato não aceita essa coerção. Esta checagem vê o body ainda cru.
 */
function rejectCoercedIngredients(body: unknown): void {
  if (typeof body !== 'object' || body === null || !Object.hasOwn(body, 'ingredients')) {
    return;
  }

  const ingredients = (body as { ingredients: unknown }).ingredients;
  const itemsAreStrings =
    Array.isArray(ingredients) && ingredients.every((item) => typeof item === 'string');
  if (!itemsAreStrings) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ingredients deve ser uma lista de strings');
  }
}

export function productsRoutes(db: Db): FastifyPluginAsync {
  return async function registerProducts(app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: ProductListQuery }>(
      '/products',
      {
        schema: {
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              category: { type: 'string', minLength: 1 },
              q: { type: 'string' },
              available: { type: 'boolean' },
            },
          },
          response: {
            200: {
              type: 'array',
              items: productResponseSchema,
            },
          },
        },
      },
      async (request) => listProducts(db, request.query),
    );

    app.get<{ Params: { id: string } }>(
      '/products/:id',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', minLength: 1 } },
          },
          response: {
            200: productResponseSchema,
          },
        },
      },
      async (request) => {
        const product = getProductById(db, request.params.id);
        if (!product) {
          throw new AppError(
            404,
            'PRODUCT_NOT_FOUND',
            `Produto ${request.params.id} não encontrado`,
          );
        }
        return product;
      },
    );

    app.post<{ Body: ProductInput }>(
      '/products',
      {
        schema: {
          body: productBodySchema,
          response: {
            201: productResponseSchema,
          },
        },
        preValidation: async (request) => {
          rejectCoercedIngredients(request.body);
        },
      },
      async (request, reply) => {
        const product = createProduct(db, request.body);
        return reply.status(201).send(product);
      },
    );

    app.put<{ Params: { id: string }; Body: ProductInput }>(
      '/products/:id',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', minLength: 1 } },
          },
          body: productBodySchema,
          response: {
            200: productResponseSchema,
          },
        },
        preValidation: async (request) => {
          rejectCoercedIngredients(request.body);
        },
      },
      async (request) => {
        const product = updateProduct(db, request.params.id, request.body);
        if (!product) {
          throw new AppError(
            404,
            'PRODUCT_NOT_FOUND',
            `Produto ${request.params.id} não encontrado`,
          );
        }
        return product;
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/products/:id',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const deleted = softDeleteProduct(db, request.params.id);
        if (!deleted) {
          throw new AppError(
            404,
            'PRODUCT_NOT_FOUND',
            `Produto ${request.params.id} não encontrado`,
          );
        }
        return reply.status(204).send();
      },
    );
  };
}
