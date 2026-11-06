import type { Product } from '../../db/types.js';
import type { NormalizedPreferences } from './preferences.js';

/**
 * Modelo com saída estruturada na API Gemini, conforme a documentação
 * de structured output. A assinatura de estudante não é crédito desta API.
 */
export const GEMINI_MODEL = 'gemini-3.6-flash';

export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export const DEFAULT_GEMINI_TIMEOUT_MS = 8_000;

export interface ProviderProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  ingredients: string[];
}

/** O que o provedor pode ver. Sem mesa, imagem, pedido, carrinho ou chave. */
export interface ProviderRequest {
  products: ProviderProduct[];
  preferences: NormalizedPreferences;
  limit: number;
}

export type RecommendationProvider = (input: ProviderRequest) => Promise<readonly string[]>;

export type ProviderFailure = 'timeout' | 'network' | 'invalid_response';

export class ProviderUnavailable extends Error {
  readonly reason: ProviderFailure;

  constructor(reason: ProviderFailure) {
    super(reason);
    this.name = 'ProviderUnavailable';
    this.reason = reason;
  }
}

export interface GeminiProviderOptions {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Mantém a ordem do provedor. Descarta id ausente, indisponível, inelegível
 * ou repetido e corta em `limit`. Não completa a lista.
 */
export function acceptProviderIds(
  ids: readonly string[],
  eligible: readonly Product[],
  limit: number,
): Product[] {
  if (!Array.isArray(ids) || limit < 1) {
    return [];
  }

  const byId = new Map(eligible.map((product) => [product.id, product]));
  const accepted: Product[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) {
      continue;
    }
    const product = byId.get(id);
    if (!product?.available) {
      continue;
    }
    seen.add(id);
    accepted.push(product);
    if (accepted.length >= limit) {
      break;
    }
  }

  return accepted;
}

export function toProviderProduct(product: Product): ProviderProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    priceCents: product.priceCents,
    ingredients: product.ingredients,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** Lê só `productIds`. Nome, preço e frase do modelo não são usados. */
export function readProductIds(payload: unknown): string[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return undefined;
  }

  const first: unknown = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return undefined;
  }

  let text = '';
  for (const part of first.content.parts) {
    if (isRecord(part) && typeof part.text === 'string') {
      text += part.text;
    }
  }
  if (text.trim() === '') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.productIds)) {
    return undefined;
  }

  const ids: string[] = [];
  for (const id of parsed.productIds) {
    if (typeof id !== 'string') {
      continue;
    }
    ids.push(id);
  }
  return ids;
}

export function buildGeminiRequestBody(input: ProviderRequest): {
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    responseFormat: {
      text: {
        mimeType: 'APPLICATION_JSON';
        schema: {
          type: 'object';
          additionalProperties: false;
          required: ['productIds'];
          properties: { productIds: { type: 'array'; items: { type: 'string' } } };
        };
      };
    };
  };
} {
  return {
    contents: [
      {
        parts: [
          {
            text: [
              'Escolha pratos somente entre os produtos elegíveis.',
              'Devolva no máximo limit ids, sem repetir, na ordem em que devem ser sugeridos.',
              'Use apenas ids dessa lista. Não invente produto, preço, nome ou motivo.',
              JSON.stringify({
                limit: input.limit,
                preferences: input.preferences,
                products: input.products,
              }),
            ].join('\n'),
          },
        ],
      },
    ],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['productIds'],
            properties: {
              productIds: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}

export function createGeminiProvider(options: GeminiProviderOptions): RecommendationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const apiKey = options.apiKey;

  return async (input) => {
    const body = buildGeminiRequestBody(input);
    let response: Response;
    try {
      response = await fetchImpl(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new ProviderUnavailable('timeout');
      }
      throw new ProviderUnavailable('network');
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderUnavailable('invalid_response');
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new ProviderUnavailable('invalid_response');
    }

    const ids = readProductIds(payload);
    if (!ids) {
      throw new ProviderUnavailable('invalid_response');
    }
    return ids;
  };
}
