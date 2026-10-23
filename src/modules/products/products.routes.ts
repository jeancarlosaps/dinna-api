import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import type { ProductInput, ProductListQuery } from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
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
  },
} as const;

const productResponseSchema = {
  type: 'object',
  required: ['id', 'name', 'description', 'category', 'priceCents', 'imageUrl', 'available'],
  properties: productProperties,
} as const;

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
