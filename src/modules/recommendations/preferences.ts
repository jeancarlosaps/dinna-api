/**
 * Perguntas da V1. Os valores são os do contrato; nenhum recebe default
 * quando a pergunta é obrigatória. `restrictions` ausente vira lista vazia
 * na normalização, na ordem estável do desenho.
 */

export const BUDGETS = ['up_to_20', 'from_21_to_35', 'from_36_to_60', 'unlimited'] as const;
export type Budget = (typeof BUDGETS)[number];

export const HUNGERS = ['little', 'normal', 'big'] as const;
export type Hunger = (typeof HUNGERS)[number];

export const PROTEINS = ['chicken', 'fish', 'beef', 'vegetarian'] as const;
export type Protein = (typeof PROTEINS)[number];

export const STYLES = ['light', 'balanced', 'full'] as const;
export type Style = (typeof STYLES)[number];

export const TASTES = ['savory', 'sweet'] as const;
export type Taste = (typeof TASTES)[number];

/** Ordem estável do motivo e do objeto enviado ao provedor. */
export const RESTRICTIONS = ['no_onion', 'no_gluten', 'no_lactose', 'vegan', 'no_seafood'] as const;
export type Restriction = (typeof RESTRICTIONS)[number];

export const CRITICAL_RESTRICTIONS = ['no_gluten', 'no_lactose', 'vegan', 'no_seafood'] as const;
export type CriticalRestriction = (typeof CRITICAL_RESTRICTIONS)[number];

export interface RecommendationPreferencesInput {
  budget: Budget;
  hunger: Hunger;
  protein: Protein;
  style: Style;
  taste: Taste;
  restrictions?: Restriction[];
}

export interface NormalizedPreferences {
  budget: Budget;
  hunger: Hunger;
  protein: Protein;
  style: Style;
  taste: Taste;
  restrictions: Restriction[];
}

export interface RecommendationRequestBody {
  table?: string;
  preferences: RecommendationPreferencesInput;
  limit?: number;
}

const CRITICAL = new Set<string>(CRITICAL_RESTRICTIONS);
const ANIMAL_PROTEINS = new Set<Protein>(['chicken', 'fish', 'beef']);

export function isCriticalRestriction(value: Restriction): value is CriticalRestriction {
  return CRITICAL.has(value);
}

/** A ordem enviada pelo cliente não muda o motivo nem o payload do provedor. */
export function normalizePreferences(input: RecommendationPreferencesInput): NormalizedPreferences {
  const selected = new Set(input.restrictions ?? []);
  return {
    budget: input.budget,
    hunger: input.hunger,
    protein: input.protein,
    style: input.style,
    taste: input.taste,
    restrictions: RESTRICTIONS.filter((item) => selected.has(item)),
  };
}

/**
 * Contradição recusada antes de ler o cardápio.
 * `vegetarian` com `vegan` não entra aqui: a restrição crítica decide depois.
 */
export function preferenceContradiction(preferences: NormalizedPreferences): string | undefined {
  if (preferences.protein === 'fish' && preferences.restrictions.includes('no_seafood')) {
    return 'A proteína escolhida é fruto do mar';
  }
  if (ANIMAL_PROTEINS.has(preferences.protein) && preferences.restrictions.includes('vegan')) {
    return 'A proteína escolhida não cabe em vegano';
  }
  return undefined;
}
