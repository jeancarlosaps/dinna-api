import { describe, expect, it } from 'vitest';
import {
  buildGeminiRequestBody,
  createGeminiProvider,
  GEMINI_ENDPOINT,
  GEMINI_MODEL,
  inspectGeminiPayload,
  ProviderUnavailable,
  readProductIds,
  type GeminiDiagnostic,
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

  it('não emite diagnóstico quando a opção está desligada', async () => {
    const events: GeminiDiagnostic[] = [];
    const provider = createGeminiProvider({
      apiKey: 'secret-key',
      diagnostics: false,
      onDiagnostic: (event) => {
        events.push(event);
      },
      fetchImpl: async () => new Response('falhou', { status: 503 }),
    });

    await expect(provider(request)).rejects.toMatchObject({ reason: 'invalid_response' });
    expect(events).toEqual([]);
  });

  it('separa status, envelope, pensamento e parse sem gravar texto nem ids', async () => {
    const secret = 'texto-gerado-nao-logar';
    const cases: { body: unknown; status?: number; raw?: string; stage: string }[] = [
      { body: null, status: 503, raw: secret, stage: 'http_status' },
      { body: null, status: 200, raw: secret, stage: 'json_invalido' },
      { body: {}, stage: 'sem_candidates' },
      { body: { candidates: [] }, stage: 'sem_candidates' },
      { body: { candidates: [{ finishReason: 'SAFETY' }] }, stage: 'sem_parts' },
      {
        body: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
        stage: 'sem_texto',
      },
      {
        body: {
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'nao-json' }] },
            },
          ],
        },
        stage: 'json_parse',
      },
      {
        body: { candidates: [{ content: { parts: [{ text: '{"outro":true}' }] } }] },
        stage: 'product_ids_invalidos',
      },
      {
        body: { candidates: [{ content: { parts: [{ text: '{"productIds":[1]}' }] } }] },
        stage: 'product_ids_invalidos',
      },
    ];

    for (const [index, item] of cases.entries()) {
      const events: GeminiDiagnostic[] = [];
      const provider = createGeminiProvider({
        apiKey: 'secret-key',
        diagnostics: true,
        onDiagnostic: (event) => {
          events.push(event);
        },
        fetchImpl: async () =>
          item.raw === undefined
            ? jsonResponse(item.body, item.status)
            : new Response(item.raw, { status: item.status ?? 200 }),
      });

      await expect(provider(request), `caso ${index}`).rejects.toMatchObject({
        reason: 'invalid_response',
      });
      expect(events, `caso ${index}`).toHaveLength(1);
      expect(events[0]?.stage, `caso ${index}`).toBe(item.stage);
      if (item.stage === 'http_status') {
        expect(events[0]?.httpStatus, `caso ${index}`).toBe(503);
      }
      if (item.stage === 'json_parse') {
        expect(events[0], `caso ${index}`).toMatchObject({
          httpStatus: 200,
          parts: 1,
          thoughtParts: 0,
          finishReason: 'STOP',
        });
      }
      if (item.stage === 'sem_texto') {
        expect(events[0], `caso ${index}`).toMatchObject({
          parts: 0,
          thoughtParts: 0,
          finishReason: 'STOP',
        });
      }
      expect(JSON.stringify(events[0]), `caso ${index}`).not.toContain(secret);
      expect(JSON.stringify(events[0]), `caso ${index}`).not.toContain('secret-key');
      expect(JSON.stringify(events[0]), `caso ${index}`).not.toContain('p2');
    }

    const thoughtOnly = inspectGeminiPayload({
      candidates: [
        { finishReason: 'MAX_TOKENS', content: { parts: [{ thought: true, text: secret }] } },
      ],
    });
    expect(thoughtOnly.stage).toBe('sem_texto');
    expect(thoughtOnly.parts).toBe(1);
    expect(thoughtOnly.thoughtParts).toBe(1);
    expect(thoughtOnly.finishReason).toBe('MAX_TOKENS');

    const safety = inspectGeminiPayload({
      candidates: [{ finishReason: 'SAFETY' }],
    });
    expect(safety.stage).toBe('sem_parts');
    expect(safety.finishReason).toBe('SAFETY');

    const prose = inspectGeminiPayload({
      candidates: [{ finishReason: 'frase livre do modelo', content: { parts: [] } }],
    });
    expect(prose.finishReason).toBe('outro');
    expect(JSON.stringify(prose)).not.toContain('frase livre');
  });

  it('conta partes de pensamento e ids lidos sem devolver o texto no diagnóstico', async () => {
    const secret = 'texto-gerado-nao-logar';
    const events: GeminiDiagnostic[] = [];
    const provider = createGeminiProvider({
      apiKey: 'secret-key',
      diagnostics: true,
      onDiagnostic: (event) => {
        events.push(event);
      },
      fetchImpl: async () =>
        jsonResponse({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { thought: true, text: secret },
                  { text: JSON.stringify({ productIds: ['p2'] }) },
                ],
              },
            },
          ],
        }),
    });

    await expect(provider(request)).resolves.toEqual(['p2']);
    expect(events).toEqual([
      expect.objectContaining({
        stage: 'ids_lidos',
        httpStatus: 200,
        parts: 2,
        thoughtParts: 1,
        finishReason: 'STOP',
        receivedCount: 1,
        acceptedCount: null,
      }),
    ]);
    expect(JSON.stringify(events[0])).not.toContain(secret);
    expect(JSON.stringify(events[0])).not.toContain('p2');
    expect(typeof events[0]?.geminiMs).toBe('number');
  });

  it('classifica timeout e rede quando o diagnóstico está ligado', async () => {
    const events: GeminiDiagnostic[] = [];
    const timeout = createGeminiProvider({
      apiKey: 'secret-key',
      timeoutMs: 30,
      diagnostics: true,
      onDiagnostic: (event) => {
        events.push(event);
      },
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
    await expect(timeout(request)).rejects.toMatchObject({ reason: 'timeout' });
    expect(events.at(-1)?.stage).toBe('timeout');
    expect(events.at(-1)?.httpStatus).toBeNull();

    const network = createGeminiProvider({
      apiKey: 'secret-key',
      diagnostics: true,
      onDiagnostic: (event) => {
        events.push(event);
      },
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(network(request)).rejects.toMatchObject({ reason: 'network' });
    expect(events.at(-1)?.stage).toBe('network');
    expect(JSON.stringify(events)).not.toContain('secret-key');
  });

  it('classifica timeout na leitura do corpo, sem tratá-lo como JSON inválido', async () => {
    const events: GeminiDiagnostic[] = [];
    const provider = createGeminiProvider({
      apiKey: 'secret-key',
      diagnostics: true,
      onDiagnostic: (event) => {
        events.push(event);
      },
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new DOMException('The operation was aborted', 'TimeoutError');
          },
        }) as unknown as Response,
    });

    await expect(provider(request)).rejects.toMatchObject({ reason: 'timeout' });
    expect(events).toEqual([
      expect.objectContaining({ stage: 'timeout', httpStatus: null, geminiMs: expect.any(Number) }),
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-key');
  });
});
