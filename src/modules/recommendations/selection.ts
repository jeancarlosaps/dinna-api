import type { Product } from '../../db/types.js';
import {
  isCriticalRestriction,
  type Budget,
  type NormalizedPreferences,
  type Protein,
  type Taste,
} from './preferences.js';

const BUDGET_RANGE = {
  up_to_20: { min: 0, max: 2000, mid: 1000, label: 'Até R$ 20' },
  from_21_to_35: { min: 2100, max: 3500, mid: 2800, label: 'R$ 21\u201335' },
  from_36_to_60: { min: 3600, max: 6000, mid: 4800, label: 'R$ 36\u201360' },
} as const;

const PROTEIN_LABEL: Record<Protein, string> = {
  chicken: 'Frango',
  fish: 'Peixe',
  beef: 'Carne',
  vegetarian: 'Vegetariano',
};

const TASTE_LABEL: Record<Taste, string> = {
  savory: 'Salgado',
  sweet: 'Doce',
};

const CHICKEN_TOKENS = ['frango', 'frangos', 'chicken', 'chickens'] as const;
const FISH_TOKENS = [
  'peixe',
  'peixes',
  'salmao',
  'salmoes',
  'tilapia',
  'tilapias',
  'bacalhau',
  'bacalhaus',
  'atum',
  'atuns',
  'fish',
] as const;
const BEEF_TOKENS = ['bovina', 'bovinas', 'bovino', 'bovinos', 'beef'] as const;
const ONION_TOKENS = ['cebola', 'cebolas', 'onion', 'onions'] as const;

/**
 * Carne animal tira o prato de `vegetarian` e não o coloca em `beef`.
 * `carne` e `boi` estão só nesta lista. Ovo, leite, queijo e mel ficam de fora.
 */
const ANIMAL_MEAT_TOKENS = [
  ...CHICKEN_TOKENS,
  ...FISH_TOKENS,
  ...BEEF_TOKENS,
  'carne',
  'carnes',
  'boi',
  'bois',
  'bacon',
  'porco',
  'porcos',
  'suino',
  'suinos',
  'suina',
  'suinas',
  'presunto',
  'presuntos',
  'camarao',
  'camaroes',
  'lula',
  'lulas',
  'polvo',
  'polvos',
  'ostra',
  'ostras',
  'marisco',
  'mariscos',
  'siri',
  'siris',
  'caranguejo',
  'caranguejos',
  'lagosta',
  'lagostas',
] as const;

const LETTER = /\p{L}/u;

/** NFD, sem marca combinante, minúsculas Unicode sem locale. */
function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * O token casa só com limite de letra. `cebola` não casa em `cebolas` nem em
 * `cebolinha`; o plural entra como token próprio.
 */
function charsHaveToken(chars: readonly string[], token: string): boolean {
  const needle = [...token];
  if (needle.length === 0 || needle.length > chars.length) {
    return false;
  }

  for (let index = 0; index <= chars.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (chars[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }

    const before = index > 0 ? chars[index - 1] : undefined;
    const after = index + needle.length < chars.length ? chars[index + needle.length] : undefined;
    const beforeOk = before === undefined || !LETTER.test(before);
    const afterOk = after === undefined || !LETTER.test(after);
    if (beforeOk && afterOk) {
      return true;
    }
  }

  return false;
}

function productFields(product: Product): string[][] {
  return [product.name, product.description, ...product.ingredients].map((text) => [
    ...normalizeForMatch(text),
  ]);
}

function hasAnyToken(product: Product, tokens: readonly string[]): boolean {
  const fields = productFields(product);
  return tokens.some((token) => fields.some((chars) => charsHaveToken(chars, token)));
}

function passesBudget(priceCents: number, budget: Budget): boolean {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return false;
  }
  if (budget === 'unlimited') {
    return true;
  }
  const range = BUDGET_RANGE[budget];
  return priceCents >= range.min && priceCents <= range.max;
}

function passesTaste(category: string, taste: Taste): boolean {
  if (taste === 'sweet') {
    return category === 'sobremesas';
  }
  return category !== 'sobremesas' && category !== 'bebidas';
}

function matchesProtein(product: Product, protein: Protein): boolean {
  if (protein === 'chicken') {
    return hasAnyToken(product, CHICKEN_TOKENS);
  }
  if (protein === 'fish') {
    return hasAnyToken(product, FISH_TOKENS);
  }
  if (protein === 'beef') {
    return hasAnyToken(product, BEEF_TOKENS);
  }
  return product.ingredients.length > 0 && !hasAnyToken(product, ANIMAL_MEAT_TOKENS);
}

function passesOnion(product: Product, preferences: NormalizedPreferences): boolean {
  if (!preferences.restrictions.includes('no_onion')) {
    return true;
  }
  if (product.ingredients.length === 0) {
    return false;
  }
  return !hasAnyToken(product, ONION_TOKENS);
}

function isEligible(product: Product, preferences: NormalizedPreferences): boolean {
  if (!product.available) {
    return false;
  }
  if (product.category === 'bebidas') {
    return false;
  }
  if (!passesBudget(product.priceCents, preferences.budget)) {
    return false;
  }
  if (!passesTaste(product.category, preferences.taste)) {
    return false;
  }
  if (!matchesProtein(product, preferences.protein)) {
    return false;
  }
  return passesOnion(product, preferences);
}

function compareId(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function comparePrice(left: Product, right: Product, preferences: NormalizedPreferences): number {
  if (preferences.hunger === 'little') {
    return left.priceCents - right.priceCents;
  }
  if (preferences.hunger === 'big') {
    return right.priceCents - left.priceCents;
  }
  if (preferences.budget === 'unlimited') {
    return left.priceCents - right.priceCents;
  }
  const mid = BUDGET_RANGE[preferences.budget].mid;
  return Math.abs(left.priceCents - mid) - Math.abs(right.priceCents - mid);
}

function compareEligible(
  left: Product,
  right: Product,
  preferences: NormalizedPreferences,
): number {
  const byPrice = comparePrice(left, right, preferences);
  if (byPrice !== 0) {
    return byPrice;
  }
  return compareId(left.id, right.id);
}

/**
 * Conjunto elegível ordenado. Não sorteia, não lê o relógio e não depende
 * da ordem do SQLite. `style` não entra. Restrição crítica esvazia o conjunto:
 * o cadastro não tem atributo para mantê-lo.
 */
export function rankEligible(
  snapshot: readonly Product[],
  preferences: NormalizedPreferences,
): Product[] {
  if (preferences.restrictions.some((item) => isCriticalRestriction(item))) {
    return [];
  }

  const ranked = snapshot.filter((product) => isEligible(product, preferences));
  ranked.sort((left, right) => compareEligible(left, right, preferences));

  const unique: Product[] = [];
  const seen = new Set<string>();
  for (const product of ranked) {
    if (seen.has(product.id)) {
      continue;
    }
    seen.add(product.id);
    unique.push(product);
  }
  return unique;
}

/** Fallback: os `limit` primeiros da ordem determinística. */
export function selectProducts(
  snapshot: readonly Product[],
  preferences: NormalizedPreferences,
  limit: number,
): Product[] {
  return rankEligible(snapshot, preferences).slice(0, limit);
}

/** Motivo montado pela API. Fome, estilo e restrição crítica não entram. */
export function buildReason(preferences: NormalizedPreferences): string {
  const parts: string[] = [PROTEIN_LABEL[preferences.protein]];
  if (preferences.budget !== 'unlimited') {
    parts.push(BUDGET_RANGE[preferences.budget].label);
  }
  parts.push(TASTE_LABEL[preferences.taste]);
  if (preferences.restrictions.includes('no_onion')) {
    parts.push('sem cebola na lista cadastrada');
  }
  return parts.join(', ');
}
