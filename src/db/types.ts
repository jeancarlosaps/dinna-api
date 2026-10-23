/** Produto do cardápio — alinhado a docs/api-contract.md */
export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl: string | null;
  available: boolean;
}

export interface ProductInput {
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl?: string | null;
  available?: boolean;
}

export interface ProductListQuery {
  category?: string;
  q?: string;
  available?: boolean;
}
