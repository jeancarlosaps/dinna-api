import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type {
  CreateOrderInput,
  Order,
  OrderItem,
  OrderListQuery,
  OrderStatus,
} from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';

interface ProductPriceRow {
  price_cents: number;
  available: number;
}

interface OrderWithItemRow {
  id: string;
  table_label: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  item_id: number | null;
  product_id: string | null;
  quantity: number | null;
  note: string | null;
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

/** Lista pedidos com seus itens, na ordem estável da fila (mais antigo primeiro). */
export function listOrders(db: Db, query: OrderListQuery = {}): Order[] {
  const conditions: string[] = [];
  const parameters: string[] = [];

  if (query.status !== undefined) {
    conditions.push('o.status = ?');
    parameters.push(query.status);
  }

  if (query.table !== undefined) {
    conditions.push('o.table_label = ?');
    parameters.push(query.table);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT
         o.id,
         o.table_label,
         o.status,
         o.total_cents,
         o.created_at,
         oi.id AS item_id,
         oi.product_id,
         oi.quantity,
         oi.note
       FROM orders AS o
       LEFT JOIN order_items AS oi ON oi.order_id = o.id
       ${whereClause}
       ORDER BY o.created_at ASC, o.id ASC, oi.id ASC`,
    )
    .all(...parameters) as unknown as OrderWithItemRow[];

  const orders: Order[] = [];
  let currentOrder: Order | undefined;

  for (const row of rows) {
    if (currentOrder?.id !== row.id) {
      currentOrder = {
        id: row.id,
        table: row.table_label,
        status: row.status,
        items: [],
        totalCents: row.total_cents,
        createdAt: row.created_at,
      };
      orders.push(currentOrder);
    }

    if (row.item_id !== null && row.product_id !== null && row.quantity !== null) {
      const item: OrderItem = { productId: row.product_id, quantity: row.quantity };
      if (row.note !== null) {
        item.note = row.note;
      }
      currentOrder.items.push(item);
    }
  }

  return orders;
}
