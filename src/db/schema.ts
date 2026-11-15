/**
 * Schema R0/R1: products, orders e chaves de idempotência do POST /orders.
 *
 * `orders.order_number` é o número público do pedido. A coluna aceita NULL
 * porque banco antigo a recebe por ALTER TABLE; a abertura numera essas linhas
 * e cria o índice UNIQUE (`migrateOrderNumbers`). O índice não fica aqui:
 * em banco antigo a coluna ainda não existe quando este SQL roda.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  -- JSON array de nomes, na ordem cadastrada. Não é CSV. A conversão fica no repositório.
  ingredients TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  table_label TEXT NOT NULL,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL,
  order_number INTEGER CHECK (order_number >= 1)
);

-- Último número público entregue. Uma linha só (id = 1). Não volta atrás,
-- mesmo que um pedido deixe de existir.
CREATE TABLE IF NOT EXISTS order_number_sequence (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last_value INTEGER NOT NULL CHECK (last_value >= 0)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  note TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  response_json TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
`;
