import { describe, expect, it } from 'vitest';
import type { Product } from '../src/db/types.js';
import {
  normalizePreferences,
  type NormalizedPreferences,
} from '../src/modules/recommendations/preferences.js';
import {
  buildReason,
  rankEligible,
  selectProducts,
} from '../src/modules/recommendations/selection.js';

function prefs(overrides: Partial<NormalizedPreferences> = {}): NormalizedPreferences {
  return normalizePreferences({
    budget: 'unlimited',
    hunger: 'normal',
    protein: 'beef',
    style: 'balanced',
    taste: 'savory',
    restrictions: [],
    ...overrides,
  });
}

function dish(overrides: Partial<Product> & Pick<Product, 'id' | 'priceCents'>): Product {
  return {
    name: 'Prato',
    description: 'Descricao',
    category: 'burgers',
    imageUrl: null,
    available: true,
    ingredients: ['Carne bovina'],
    ...overrides,
  };
}

function ids(products: readonly Product[]): string[] {
  return products.map((product) => product.id);
}

describe('seleção determinística', () => {
  it('normaliza restrições na ordem estável e não inventa default de pergunta', () => {
    expect(
      normalizePreferences({
        budget: 'unlimited',
        hunger: 'little',
        protein: 'vegetarian',
        style: 'full',
        taste: 'sweet',
        restrictions: ['vegan', 'no_onion', 'no_gluten'],
      }).restrictions,
    ).toEqual(['no_onion', 'no_gluten', 'vegan']);
  });

  it('aplica as pontas das faixas e deixa a lacuna só no ilimitado', () => {
    const prices = [0, 2000, 2001, 2100, 3500, 3501, 3600, 6000, 6001];
    const catalog = prices.map((priceCents, index) =>
      dish({ id: `n${index}`, priceCents, ingredients: ['Carne bovina'] }),
    );

    const inBudget = (budget: NormalizedPreferences['budget']) =>
      ids(rankEligible(catalog, prefs({ budget, hunger: 'little' })));

    expect(inBudget('up_to_20')).toEqual(['n0', 'n1']);
    expect(inBudget('from_21_to_35')).toEqual(['n3', 'n4']);
    expect(inBudget('from_36_to_60')).toEqual(['n6', 'n7']);
    expect(inBudget('unlimited')).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
  });

  it('ordena little, normal e big e desempata pelo id em UTF-8', () => {
    const catalog = [
      dish({ id: 'pC', priceCents: 6000 }),
      dish({ id: 'pA', priceCents: 4800 }),
      dish({ id: 'pD', priceCents: 5000 }),
      dish({ id: 'pB', priceCents: 3600 }),
    ];

    expect(
      ids(rankEligible(catalog, prefs({ budget: 'from_36_to_60', hunger: 'little' }))),
    ).toEqual(['pB', 'pA', 'pD', 'pC']);
    expect(
      ids(rankEligible(catalog, prefs({ budget: 'from_36_to_60', hunger: 'normal' }))),
    ).toEqual(['pA', 'pD', 'pB', 'pC']);
    expect(ids(rankEligible(catalog, prefs({ budget: 'from_36_to_60', hunger: 'big' })))).toEqual([
      'pC',
      'pD',
      'pA',
      'pB',
    ]);

    const spread = [
      dish({ id: 'b', priceCents: 9000 }),
      dish({ id: 'a', priceCents: 1000 }),
      dish({ id: 'c', priceCents: 5000 }),
    ];
    expect(ids(rankEligible(spread, prefs({ hunger: 'normal' })))).toEqual(['a', 'c', 'b']);
    expect(ids(rankEligible(spread, prefs({ hunger: 'little' })))).toEqual(['a', 'c', 'b']);
    expect(ids(rankEligible(spread, prefs({ hunger: 'big' })))).toEqual(['b', 'c', 'a']);

    const tied = [dish({ id: 'p2', priceCents: 2000 }), dish({ id: 'p10', priceCents: 2000 })];
    expect(ids(rankEligible(tied, prefs({ hunger: 'little' })))).toEqual(['p10', 'p2']);
  });

  it('não muda ids nem ordem quando só o estilo muda', () => {
    const catalog = [dish({ id: 'p2', priceCents: 3890 }), dish({ id: 'p1', priceCents: 3290 })];
    const light = ids(selectProducts(catalog, prefs({ hunger: 'little', style: 'light' }), 3));
    const full = ids(selectProducts(catalog, prefs({ hunger: 'little', style: 'full' }), 3));
    expect(light).toEqual(['p1', 'p2']);
    expect(full).toEqual(light);
  });

  it('respeita limite de letra, acento e plural', () => {
    const withOnion = (ingredient: string) =>
      rankEligible(
        [
          dish({
            id: 'p',
            priceCents: 1000,
            ingredients: [ingredient, 'Alface'],
          }),
        ],
        prefs({ protein: 'vegetarian', restrictions: ['no_onion'] }),
      );

    expect(withOnion('Cebola')).toEqual([]);
    expect(withOnion('Cebolas')).toEqual([]);
    expect(withOnion('Onions')).toEqual([]);
    expect(withOnion('CEBOLA')).toEqual([]);
    expect(withOnion('Cebolá')).toEqual([]);
    expect(ids(withOnion('Cebolinha'))).toEqual(['p']);
    expect(
      rankEligible(
        [dish({ id: 'empty', priceCents: 1000, name: 'Carne bovina', ingredients: [] })],
        prefs({ protein: 'beef', restrictions: ['no_onion'] }),
      ),
    ).toEqual([]);
    expect(
      ids(
        rankEligible(
          [dish({ id: 'empty', priceCents: 1000, name: 'Carne bovina', ingredients: [] })],
          prefs({ protein: 'beef' }),
        ),
      ),
    ).toEqual(['empty']);

    const salmon = dish({
      id: 's',
      priceCents: 1000,
      name: 'Salmão grelhado',
      ingredients: ['Sal'],
    });
    expect(ids(rankEligible([salmon], prefs({ protein: 'fish' })))).toEqual(['s']);

    const chicken = dish({
      id: 'f',
      priceCents: 1000,
      name: 'Frango grelhado',
      ingredients: ['Sal'],
    });
    expect(ids(rankEligible([chicken], prefs({ protein: 'chicken' })))).toEqual(['f']);
  });

  it('não trata carne genérica como beef e tira vegetarian só com token animal', () => {
    const plate = (ingredients: string[]) =>
      dish({ id: 'p', priceCents: 1000, name: 'Prato', description: 'Texto', ingredients });

    expect(ids(rankEligible([plate(['Carne moída', 'Pão'])], prefs({ protein: 'beef' })))).toEqual(
      [],
    );
    expect(
      ids(rankEligible([plate(['Carne moída', 'Pão'])], prefs({ protein: 'vegetarian' }))),
    ).toEqual([]);
    expect(ids(rankEligible([plate(['Carne de boi'])], prefs({ protein: 'beef' })))).toEqual([]);
    expect(ids(rankEligible([plate(['Carne de boi'])], prefs({ protein: 'vegetarian' })))).toEqual(
      [],
    );
    expect(ids(rankEligible([plate(['Carne bovina'])], prefs({ protein: 'beef' })))).toEqual(['p']);
    expect(ids(rankEligible([plate(['Carne bovina'])], prefs({ protein: 'vegetarian' })))).toEqual(
      [],
    );
    expect(ids(rankEligible([plate(['Frangos'])], prefs({ protein: 'chicken' })))).toEqual(['p']);
    expect(ids(rankEligible([plate(['Frangos'])], prefs({ protein: 'vegetarian' })))).toEqual([]);
    expect(
      ids(rankEligible([plate(['Boina', 'Alface'])], prefs({ protein: 'vegetarian' }))),
    ).toEqual(['p']);
    expect(ids(rankEligible([plate(['Boina', 'Alface'])], prefs({ protein: 'beef' })))).toEqual([]);
    expect(ids(rankEligible([plate(['Blend'])], prefs({ protein: 'beef' })))).toEqual([]);
    expect(ids(rankEligible([plate(['Blend'])], prefs({ protein: 'vegetarian' })))).toEqual(['p']);
    expect(ids(rankEligible([plate(['Bacon'])], prefs({ protein: 'beef' })))).toEqual([]);
    expect(ids(rankEligible([plate(['Bacon'])], prefs({ protein: 'vegetarian' })))).toEqual([]);
    expect(ids(rankEligible([plate([])], prefs({ protein: 'vegetarian' })))).toEqual([]);
  });

  it('exclui bebida, esgotado, doce fora de sobremesa e id repetido', () => {
    const catalog = [
      dish({ id: 'drink', priceCents: 1000, category: 'bebidas', ingredients: ['Frango'] }),
      dish({ id: 'gone', priceCents: 100, available: false, ingredients: ['Frango'] }),
      dish({
        id: 'cake',
        priceCents: 1500,
        category: 'sobremesas',
        name: 'Bolo',
        ingredients: ['Alface'],
      }),
      dish({ id: 'salad', priceCents: 1800, category: 'acompanhamentos', ingredients: ['Alface'] }),
      dish({ id: 'salad', priceCents: 100, category: 'acompanhamentos', ingredients: ['Alface'] }),
    ];

    expect(ids(rankEligible(catalog, prefs({ protein: 'chicken', hunger: 'little' })))).toEqual([]);
    expect(ids(rankEligible(catalog, prefs({ protein: 'vegetarian', taste: 'sweet' })))).toEqual([
      'cake',
    ]);
    expect(ids(rankEligible(catalog, prefs({ protein: 'vegetarian', hunger: 'little' })))).toEqual([
      'salad',
    ]);
  });

  it('esvazia o conjunto em restrição crítica e mantém no_onion só como filtro', () => {
    const catalog = [dish({ id: 'p', priceCents: 1000, ingredients: ['Alface', 'Tomate'] })];
    for (const restriction of ['no_gluten', 'no_lactose', 'vegan', 'no_seafood'] as const) {
      expect(
        rankEligible(catalog, prefs({ protein: 'vegetarian', restrictions: [restriction] })),
      ).toEqual([]);
    }

    const kept = rankEligible(
      catalog,
      prefs({ protein: 'vegetarian', restrictions: ['no_onion'] }),
    );
    expect(ids(kept)).toEqual(['p']);
    expect(buildReason(prefs({ protein: 'vegetarian', restrictions: ['no_onion'] }))).toBe(
      'Vegetariano, Salgado, sem cebola na lista cadastrada',
    );
  });

  it('monta o motivo na ordem do contrato, sem fome, estilo ou preço do prato', () => {
    const reason = buildReason(
      prefs({
        budget: 'from_36_to_60',
        hunger: 'big',
        protein: 'beef',
        style: 'light',
        taste: 'savory',
        restrictions: ['no_onion'],
      }),
    );
    expect(reason).toBe('Carne, R$ 36\u201360, Salgado, sem cebola na lista cadastrada');
    expect(reason.length).toBeLessThanOrEqual(80);
    expect(buildReason(prefs({ budget: 'up_to_20', protein: 'vegetarian', taste: 'savory' }))).toBe(
      'Vegetariano, Até R$ 20, Salgado',
    );
    expect(buildReason(prefs({ protein: 'beef' }))).toBe('Carne, Salgado');
  });

  it('corta no limite sem reordenar pelo estilo', () => {
    const catalog = [
      dish({ id: 'p3', priceCents: 3000 }),
      dish({ id: 'p1', priceCents: 1000 }),
      dish({ id: 'p2', priceCents: 2000 }),
    ];
    expect(ids(selectProducts(catalog, prefs({ hunger: 'little', style: 'full' }), 2))).toEqual([
      'p1',
      'p2',
    ]);
  });
});
