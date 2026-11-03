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

export interface OrderItem {
  productId: string;
  quantity: number;
  note?: string;
}

export interface CreateOrderInput {
  table: string;
  items: OrderItem[];
}

export interface Order {
  id: string;
  table: string;
  status: OrderStatus;
  items: OrderItem[];
  totalCents: number;
  createdAt: string;
}
