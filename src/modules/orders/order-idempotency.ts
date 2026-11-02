import { createHash } from 'node:crypto';
import type { CreateOrderInput } from '../../db/types.js';
import { AppError } from '../../shared/errors/app-error.js';

/**
 * UUID de RFC 4122 / RFC 9562: versão 1–8 e variante 8, 9, a ou b.
 * O UUID nulo é recusado de propósito.
 */
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normaliza o header Idempotency-Key.
 * Ausente preserva o POST atual (um pedido novo por chamada).
 * Presente e inválido é erro de contrato, sem gravar pedido.
 */
export function parseIdempotencyKey(header: string | string[] | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  if (Array.isArray(header) || !IDEMPOTENCY_KEY_PATTERN.test(header)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'O header Idempotency-Key deve ser um UUID');
  }

  return header.toLowerCase();
}

/**
 * Fingerprint estável do body já validado.
 * A ordem das propriedades não importa; a ordem dos itens importa.
 * `note` omitida é diferente de `note` vazia.
 */
export function fingerprintCreateOrderInput(input: CreateOrderInput): string {
  const canonical = JSON.stringify({
    items: input.items.map((item) => {
      const canonicalItem: { productId: string; quantity: number; note?: string } = {
        productId: item.productId,
        quantity: item.quantity,
      };
      if (item.note !== undefined) {
        canonicalItem.note = item.note;
      }
      return canonicalItem;
    }),
    table: input.table,
  });

  return createHash('sha256').update(canonical).digest('hex');
}
