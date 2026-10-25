import { describe, expect, it } from 'vitest';
import { LlmError } from '../errors.js';
import type { LlmJsonRequest } from '../types.js';
import { AnthropicLlmClient } from './anthropic.js';
import { OpenAiLlmClient } from './openai.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};
const MODELS = { light: 'gpt-6-luna', standard: 'gpt-6.1-sol', research: 'gpt-6.1-sol' };
const A_MODELS = { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', research: 'claude-sonnet-5-5' };
const noSleep = { sleep: async () => {} };

const req = (over: Partial<LlmJsonRequest> = {}): LlmJsonRequest => ({
  tier: 'research',
  system: 'sistema',
  messages: [
    { role: 'system', content: 'extra' },
    { role: 'user', content: 'pergunta' },
  ],
  schema: SCHEMA,
  schemaName: 'resposta final',
  webSearch: true,
  allowedDomains: ['globo.com', 'conmebol.com'],
  purpose: 'wtw:event:abc:BR',
  ...over,
});

function fakeSdk<T>(replies: (T | Error)[]) {
  const calls: Record<string, unknown>[] = [];
  const create = async (params: Record<string, unknown>) => {
    calls.push(structuredClone(params));
    const r = replies.shift();
    if (!r) throw new Error('sem resposta');
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, create };
}

const openAiOk = (text: string, extra: object = {}) => ({
  status: 'completed',
  output_text: text,
  output: [
    { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://conmebol.com/a' }] } },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text,
          annotations: [{ type: 'url_citation', url: 'https://ge.globo.com/x', title: 'ge' }],
        },
      ],
    },
  ],
  usage: { input_tokens: 1_000, output_tokens: 200, input_tokens_details: { cached_tokens: 0 } },
  ...extra,
});

describe('OpenAiLlmClient (Responses API)', () => {
  it('monta saída estruturada estrita + web_search com allowlist e país do purpose', async () => {
    const sdk = fakeSdk([openAiOk('{"answer":"ok"}')]);
    const client = new OpenAiLlmClient({
      models: MODELS,
      sdk: { responses: { create: sdk.create } },
      retry: noSleep,
    });
    const out = await client.generateJson<{ answer: string }>(req());
    const p = sdk.calls[0]!;
    expect(p).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'sistema\n\nextra',
      input: [{ role: 'user', content: 'pergunta' }],
      text: { format: { type: 'json_schema', name: 'resposta_final', strict: true } },
      tools: [
        {
          type: 'web_search',
          filters: { allowed_domains: ['globo.com', 'conmebol.com'] },
          user_location: { type: 'approximate', country: 'BR' },
        },
      ],
      include: ['web_search_call.action.sources'],
      store: false,
    });
    expect(out.data).toEqual({ answer: 'ok' });
    expect(out.citations.map((c) => c.url)).toEqual(['https://ge.globo.com/x', 'https://conmebol.com/a']);
    expect(out.usage).toMatchObject({ inputTokens: 1_000, outputTokens: 200, webSearchCalls: 1 });
    expect(out.usage.costUsd).toBeCloseTo((1_000 * 2 + 200 * 10) / 1e6 + 0.01, 6);
    expect(out.provider).toBe('openai');
  });

  it('tenta de novo saída fora do schema e 429, somando o uso cobrado', async () => {
    const sdk = fakeSdk([
      Object.assign(new Error('rate'), { status: 429 }),
      openAiOk('{"answer": 1}'),
      openAiOk('{"answer":"ok"}'),
    ]);
    const client = new OpenAiLlmClient({
      models: MODELS,
      sdk: { responses: { create: sdk.create } },
      retry: noSleep,
    });
    const out = await client.generateJson(req({ webSearch: false }));
    expect(sdk.calls).toHaveLength(3);
    expect(sdk.calls[0]!.tools).toBeUndefined();
    expect(out.usage.inputTokens).toBe(2_000);
  });

  it('modelo que recusa temperature: repete sem o parâmetro e não o manda mais', async () => {
    const sdk = fakeSdk([
      Object.assign(new Error("400 Unsupported parameter: 'temperature' is not supported with this model."), {
        status: 400,
      }),
      openAiOk('{"answer":"ok"}'),
      openAiOk('{"answer":"ok"}'),
    ]);
    const client = new OpenAiLlmClient({
      models: MODELS,
      sdk: { responses: { create: sdk.create } },
      retry: noSleep,
    });
    const out = await client.generateJson(req({ webSearch: false, temperature: 0.3 }));
    expect(out.data).toEqual({ answer: 'ok' });
    await client.generateJson(req({ webSearch: false, temperature: 0.3 }));
    expect(sdk.calls.map((c) => c.temperature)).toEqual([0.3, undefined, undefined]);
  });

  it('recusa e resposta incompleta não são retentadas; schema não estrito falha cedo', async () => {
    const refusal = {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'não' }] }],
    };
    const sdk = fakeSdk([refusal]);
    const client = new OpenAiLlmClient({
      models: MODELS,
      sdk: { responses: { create: sdk.create } },
      retry: noSleep,
    });
    await expect(client.generateJson(req())).rejects.toMatchObject({ kind: 'refusal' });
    const sdk2 = fakeSdk([
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
    ]);
    const c2 = new OpenAiLlmClient({
      models: MODELS,
      sdk: { responses: { create: sdk2.create } },
      retry: noSleep,
    });
    await expect(c2.generateJson(req())).rejects.toMatchObject({ kind: 'incomplete' });
    await expect(
      client.generateJson(req({ schema: { type: 'object', properties: { a: { type: 'string' } } } })),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('exige chave sem SDK injetado', () => {
    expect(() => new OpenAiLlmClient({ models: MODELS })).toThrow(LlmError);
  });
});

describe('AnthropicLlmClient (Messages API + ferramenta de saída)', () => {
  const usage = (i: number, o: number, searches = 0) => ({
    input_tokens: i,
    output_tokens: o,
    server_tool_use: { web_search_requests: searches },
  });

  it('pesquisa com web_search, continua pause_turn e lê a ferramenta de saída', async () => {
    const sdk = fakeSdk([
      {
        stop_reason: 'pause_turn',
        content: [{ type: 'server_tool_use', name: 'web_search', input: { query: 'x' } }],
        usage: usage(500, 50, 1),
      },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', url: 'https://conmebol.com/r', title: 'r' }],
          },
          {
            type: 'text',
            text: 'achei',
            citations: [{ type: 'web_search_result_location', url: 'https://ge.globo.com/x', title: 'ge' }],
          },
          { type: 'tool_use', name: 'submit_resposta_final', input: { answer: 'ok' } },
        ],
        usage: usage(700, 80, 1),
      },
    ]);
    const client = new AnthropicLlmClient({
      models: A_MODELS,
      sdk: { messages: { create: sdk.create } },
      retry: noSleep,
    });
    const out = await client.generateJson<{ answer: string }>(req());
    expect(out.data).toEqual({ answer: 'ok' });
    expect(out.model).toBe('claude-sonnet-5-5');
    const first = sdk.calls[0]!;
    expect(first.system).toBe('sistema\n\nextra');
    expect(first.tool_choice).toEqual({ type: 'auto' });
    expect(first.tools).toEqual([
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 6,
        allowed_domains: ['globo.com', 'conmebol.com'],
        user_location: { type: 'approximate', country: 'BR' },
      },
      expect.objectContaining({ name: 'submit_resposta_final', input_schema: SCHEMA, strict: true }),
    ]);
    expect((sdk.calls[1]!.messages as unknown[]).length).toBe(2); // pergunta + turno pausado
    // teto de buscas da chamada (AI_MAX_SEARCHES_PER_CALL, preenchido pelo orçamento) vira max_uses
    expect(client.buildTools(req({ maxSearches: 3 }))[0]).toMatchObject({ max_uses: 3 });
    expect(out.citations.map((c) => c.url)).toEqual(['https://conmebol.com/r', 'https://ge.globo.com/x']);
    expect(out.usage).toMatchObject({ inputTokens: 1_200, outputTokens: 130, webSearchCalls: 2 });
  });

  it('sem busca força a ferramenta; terminou sem chamar → pede a entrega forçada', async () => {
    const sdk = fakeSdk([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'pensei' }], usage: usage(10, 5) },
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'submit_resposta_final', input: { answer: 'ok' } }],
        usage: usage(10, 5),
      },
    ]);
    const client = new AnthropicLlmClient({
      models: A_MODELS,
      sdk: { messages: { create: sdk.create } },
      retry: noSleep,
    });
    await client.generateJson(req());
    expect(sdk.calls[1]!.tool_choice).toEqual({ type: 'tool', name: 'submit_resposta_final' });

    const sdk2 = fakeSdk([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'submit_resposta_final', input: { answer: 'x' } }],
        usage: usage(1, 1),
      },
    ]);
    const c2 = new AnthropicLlmClient({
      models: A_MODELS,
      sdk: { messages: { create: sdk2.create } },
      retry: noSleep,
    });
    await c2.generateJson(req({ webSearch: false }));
    expect(sdk2.calls[0]!.tool_choice).toEqual({ type: 'tool', name: 'submit_resposta_final' });
    expect((sdk2.calls[0]!.tools as unknown[]).length).toBe(1);
  });

  it('recusa não é retentada', async () => {
    const sdk = fakeSdk([{ stop_reason: 'refusal', content: [], usage: usage(1, 1) }]);
    const client = new AnthropicLlmClient({
      models: A_MODELS,
      sdk: { messages: { create: sdk.create } },
      retry: noSleep,
    });
    await expect(client.generateJson(req())).rejects.toMatchObject({ kind: 'refusal' });
    expect(sdk.calls).toHaveLength(1);
  });
});

describe('teto de buscas por chamada (OpenAI)', () => {
  it('max_tool_calls só com busca e teto; a busca é a única ferramenta embutida', () => {
    const client = new OpenAiLlmClient({ models: MODELS, sdk: { responses: { create: async () => ({}) } } });
    expect(client.buildParams(req({ maxSearches: 4 }), 'gpt-6.1-sol')).toMatchObject({ max_tool_calls: 4 });
    expect(client.buildParams(req(), 'gpt-6.1-sol')).not.toHaveProperty('max_tool_calls');
    expect(client.buildParams(req({ webSearch: false, maxSearches: 4 }), 'gpt-6.1-sol')).not.toHaveProperty(
      'max_tool_calls',
    );
  });
});
