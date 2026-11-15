import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type {
  CreateOrderInput,
  Order,
  OrderItem,
  OrderListQuery,
  OrderStatus,
  StoredOrderItem,
  StoredOrderResponse,
  UpdateOrderStatusInput,
} from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import { fingerprintCreateOrderInput } from './order-idempotency.js';

interface ProductPriceRow {
  name: string;
  price_cents: number;
  available: number;
}

interface OrderWithItemRow {
  id: string;
  order_number: number | null;
  table_label: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  item_id: number | null;
  product_id: string | null;
  product_name: string | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
  quantity: number | null;
  note: string | null;
}

const NEXT_ORDER_STATUS: Record<OrderStatus, OrderStatus | null> = {
  received: 'preparing',
  preparing: 'ready',
  ready: 'finished',
  finished: null,
};

const SQLITE_CONSTRAINT = 19;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

interface IdempotencyKeyRow {
  request_hash: string;
  order_id: string;
  response_json: string;
}

const ORDER_WITH_ITEMS_SELECT = `
  SELECT
    o.id,
    o.order_number,
    o.table_label,
    o.status,
    o.total_cents,
    o.created_at,
    oi.id AS item_id,
    oi.product_id,
    oi.product_name,
    oi.unit_price_cents,
    oi.line_total_cents,
    oi.quantity,
    oi.note
  FROM orders AS o
  LEFT JOIN order_items AS oi ON oi.order_id = o.id`;

function mapOrderRows(rows: OrderWithItemRow[]): Order[] {
  const orders: Order[] = [];
  let currentOrder: Order | undefined;

  for (const row of rows) {
    if (currentOrder?.id !== row.id) {
      // A abertura do banco numera todo pedido. Sem número, a resposta não sai.
      if (row.order_number === null) {
        throw new Error(`Pedido ${row.id} sem número público`);
      }
      currentOrder = {
        id: row.id,
        orderNumber: row.order_number,
        table: row.table_label,
        status: row.status,
        items: [],
        totalCents: row.total_cents,
        createdAt: row.created_at,
      };
      orders.push(currentOrder);
    }

    if (
      row.item_id !== null &&
      row.product_id !== null &&
      row.quantity !== null &&
      row.product_name !== null &&
      row.unit_price_cents !== null &&
      row.line_total_cents !== null
    ) {
      const item: OrderItem = {
        productId: row.product_id,
        name: row.product_name,
        quantity: row.quantity,
        unitPriceCents: row.unit_price_cents,
        lineTotalCents: row.line_total_cents,
      };
      if (row.note !== null) {
        item.note = row.note;
      }
      currentOrder.items.push(item);
    }
  }

  return orders;
}

function findOrderById(db: Db, id: string): Order | undefined {
  const rows = db
    .prepare(`${ORDER_WITH_ITEMS_SELECT} WHERE o.id = ? ORDER BY oi.id ASC`)
    .all(id) as unknown as OrderWithItemRow[];
  return mapOrderRows(rows)[0];
}

/** Pedido completo por id, com itens e snapshot de preços. */
export function getOrderById(db: Db, id: string): Order {
  const order = findOrderById(db, id);
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', `Pedido ${id} não encontrado`);
  }
  return order;
}

function newOrderId(): string {
  return `o_${randomUUID()}`;
}

/**
 * Próximo número público. Só roda dentro da transação do POST
 * (`BEGIN IMMEDIATE`): o lock de escrita serializa conexões concorrentes e o
 * rollback devolve o contador junto com o pedido.
 */
function nextOrderNumber(db: Db): number {
  const row = db
    .prepare(
      'UPDATE order_number_sequence SET last_value = last_value + 1 WHERE id = 1 RETURNING last_value',
    )
    .get() as unknown as { last_value: number } | undefined;
  if (row === undefined) {
    throw new Error('Contador de número público ausente');
  }
  return row.last_value;
}

function isIdempotencyKeyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('errcode' in error)) {
    return false;
  }

  const errcode = error.errcode;
  const isConstraint =
    errcode === SQLITE_CONSTRAINT ||
    errcode === SQLITE_CONSTRAINT_PRIMARYKEY ||
    errcode === SQLITE_CONSTRAINT_UNIQUE;

  return isConstraint && error instanceof Error && error.message.includes('idempotency_keys.key');
}

function findIdempotencyKey(db: Db, key: string): IdempotencyKeyRow | undefined {
  return db
    .prepare('SELECT request_hash, order_id, response_json FROM idempotency_keys WHERE key = ?')
    .get(key) as unknown as IdempotencyKeyRow | undefined;
}

function orderExists(db: Db, id: string): boolean {
  return db.prepare('SELECT 1 AS present FROM orders WHERE id = ?').get(id) !== undefined;
}

/** A repetição devolve o JSON gravado, sem reescrever a linha nem completar campos ausentes. */
function parseStoredOrder(responseJson: string, orderId: string): StoredOrderResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    throw invalidIdempotencyState();
  }

  if (!isStoredOrderResponse(parsed) || parsed.id !== orderId) {
    throw invalidIdempotencyState();
  }

  return parsed;
}

function invalidIdempotencyState(): AppError {
  return new AppError(
    500,
    'IDEMPOTENCY_STATE_INVALID',
    'A chave de idempotência não possui o pedido correspondente',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return value === 'received' || value === 'preparing' || value === 'ready' || value === 'finished';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalCents(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

/**
 * Aceita o item legado (`productId`, `quantity`, `note`) e o item com snapshot.
 * Campo ausente não é preenchido. Tipo incompatível invalida o registro.
 */
function isStoredOrderItem(value: unknown): value is StoredOrderItem {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.productId !== 'string' || value.productId.length === 0) {
    return false;
  }

  if (
    typeof value.quantity !== 'number' ||
    !Number.isSafeInteger(value.quantity) ||
    value.quantity < 1
  ) {
    return false;
  }

  return (
    isOptionalString(value.note) &&
    isOptionalString(value.name) &&
    isOptionalCents(value.unitPriceCents) &&
    isOptionalCents(value.lineTotalCents)
  );
}

function isStoredOrderResponse(value: unknown): value is StoredOrderResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    (value.orderNumber === undefined ||
      (typeof value.orderNumber === 'number' &&
        Number.isSafeInteger(value.orderNumber) &&
        value.orderNumber >= 1)) &&
    typeof value.table === 'string' &&
    isOrderStatus(value.status) &&
    Array.isArray(value.items) &&
    value.items.every(isStoredOrderItem) &&
    typeof value.totalCents === 'number' &&
    typeof value.createdAt === 'string'
  );
}

/** Pedido novo já tem snapshot. O alargamento não remove esses campos. */
function storedOrderResponseFromOrder(order: Order): StoredOrderResponse {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    table: order.table,
    status: order.status,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    items: order.items.map((item): StoredOrderItem => ({ ...item })),
  };
}

/**
 * Devolve o corpo original da criação, sem alterar `response_json`.
 * Payload diferente não cria outro pedido. O status persistido pode avançar depois,
 * mas a repetição do POST não acompanha esse PATCH. Chave sem o pedido correspondente
 * falha sem reaproveitar a chave. Nome e preços ausentes no JSON gravado continuam ausentes.
 */
function replayIdempotentOrder(
  db: Db,
  input: CreateOrderInput,
  existing: IdempotencyKeyRow,
): StoredOrderResponse {
  if (existing.request_hash !== fingerprintCreateOrderInput(input)) {
    throw new AppError(
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      'A Idempotency-Key já foi usada com um payload diferente',
    );
  }

  if (!orderExists(db, existing.order_id)) {
    throw invalidIdempotencyState();
  }

  return parseStoredOrder(existing.response_json, existing.order_id);
}

function insertOrder(db: Db, input: CreateOrderInput, idempotencyKey?: string): Order {
  const getProduct = db.prepare('SELECT name, price_cents, available FROM products WHERE id = ?');
  let totalCents = 0;
  const items: OrderItem[] = [];

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

    const lineTotalCents = product.price_cents * item.quantity;
    const nextTotalCents = totalCents + lineTotalCents;
    if (!Number.isSafeInteger(lineTotalCents) || !Number.isSafeInteger(nextTotalCents)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'O total do pedido excede o limite para cálculo exato em centavos',
      );
    }

    totalCents = nextTotalCents;
    const snapshot: OrderItem = {
      productId: item.productId,
      name: product.name,
      quantity: item.quantity,
      unitPriceCents: product.price_cents,
      lineTotalCents,
    };
    if (item.note !== undefined) {
      snapshot.note = item.note;
    }
    items.push(snapshot);
  }

  const order: Order = {
    id: newOrderId(),
    orderNumber: nextOrderNumber(db),
    table: input.table,
    status: 'received',
    items,
    totalCents,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO orders (id, order_number, table_label, status, total_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(order.id, order.orderNumber, order.table, order.status, order.totalCents, order.createdAt);

  const insertItem = db.prepare(
    `INSERT INTO order_items (
      order_id, product_id, product_name, unit_price_cents, line_total_cents, quantity, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of order.items) {
    insertItem.run(
      order.id,
      item.productId,
      item.name,
      item.unitPriceCents,
      item.lineTotalCents,
      item.quantity,
      item.note ?? null,
    );
  }

  if (idempotencyKey !== undefined) {
    db.prepare(
      `INSERT INTO idempotency_keys (key, request_hash, order_id, created_at, response_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      idempotencyKey,
      fingerprintCreateOrderInput(input),
      order.id,
      order.createdAt,
      JSON.stringify(order),
    );
  }

  return order;
}

/**
 * Cria pedido e itens em uma única transação usando os preços atuais do cardápio.
 * Com Idempotency-Key, a chave só é gravada nessa mesma transação, depois do pedido.
 * A linha não expira e nenhum caminho a apaga.
 * Não há registro "em andamento": o lock de escrita dura até o commit ou o rollback.
 * Se duas conexões passarem da leitura ao mesmo tempo, a PRIMARY KEY impede a segunda
 * inserção e a tentativa seguinte relê o pedido já commitado.
 * A repetição devolve o `response_json` original. Não relê o cardápio nem o pedido migrado.
 */
export function createOrder(
  db: Db,
  input: CreateOrderInput,
  idempotencyKey?: string,
): StoredOrderResponse {
  try {
    return runCreateOrder(db, input, idempotencyKey);
  } catch (error) {
    if (idempotencyKey === undefined || !isIdempotencyKeyConflict(error)) {
      throw error;
    }
  }

  return runCreateOrder(db, input, idempotencyKey);
}

function runCreateOrder(
  db: Db,
  input: CreateOrderInput,
  idempotencyKey?: string,
): StoredOrderResponse {
  db.exec('BEGIN IMMEDIATE');

  try {
    const order =
      idempotencyKey === undefined
        ? storedOrderResponseFromOrder(insertOrder(db, input))
        : createIdempotentOrder(db, input, idempotencyKey);
    db.exec('COMMIT');
    return order;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createIdempotentOrder(
  db: Db,
  input: CreateOrderInput,
  idempotencyKey: string,
): StoredOrderResponse {
  const existing = findIdempotencyKey(db, idempotencyKey);
  if (existing) {
    return replayIdempotentOrder(db, input, existing);
  }

  return storedOrderResponseFromOrder(insertOrder(db, input, idempotencyKey));
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
      `${ORDER_WITH_ITEMS_SELECT}
       ${whereClause}
       ORDER BY o.created_at ASC, o.id ASC, oi.id ASC`,
    )
    .all(...parameters) as unknown as OrderWithItemRow[];

  return mapOrderRows(rows);
}

/** Avança o status exatamente um passo e retorna o pedido atualizado. */
export function updateOrderStatus(db: Db, id: string, input: UpdateOrderStatusInput): Order {
  db.exec('BEGIN IMMEDIATE');

  try {
    const order = findOrderById(db, id);
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', `Pedido ${id} não encontrado`);
    }

    if (NEXT_ORDER_STATUS[order.status] !== input.status) {
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Não é permitido avançar o pedido de ${order.status} para ${input.status}`,
      );
    }

    const result = db
      .prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?')
      .run(input.status, id, order.status);
    if (Number(result.changes) !== 1) {
      throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'O status do pedido foi alterado');
    }

    order.status = input.status;
    db.exec('COMMIT');
    return order;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
