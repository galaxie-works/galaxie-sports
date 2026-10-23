import { describe, expect, it } from 'vitest';
import { llmSettingsFromEnv, rightsLlmEnv } from '../config.js';
import { createLlmClient } from '../factory.js';
import { GEMINI_GROUNDING_USD_PER_QUERY } from '../pricing.js';
import type { LlmJsonRequest } from '../types.js';
import {
  allowlistNote,
  GEMINI_API_BASE,
  GeminiLlmClient,
  NO_RECITATION_NOTE,
  RESEARCH_STEP_NOTE,
  segmentOf,
  sourcesBlock,
  STRUCTURE_STEP_NOTE,
  type FetchLike,
} from './gemini.js';

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
    if (url.startsWith(REDIRECT)) return new Response(null, { status: 404 });
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

/** Resposta da API: só texto (o JSON do passo 2 ou do pedido sem busca). */
const ok = (answer: string, usage: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ answer }) }] }],
    usage: { total_input_tokens: 500, total_output_tokens: 50, ...usage },
  },
});

/** Passo 1: texto com as citações do grounding (índices em bytes; "é" ocupa 2 bytes). */
const RESEARCH_TEXT = 'Argentina: Fox Sports e Telefe. Brasil: Globo é o detentor.';
const seg = (s: string) => {
  const start = Buffer.byteLength(RESEARCH_TEXT.slice(0, RESEARCH_TEXT.indexOf(s)), 'utf8');
  return { start_index: start, end_index: start + Buffer.byteLength(s, 'utf8') };
};
const research = {
  status: 200,
  body: {
    status: 'completed',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['libertadores tv argentina', 'x'] } },
      { type: 'google_search_result' },
      {
        type: 'model_output',
        content: [
          {
            type: 'text',
            text: RESEARCH_TEXT,
            annotations: [
              {
                type: 'url_citation',
                url: REDIRECT,
                title: 'conmebol.com',
                ...seg('Argentina: Fox Sports e Telefe.'),
              },
              { type: 'url_citation', url: REDIRECT, title: 'conmebol.com', ...seg('Fox Sports') },
              {
                type: 'url_citation',
                url: 'https://ge.globo.com/x',
                title: 'ge',
                ...seg('Globo é o detentor.'),
              },
              // redirecionamento que não resolve: a fonte sai
              { type: 'url_citation', url: `${REDIRECT}-quebrado`, title: 'x', ...seg('Brasil') },
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
};

describe('GeminiLlmClient (API Interactions + Grounding with Google Search)', () => {
  it('com busca, dois passos: texto com grounding e depois o JSON só com as fontes do grounding', async () => {
    const f = fakeFetch([research, ok('Fox Sports')]);
    const client = new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: noSleep });
    const r = await client.generateJson<{ answer: string }>(req());
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.url).toBe(`${GEMINI_API_BASE}/interactions`);
    expect(f.calls[0]!.headers['x-goog-api-key']).toBe('k');
    // passo 1: busca, sem JSON, modelo de pesquisa
    expect(f.calls[0]!.body).toMatchObject({
      model: 'gemini-3.8-flash',
      input: 'pergunta',
      tools: [{ type: 'google_search' }],
      store: false,
    });
    expect(f.calls[0]!.body).not.toHaveProperty('response_format');
    expect(f.calls[0]!.body!.system_instruction).toContain(RESEARCH_STEP_NOTE);
    expect(f.calls[0]!.body!.system_instruction).toContain(allowlistNote(['conmebol.com']));
    expect(allowlistNote([])).toBe('');
    // passo 2: modelo leve, sem busca, JSON Schema, texto + fontes reais numeradas com os trechos
    const step2 = f.calls[1]!.body!;
    expect(step2).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
    });
    expect(step2).not.toHaveProperty('tools');
    expect(step2.system_instruction).toContain(STRUCTURE_STEP_NOTE);
    expect(step2.input).toContain(RESEARCH_TEXT);
    expect(step2.input).toContain(
      '[S1] https://www.conmebol.com/tv (conmebol.com)\n   - "Argentina: Fox Sports e Telefe."\n   - "Fox Sports"',
    );
    expect(step2.input).toContain('[S2] https://ge.globo.com/x (ge)\n   - "Globo é o detentor."');
    expect(step2.input).not.toContain('vertexaisearch');
    // resultado: só as URLs reais do grounding (o redirecionamento quebrado ficou de fora)
    expect(r.data).toEqual({ answer: 'Fox Sports' });
    expect(r.provider).toBe('gemini');
    expect(r.groundedUrls).toEqual(['https://www.conmebol.com/tv', 'https://ge.globo.com/x']);
    expect(r.citations.map((c) => c.url)).toEqual(r.groundedUrls);
    // custo: passo 1 no modelo de pesquisa + buscas; passo 2 no modelo leve
    expect(r.usage).toMatchObject({ inputTokens: 1700, outputTokens: 450, webSearchCalls: 3 });
    const expected =
      (1200 * 0.75 + 400 * 3.75) / 1_000_000 +
      3 * GEMINI_GROUNDING_USD_PER_QUERY +
      (500 * 0.3 + 50 * 2.5) / 1_000_000;
    expect(r.usage.costUsd).toBeCloseTo(expected, 6);
  });

  it('sem busca: um passo só, com JSON Schema e sem groundedUrls', async () => {
    const f = fakeFetch([ok('x')]);
    const r = await new GeminiLlmClient({ apiKey: 'k', models: MODELS, fetch: f.fetch }).generateJson(
      req({ webSearch: false }),
    );
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.body).toMatchObject({
      model: 'gemini-3.8-flash',
      system_instruction: `sistema\n\nextra\n\n${NO_RECITATION_NOTE}`,
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
    });
    expect(f.calls[0]!.body).not.toHaveProperty('tools');
    expect(r).not.toHaveProperty('groundedUrls');
  });

  it('trecho pelos índices em bytes UTF-8 e lista numerada de fontes', () => {
    expect(segmentOf('São Paulo: Globo', 0, Buffer.byteLength('São Paulo', 'utf8'))).toBe('São Paulo');
    expect(segmentOf('abc', 2, 2)).toBe('');
    expect(sourcesBlock([{ url: 'https://a.com', title: null, segments: [] }])).toBe('[S1] https://a.com');
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
    const r = await client.generateJson<{ answer: string }>(req({ webSearch: false }));
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
