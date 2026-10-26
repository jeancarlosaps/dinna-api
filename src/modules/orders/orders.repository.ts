import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { CreateOrderInput, Order, OrderItem } from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';

interface ProductPriceRow {
  price_cents: number;
  available: number;
}

function newOrderId(): string {
  return `o_${randomUUID()}`;
}

/** Cria pedido e itens em uma única transação usando os preços atuais do cardápio. */
export function createOrder(db: Db, input: CreateOrderInput): Order {
  db.exec('BEGIN IMMEDIATE');

  try {
    const getProduct = db.prepare('SELECT price_cents, available FROM products WHERE id = ?');
    let totalCents = 0;

    for (const item of input.items) {
      const product = getProduct.get(item.productId) as unknown as ProductPriceRow | undefined;
      if (!product || product.available !== 1) {
        throw new AppError(
          404,
          'PRODUCT_NOT_FOUND',
          `Produto ${item.productId} não encontrado ou indisponível`,
        );
      }

      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        !Number.isSafeInteger(product.price_cents)
      ) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Quantidade ou preço inválido para o pedido');
      }

      const itemTotalCents = product.price_cents * item.quantity;
      const nextTotalCents = totalCents + itemTotalCents;
      if (!Number.isSafeInteger(itemTotalCents) || !Number.isSafeInteger(nextTotalCents)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'O total do pedido excede o limite para cálculo exato em centavos',
        );
      }

      totalCents = nextTotalCents;
    }

    const order: Order = {
      id: newOrderId(),
      table: input.table,
      status: 'received',
      items: input.items.map((item): OrderItem => ({ ...item })),
      totalCents,
      createdAt: new Date().toISOString(),
    };

    db.prepare(
      `INSERT INTO orders (id, table_label, status, total_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(order.id, order.table, order.status, order.totalCents, order.createdAt);

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, note)
       VALUES (?, ?, ?, ?)`,
    );
    for (const item of order.items) {
      insertItem.run(order.id, item.productId, item.quantity, item.note ?? null);
    }

    db.exec('COMMIT');
    return order;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
