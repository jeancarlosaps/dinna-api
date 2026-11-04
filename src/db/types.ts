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
 * Item na resposta de pedido.
 * `name` / preços são snapshot do cardápio no momento da criação.
 */
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  note?: string;
}

export interface CreateOrderInput {
  table: string;
  items: CreateOrderItemInput[];
}

export interface Order {
  id: string;
  table: string;
  status: OrderStatus;
  items: OrderItem[];
  totalCents: number;
  createdAt: string;
}
