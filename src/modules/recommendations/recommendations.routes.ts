import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';
import { listProducts } from '../products/products.repository.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recommend, type RecommendationResponse } from './recommend.js';
import {
  BUDGETS,
  HUNGERS,
  normalizePreferences,
  preferenceContradiction,
  PROTEINS,
  RESTRICTIONS,
  STYLES,
  TASTES,
  type RecommendationRequestBody,
} from './preferences.js';
import type { RecommendationProvider } from './provider.js';

const BODY_KEYS = new Set(['table', 'preferences', 'limit']);
const PREFERENCE_KEYS = new Set(['budget', 'hunger', 'protein', 'style', 'taste', 'restrictions']);
const PREFERENCE_STRING_FIELDS = ['budget', 'hunger', 'protein', 'style', 'taste'] as const;

/**
 * O Ajv padrão do Fastify remove campo extra e coage string para array ou
 * número. O contrato desta rota recusa os dois. O body aqui ainda é o JSON cru.
 */
function assertRecommendationBody(body: unknown): void {
  if (!isRecord(body)) {
    return;
  }

  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Campo desconhecido: ${key}`);
    }
  }

  if (Object.hasOwn(body, 'table') && typeof body.table !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'table deve ser uma string');
  }

  if (Object.hasOwn(body, 'limit') && !isInteger(body.limit)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'limit deve ser um inteiro de 1 a 3');
  }

  if (!Object.hasOwn(body, 'preferences')) {
    return;
  }
  if (!isRecord(body.preferences)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'preferences deve ser um objeto');
  }

  for (const key of Object.keys(body.preferences)) {
    if (!PREFERENCE_KEYS.has(key)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Campo desconhecido: preferences.${key}`);
    }
  }

  for (const field of PREFERENCE_STRING_FIELDS) {
    if (Object.hasOwn(body.preferences, field) && typeof body.preferences[field] !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', `${field} deve ser uma string`);
    }
  }

  if (!Object.hasOwn(body.preferences, 'restrictions')) {
    return;
  }
  const restrictions = body.preferences.restrictions;
  if (!Array.isArray(restrictions) || restrictions.some((item) => typeof item !== 'string')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'restrictions deve ser uma lista de strings');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value);
}

const recommendationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'outcome', 'products'],
  properties: {
    provider: { type: 'string', enum: ['answered', 'unavailable', 'not_called'] },
    outcome: {
      type: 'string',
      enum: ['suggestions', 'no_compatible_products', 'empty_catalog'],
    },
    products: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['productId', 'reason'],
        properties: {
          productId: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
  },
} as const;

export function recommendationsRoutes(
  db: Db,
  provider?: RecommendationProvider,
  options?: { diagnostics?: boolean },
): FastifyPluginAsync {
  return async function registerRecommendations(app: FastifyInstance): Promise<void> {
    app.post<{ Body: RecommendationRequestBody }>(
      '/ai/recommendation',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['preferences'],
            properties: {
              table: {
                type: 'string',
                minLength: 1,
                maxLength: 40,
                pattern: '^\\S(?:.*\\S)?$',
              },
              preferences: {
                type: 'object',
                additionalProperties: false,
                required: ['budget', 'hunger', 'protein', 'style', 'taste'],
                properties: {
                  budget: { type: 'string', enum: [...BUDGETS] },
                  hunger: { type: 'string', enum: [...HUNGERS] },
                  protein: { type: 'string', enum: [...PROTEINS] },
                  style: { type: 'string', enum: [...STYLES] },
                  taste: { type: 'string', enum: [...TASTES] },
                  restrictions: {
                    type: 'array',
                    maxItems: 5,
                    uniqueItems: true,
                    default: [],
                    items: { type: 'string', enum: [...RESTRICTIONS] },
                  },
                },
              },
              limit: { type: 'integer', minimum: 1, maximum: 3, default: 3 },
            },
          },
          response: {
            200: recommendationResponseSchema,
          },
        },
        preValidation: async (request) => {
          assertRecommendationBody(request.body);
        },
      },
      async (request): Promise<RecommendationResponse> => {
        const preferences = normalizePreferences(request.body.preferences);
        const contradiction = preferenceContradiction(preferences);
        if (contradiction) {
          throw new AppError(400, 'VALIDATION_ERROR', contradiction);
        }

        const limit = request.body.limit ?? 3;
        const snapshot = listProducts(db, { available: true });
        return recommend({
          snapshot,
          preferences,
          limit,
          provider,
          onProviderFallback: (reason) => {
            request.log.warn({ reason }, 'Provedor de recomendação indisponível');
          },
          onDiagnostic: options?.diagnostics
            ? (event) => {
                request.log.warn({ gemini: event }, 'Diagnóstico do provedor de recomendação');
              }
            : undefined,
        });
      },
    );
  };
}
