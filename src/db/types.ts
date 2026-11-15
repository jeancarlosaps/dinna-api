/** Produto do cardápio — alinhado a docs/api-contract.md */
export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl: string | null;
  available: boolean;
  /** Nomes na ordem informada. Lista vazia significa composição não cadastrada. */
  ingredients: string[];
}

export interface ProductInput {
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl?: string | null;
  available?: boolean;
  /**
   * Ausente na criação grava `[]`. Ausente na atualização preserva a lista
   * já persistida. `[]` explícito grava lista vazia.
   */
  ingredients?: string[];
}

export interface ProductListQuery {
  category?: string;
  q?: string;
  available?: boolean;
}

export type OrderStatus = 'received' | 'preparing' | 'ready' | 'finished';

export interface OrderListQuery {
  status?: OrderStatus;
  table?: string;
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
}

/** Item no body de `POST /orders` — só referência ao cardápio. */
export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  note?: string;
}

/**
 * Item na resposta enriquecida de pedido.
 * `name` / preços são snapshot do cardápio no momento da criação.
 * `GET /orders`, `GET /orders/:id` e `PATCH /orders/:id/status` sempre devolvem estes campos.
 */
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  note?: string;
}

/**
 * Item de um `response_json` já gravado.
 * Pedido novo traz o snapshot. Registro anterior ao snapshot não traz
 * `name` nem preços, e o replay não completa o que estiver ausente.
 */
export interface StoredOrderItem {
  productId: string;
  quantity: number;
  note?: string;
  name?: string;
  unitPriceCents?: number;
  lineTotalCents?: number;
}

export interface CreateOrderInput {
  table: string;
  items: CreateOrderItemInput[];
}

export interface Order {
  /** Id técnico (`o_<uuid>`). Chave de rota, relacionamento e idempotência. */
  id: string;
  /**
   * Número público do pedido, sequencial e único no banco (1, 2, 3…).
   * Não muda depois de atribuído e não volta a zero. A formatação
   * (`#0042`) fica com o cliente.
   */
  orderNumber: number;
  table: string;
  status: OrderStatus;
  items: OrderItem[];
  totalCents: number;
  createdAt: string;
}

/**
 * Corpo de `POST /orders`, inclusive replay de chave anterior ao snapshot
 * ou ao número público. Não é a representação enriquecida de `GET` e `PATCH`.
 */
export interface StoredOrderResponse {
  id: string;
  /** Ausente no `response_json` gravado antes do número público. */
  orderNumber?: number;
  table: string;
  status: OrderStatus;
  items: StoredOrderItem[];
  totalCents: number;
  createdAt: string;
}
