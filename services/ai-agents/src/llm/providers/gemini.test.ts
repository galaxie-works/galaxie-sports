import { describe, expect, it } from 'vitest';
import { llmSettingsFromEnv, rightsLlmEnv } from '../config.js';
import { createLlmClient } from '../factory.js';
import { GEMINI_GROUNDING_USD_PER_QUERY } from '../pricing.js';
import type { LlmJsonRequest } from '../types.js';
import { GEMINI_API_BASE, GeminiLlmClient, NO_RECITATION_NOTE, type FetchLike } from './gemini.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};
const MODELS = { light: 'gemini-3.5-flash-lite', standard: 'gemini-3.8-flash', research: 'gemini-3.8-flash' };
const noSleep = { sleep: async () => {} };
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';

const req = (over: Partial<LlmJsonRequest> = {}): LlmJsonRequest => ({
  tier: 'research',
  system: 'sistema',
  messages: [
    { role: 'system', content: 'extra' },
    { role: 'user', content: 'pergunta' },
  ],
  schema: SCHEMA,
  schemaName: 'resposta',
  webSearch: true,
  allowedDomains: ['conmebol.com'],
  purpose: 'wtw:rights:conmebol-libertadores:2026',
  ...over,
});

/** fetch falso: a API devolve `replies` em ordem; o link de redirecionamento responde 302. */
function fakeFetch(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (url === REDIRECT)
      return new Response(null, { status: 302, headers: { location: 'https://www.conmebol.com/tv' } });
    calls.push({
      url,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: init.headers as Record<string, string>,
    });
    const r = replies.shift();
    if (!r) throw new Error('sem resposta');
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { fetch, calls };
}

const ok = (answer: string) => ({
  status: 200,
  body: {
    id: 'i-1',
    status: 'completed',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['libertadores tv argentina', 'x'] } },
      { type: 'google_search_result' },
      {
        type: 'model_output',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ answer }),
            annotations: [
              { type: 'url_citation', url: REDIRECT, title: 'conmebol.com' },
              { type: 'url_citation', url: 'https://tycsports.com/x', title: 'TyC' },
            ],
          },
        ],
      },
    ],
    usage: {
      total_input_tokens: 1000,
      total_tool_use_tokens: 200,
      total_output_tokens: 300,
      total_thought_tokens: 100,
      grounding_tool_count: [{ type: 'google_search', count: 3 }],
    },
  },
});

describe('GeminiLlmClient (API Interactions + Grounding with Google Search)', () => {
  it('monta a requisição: busca do Google, JSON Schema, instruções e sem guardar a interação', async () => {
    const f = fakeFetch([ok('Fox Sports')]);
    const client = new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: noSleep });
    await client.generateJson(req());
    expect(f.calls[0]!.url).toBe(`${GEMINI_API_BASE}/interactions`);
    expect(f.calls[0]!.headers['x-goog-api-key']).toBe('k');
    expect(f.calls[0]!.body).toMatchObject({
      model: 'gemini-3.8-flash',
      system_instruction: `sistema\n\nextra\n\n${NO_RECITATION_NOTE}`,
      input: 'pergunta',
      tools: [{ type: 'google_search' }],
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
      store: false,
    });
    const noSearch = fakeFetch([ok('x')]);
    await new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: noSearch.fetch }).generateJson(
      req({ webSearch: false }),
    );
    expect(noSearch.calls[0]!.body).not.toHaveProperty('tools');
  });

  it('lê o JSON, resolve os links de redirecionamento e cobra tokens + consultas de busca', async () => {
    const f = fakeFetch([ok('Fox Sports')]);
    const client = new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: noSleep });
    const r = await client.generateJson<{ answer: string }>(req());
    expect(r.data).toEqual({ answer: 'Fox Sports' });
    expect(r.provider).toBe('gemini');
    expect(r.citations.map((c) => c.url)).toEqual(['https://www.conmebol.com/tv', 'https://tycsports.com/x']);
    // entrada = prompt + resultado das ferramentas; saída = resposta + raciocínio
    expect(r.usage).toMatchObject({ inputTokens: 1200, outputTokens: 400, webSearchCalls: 3 });
    const expected = (1200 * 0.75 + 400 * 3.75) / 1_000_000 + 3 * GEMINI_GROUNDING_USD_PER_QUERY;
    expect(r.usage.costUsd).toBeCloseTo(expected, 6);
  });

  it('sem crédito pré-pago (402): erro de cota, sem nova tentativa', async () => {
    const f = fakeFetch([
      {
        status: 402,
        body: [
          {
            error: {
              code: 402,
              message: 'Your prepayment credits are depleted. Please go to AI Studio.',
              status: 'RESOURCE_EXHAUSTED',
            },
          },
        ],
      },
    ]);
    const client = new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: noSleep });
    await expect(client.generateJson(req())).rejects.toMatchObject({ kind: 'quota', retryable: false });
    expect(f.calls).toHaveLength(1);
  });

  it('erro passageiro (503) é repetido; saída fora do schema também', async () => {
    const f = fakeFetch([
      { status: 503, body: { error: { message: 'overloaded' } } },
      {
        status: 200,
        body: {
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: '{}' }] }],
        },
      },
      ok('ESPN'),
    ]);
    const client = new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: noSleep });
    const r = await client.generateJson<{ answer: string }>(req());
    expect(r.data.answer).toBe('ESPN');
    expect(f.calls).toHaveLength(3);
  });

  it('sem chave: erro de configuração', () => {
    expect(() => new GeminiLlmClient({ models: MODELS })).toThrow(/GEMINI_API_KEY/);
  });
});

describe('provedor da pesquisa de direitos (AI_RIGHTS_PROVIDER)', () => {
  it('gemini com GEMINI_API_KEY e o modelo de pesquisa padrão; os AI_MODEL_* do outro provedor não valem', () => {
    const env = {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'o',
      GEMINI_API_KEY: 'g',
      AI_MODEL_RESEARCH: 'gpt-6.1-sol',
      AI_RIGHTS_PROVIDER: 'gemini',
    };
    const s = llmSettingsFromEnv(rightsLlmEnv(env));
    expect(s).toMatchObject({ provider: 'gemini', apiKey: 'g' });
    expect(s.models.research).toBe('gemini-3.8-flash');
    expect(
      llmSettingsFromEnv(rightsLlmEnv({ ...env, AI_RIGHTS_MODEL: 'gemini-4-argon' })).models.research,
    ).toBe('gemini-4-argon');
    expect(createLlmClient({ env: rightsLlmEnv(env) }).settings.provider).toBe('gemini');
  });

  it('sem AI_RIGHTS_PROVIDER: o mesmo provedor e modelos dos demais agentes', () => {
    const env = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a', AI_MODEL_RESEARCH: 'claude-opus-5-5' };
    expect(rightsLlmEnv(env)).toBe(env);
    expect(llmSettingsFromEnv(rightsLlmEnv(env)).models.research).toBe('claude-opus-5-5');
  });
});
