import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import type { CreateOrderInput } from '../../db/types.js';
import { createOrder } from './orders.repository.js';

const orderItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productId', 'quantity'],
  properties: {
    productId: { type: 'string', minLength: 1 },
    quantity: { type: 'integer', minimum: 1 },
    note: { type: 'string', maxLength: 200 },
  },
} as const;

const orderResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'table', 'status', 'items', 'totalCents', 'createdAt'],
  properties: {
    id: { type: 'string' },
    table: { type: 'string' },
    status: { type: 'string', enum: ['received', 'preparing', 'ready', 'finished'] },
    items: { type: 'array', items: orderItemSchema },
    totalCents: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export function ordersRoutes(db: Db): FastifyPluginAsync {
  return async function registerOrders(app: FastifyInstance): Promise<void> {
    app.post<{ Body: CreateOrderInput }>(
      '/orders',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['table', 'items'],
            properties: {
              table: { type: 'string', minLength: 1 },
              items: { type: 'array', minItems: 1, items: orderItemSchema },
            },
          },
          response: {
            201: orderResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const order = createOrder(db, request.body);
        return reply.status(201).send(order);
      },
    );
  };
}
