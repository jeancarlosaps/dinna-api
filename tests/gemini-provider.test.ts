import { describe, expect, it } from 'vitest';
import {
  buildGeminiRequestBody,
  createGeminiProvider,
  GEMINI_ENDPOINT,
  GEMINI_MODEL,
  ProviderUnavailable,
  readProductIds,
} from '../src/modules/recommendations/provider.js';
import type { ProviderRequest } from '../src/modules/recommendations/provider.js';

const request: ProviderRequest = {
  limit: 3,
  preferences: {
    budget: 'from_36_to_60',
    hunger: 'normal',
    protein: 'beef',
    style: 'balanced',
    taste: 'savory',
    restrictions: ['no_onion'],
  },
  products: [
    {
      id: 'p2',
      name: 'Burger Smoke',
      description: 'Blend 180g',
      category: 'burgers',
      priceCents: 3890,
      ingredients: ['Carne bovina'],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('provedor Gemini', () => {
  it('pede só ids e não envia mesa, imagem nem chave no corpo ou na URL', async () => {
    let capturedUrl = '';
    let capturedKey: string | null = null;
    let capturedBody = '';

    const provider = createGeminiProvider({
      apiKey: 'secret-key',
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedKey = new Headers(init?.headers).get('x-goog-api-key');
        capturedBody = String(init?.body);
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ productIds: ['p2'], reason: 'inventado' }) }],
              },
            },
          ],
        });
      },
    });

    await expect(provider(request)).resolves.toEqual(['p2']);
    expect(GEMINI_MODEL).toBe('gemini-3.6-flash');
    expect(capturedUrl).toBe(GEMINI_ENDPOINT);
    expect(capturedUrl).toContain(GEMINI_MODEL);
    expect(capturedUrl).not.toContain('secret-key');
    expect(capturedKey).toBe('secret-key');
    expect(capturedBody).not.toContain('secret-key');
    expect(capturedBody).not.toContain('table');
    expect(capturedBody).not.toContain('imageUrl');
    expect(JSON.parse(capturedBody)).toMatchObject({
      generationConfig: {
        responseFormat: { text: { mimeType: 'APPLICATION_JSON' } },
      },
    });

    const built = buildGeminiRequestBody(request);
    expect(JSON.stringify(built)).not.toContain('imageUrl');
    expect(built.contents[0]?.parts[0]?.text).toContain('"id":"p2"');
  });

  it('descarta texto inválido e status de erro sem propagar o corpo', async () => {
    const invalid = createGeminiProvider({
      apiKey: 'secret-key',
      fetchImpl: async () => new Response('nao-json', { status: 200 }),
    });
    await expect(invalid(request)).rejects.toMatchObject({ reason: 'invalid_response' });

    const httpError = createGeminiProvider({
      apiKey: 'secret-key',
      fetchImpl: async () => new Response('falhou', { status: 503 }),
    });
    await expect(httpError(request)).rejects.toBeInstanceOf(ProviderUnavailable);

    expect(
      readProductIds({
        candidates: [{ content: { parts: [{ text: '{"productIds":["p2",1]}' }] } }],
      }),
    ).toEqual(['p2']);
    expect(readProductIds({ candidates: [] })).toBeUndefined();
  });

  it('cancela no timeout e trata falha de rede como provedor indisponível', async () => {
    const timeout = createGeminiProvider({
      apiKey: 'secret-key',
      timeoutMs: 30,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('sem AbortSignal'));
            return;
          }
          const fail = () => {
            reject(signal.reason ?? new DOMException('The operation was aborted', 'TimeoutError'));
          };
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail, { once: true });
        }),
    });

    await expect(timeout(request)).rejects.toMatchObject({
      name: 'ProviderUnavailable',
      reason: 'timeout',
    });

    const network = createGeminiProvider({
      apiKey: 'secret-key',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(network(request)).rejects.toMatchObject({ reason: 'network' });
  });
});
