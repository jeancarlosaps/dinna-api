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
  /** Loga só o estágio da chamada. Não muda o fallback nem a resposta HTTP. */
  diagnostics?: boolean;
  onDiagnostic?: (event: GeminiDiagnostic) => void;
}

/** Estágio observado. Não carrega texto, ids nem credenciais. */
export type GeminiDiagnosticStage =
  | 'timeout'
  | 'network'
  | 'http_status'
  | 'json_invalido'
  | 'sem_candidates'
  | 'sem_parts'
  | 'sem_texto'
  | 'json_parse'
  | 'product_ids_invalidos'
  | 'ids_lidos'
  | 'ids_rejeitados'
  | 'ok';

export interface GeminiDiagnostic {
  stage: GeminiDiagnosticStage;
  geminiMs: number | null;
  httpStatus: number | null;
  parts: number | null;
  thoughtParts: number | null;
  finishReason: string | null;
  receivedCount: number | null;
  acceptedCount: number | null;
}

interface PayloadInspection {
  stage: Exclude<
    GeminiDiagnosticStage,
    'timeout' | 'network' | 'http_status' | 'json_invalido' | 'ids_rejeitados' | 'ok'
  >;
  parts: number | null;
  thoughtParts: number | null;
  finishReason: string | null;
  receivedCount: number | null;
  ids: string[] | undefined;
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
  return inspectGeminiPayload(payload).ids;
}

/**
 * Classifica o envelope na mesma ordem em que `readProductIds` o consome.
 * O objeto devolvido não guarda texto nem ids.
 */
export function inspectGeminiPayload(payload: unknown): PayloadInspection {
  const empty: PayloadInspection = {
    stage: 'sem_candidates',
    parts: null,
    thoughtParts: null,
    finishReason: null,
    receivedCount: null,
    ids: undefined,
  };
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    return empty;
  }

  const first: unknown = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return {
      ...empty,
      stage: 'sem_parts',
      finishReason: categoricalFinishReason(isRecord(first) ? first.finishReason : undefined),
    };
  }

  const parts = first.content.parts;
  let thoughtParts = 0;
  let text = '';
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.thought === true) {
      thoughtParts += 1;
      continue;
    }
    if (typeof part.text === 'string') {
      text += part.text;
    }
  }

  const shape = {
    parts: parts.length,
    thoughtParts,
    finishReason: categoricalFinishReason(first.finishReason),
    receivedCount: null,
    ids: undefined,
  };
  if (text.trim() === '') {
    return { stage: 'sem_texto', ...shape };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { stage: 'json_parse', ...shape };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.productIds)) {
    return { stage: 'product_ids_invalidos', ...shape };
  }

  const ids: string[] = [];
  for (const id of parsed.productIds) {
    if (typeof id !== 'string') {
      continue;
    }
    ids.push(id);
  }
  if (ids.length === 0 && parsed.productIds.length > 0) {
    return { stage: 'product_ids_invalidos', ...shape, receivedCount: 0 };
  }
  return { stage: 'ids_lidos', ...shape, receivedCount: ids.length, ids };
}

function categoricalFinishReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  if (/^[A-Z0-9_]{1,40}$/.test(value)) {
    return value;
  }
  return 'outro';
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
    const started = Date.now();
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
      const geminiMs = Date.now() - started;
      if (isTimeoutError(error)) {
        emitDiagnostic(options, blankDiagnostic('timeout', geminiMs));
        throw new ProviderUnavailable('timeout');
      }
      emitDiagnostic(options, blankDiagnostic('network', geminiMs));
      throw new ProviderUnavailable('network');
    }

    const geminiMs = Date.now() - started;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      emitDiagnostic(options, {
        ...blankDiagnostic('http_status', geminiMs),
        httpStatus: response.status,
      });
      throw new ProviderUnavailable('invalid_response');
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      emitDiagnostic(options, {
        ...blankDiagnostic('json_invalido', geminiMs),
        httpStatus: response.status,
      });
      throw new ProviderUnavailable('invalid_response');
    }

    const inspection = inspectGeminiPayload(payload);
    emitDiagnostic(options, {
      stage: inspection.stage,
      geminiMs,
      httpStatus: response.status,
      parts: inspection.parts,
      thoughtParts: inspection.thoughtParts,
      finishReason: inspection.finishReason,
      receivedCount: inspection.receivedCount,
      acceptedCount: null,
    });
    if (!inspection.ids) {
      throw new ProviderUnavailable('invalid_response');
    }
    return inspection.ids;
  };
}

function blankDiagnostic(stage: GeminiDiagnosticStage, geminiMs: number): GeminiDiagnostic {
  return {
    stage,
    geminiMs,
    httpStatus: null,
    parts: null,
    thoughtParts: null,
    finishReason: null,
    receivedCount: null,
    acceptedCount: null,
  };
}

function emitDiagnostic(options: GeminiProviderOptions, event: GeminiDiagnostic): void {
  if (options.diagnostics !== true) {
    return;
  }
  options.onDiagnostic?.({
    stage: event.stage,
    geminiMs: event.geminiMs,
    httpStatus: event.httpStatus,
    parts: event.parts,
    thoughtParts: event.thoughtParts,
    finishReason: event.finishReason,
    receivedCount: event.receivedCount,
    acceptedCount: event.acceptedCount,
  });
}
