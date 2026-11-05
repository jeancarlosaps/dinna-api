import type { Product } from '../../db/types.js';
import type { NormalizedPreferences } from './preferences.js';
import {
  acceptProviderIds,
  ProviderUnavailable,
  toProviderProduct,
  type ProviderFailure,
  type RecommendationProvider,
} from './provider.js';
import { buildReason, rankEligible } from './selection.js';

export interface RecommendationProduct {
  productId: string;
  reason: string;
}

export type RecommendationProviderName = 'answered' | 'unavailable' | 'not_called';
export type RecommendationOutcome = 'suggestions' | 'no_compatible_products' | 'empty_catalog';

export interface RecommendationResponse {
  provider: RecommendationProviderName;
  outcome: RecommendationOutcome;
  products: RecommendationProduct[];
}

/**
 * Falha do provedor que ainda tem prato elegível. `no_usable_ids` é o caso
 * em que a resposta chegou, mas nenhum id passou na validação.
 */
export type ProviderFallbackReason = ProviderFailure | 'no_usable_ids';

export interface RecommendInput {
  /** Produtos `available: true` lidos uma vez. Fallback não consulta de novo. */
  snapshot: readonly Product[];
  preferences: NormalizedPreferences;
  limit: number;
  provider?: RecommendationProvider;
  onProviderFallback?: (reason: ProviderFallbackReason) => void;
}

/**
 * Orquestra o contrato. A validação dos ids do provedor (SCRUM-63) e o
 * fallback quando a chamada não serve (SCRUM-67) usam este mesmo conjunto
 * elegível. Não há segunda função de filtro.
 */
export async function recommend(input: RecommendInput): Promise<RecommendationResponse> {
  if (input.snapshot.length === 0) {
    return { provider: 'not_called', outcome: 'empty_catalog', products: [] };
  }

  const eligible = rankEligible(input.snapshot, input.preferences);
  if (eligible.length === 0) {
    return { provider: 'not_called', outcome: 'no_compatible_products', products: [] };
  }

  const fallbackProducts = eligible.slice(0, input.limit);
  if (!input.provider) {
    return suggestions('unavailable', fallbackProducts, input.preferences);
  }

  const request = {
    products: eligible.map((product) => toProviderProduct(product)),
    preferences: {
      ...input.preferences,
      restrictions: [...input.preferences.restrictions],
    },
    limit: input.limit,
  };

  let ids: readonly string[];
  try {
    ids = await input.provider(request);
  } catch (error) {
    input.onProviderFallback?.(providerFallbackReason(error));
    return suggestions('unavailable', fallbackProducts, input.preferences);
  }

  const accepted = acceptProviderIds(ids, eligible, input.limit);
  if (accepted.length === 0) {
    input.onProviderFallback?.('no_usable_ids');
    return suggestions('unavailable', fallbackProducts, input.preferences);
  }

  return suggestions('answered', accepted, input.preferences);
}

function providerFallbackReason(error: unknown): ProviderFallbackReason {
  if (error instanceof ProviderUnavailable) {
    return error.reason;
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  return 'network';
}

function suggestions(
  provider: 'answered' | 'unavailable',
  products: readonly Product[],
  preferences: NormalizedPreferences,
): RecommendationResponse {
  const reason = buildReason(preferences);
  if (products.length === 0 || reason.length < 1 || reason.length > 80) {
    throw new Error('Resposta de recomendação fora do contrato');
  }

  return {
    provider,
    outcome: 'suggestions',
    products: products.map((product) => ({ productId: product.id, reason })),
  };
}
