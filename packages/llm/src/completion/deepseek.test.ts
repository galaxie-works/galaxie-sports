import { afterEach, describe, expect, it } from 'vitest';
import { LlmError } from '../errors.js';
import { setModelPriceOverrides } from '../pricing.js';
import { DeepSeekLlmClient } from '../providers/deepseek.js';
import type { CompletionStreamEvent, LlmJsonRequest } from '../types.js';
import { createCompletionClient } from './index.js';
import { DEEPSEEK_API_BASE, DeepSeekCompletionClient } from './openai-compatible.js';
import { collect, fakeFetch, hangingResponse, jsonResponse, sseResponse } from './test-helpers.js';

const noSleep = { sleep: async () => {}, random: () => 0 };

/** deepseek-flash: US$ 0,30 entrada, 0,006 cache, 1,20 saída por milhão (pico). */
const USAGE = {
  prompt_tokens: 1_000,
  completion_tokens: 500,
  prompt_cache_hit_tokens: 600,
  prompt_cache_miss_tokens: 400,
};
const COST = (400 * 0.3 + 600 * 0.006 + 500 * 1.2) / 1_000_000;

const completion = (content: string, finish = 'stop', usage: unknown = USAGE) => ({
  id: 'c1',
  object: 'chat.completion',
  model: 'deepseek-flash',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
  usage,
});

const client = (
  replies: Parameters<typeof fakeFetch>[0],
  opts: { timeoutMs?: number; maxRetries?: number } = {},
) => {
  const f = fakeFetch(replies);
  return { f, c: new DeepSeekCompletionClient({ apiKey: 'k', fetch: f, retry: noSleep, ...opts }) };
};

afterEach(() => setModelPriceOverrides(null));

describe('DeepSeekCompletionClient (Chat Completions compatível com a OpenAI)', () => {
  it('resposta inteira: URL, chave, corpo e uso com o cache (hit/miss) e o custo', async () => {
    const { f, c } = client([jsonResponse(200, completion('olá'))]);
    const r = await c.complete({
      model: 'deepseek-flash',
      system: 'Seja breve.',
      messages: [{ role: 'user', content: 'oi' }],
      maxOutputTokens: 50,
      temperature: 0.2,
      json: true,
    });
    expect(r).toMatchObject({
      text: 'olá',
      final: true,
      finishReason: 'stop',
      provider: 'deepseek',
      model: 'deepseek-flash',
    });
    expect(r.usage).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 600,
      cacheWriteTokens: 0,
      outputTokens: 500,
      costUsd: Math.round(COST * 1_000_000) / 1_000_000,
    });
    expect(f.calls[0]!.url).toBe(`${DEEPSEEK_API_BASE}/chat/completions`);
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(f.calls[0]!.body).toEqual({
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: 'Seja breve.' },
        { role: 'user', content: 'oi' },
      ],
      max_tokens: 50,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  });

  it('preço de AI_MODEL_PRICES vale por cima da tabela', async () => {
    setModelPriceOverrides('deepseek-flash=1/0.5/2');
    const { c } = client([jsonResponse(200, completion('x'))]);
    const r = await c.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'oi' }] });
    expect(r.usage.costUsd).toBeCloseTo((400 * 1 + 600 * 0.5 + 500 * 2) / 1_000_000, 6);
  });

  it('modelo fora da tabela (ex.: deepseek-chat) usa o preço mais caro do provedor, nunca de graça', async () => {
    const { c } = client([jsonResponse(200, { ...completion('x'), model: 'deepseek-chat' })]);
    const r = await c.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'oi' }] });
    expect(r.usage.costUsd).toBeGreaterThan(COST);
  });

  it('streaming: pedaços de texto e o uso final (include_usage) no último evento', async () => {
    const { f, c } = client([
      sseResponse([
        { data: { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] } },
        { data: { choices: [{ index: 0, delta: { reasoning_content: 'pensando' } }] } },
        { data: { choices: [{ index: 0, delta: { content: 'Bom ' } }] } },
        { data: { choices: [{ index: 0, delta: { content: 'jogo!' }, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: USAGE } },
        { data: '[DONE]' },
      ]),
    ]);
    const events = await collect(
      c.stream({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'oi' }] }),
    );
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual([
      'Bom ',
      'jogo!',
    ]);
    const last = events.at(-1) as Extract<CompletionStreamEvent, { type: 'usage' }>;
    expect(last).toMatchObject({
      type: 'usage',
      final: true,
      finishReason: 'stop',
      usage: { inputTokens: 1_000, cachedInputTokens: 600, cacheWriteTokens: 0, outputTokens: 500 },
    });
    expect(f.calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('streaming interrompido antes do fim: erro retentável com o uso parcial', async () => {
    const { c } = client([sseResponse([{ data: { choices: [{ index: 0, delta: { content: 'Bo' } }] } }])]);
    const err = await collect(
      c.stream({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'oi' }] }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: 'provider', retryable: true, usage: { outputTokens: 0 } });
  });

  it('streaming cortado depois do finish_reason, sem o pedaço de uso nem o [DONE]: erro retentável', async () => {
    const { c } = client([
      sseResponse([
        { data: { choices: [{ index: 0, delta: { content: 'Bom jogo' }, finish_reason: 'stop' }] } },
      ]),
    ]);
    const events: CompletionStreamEvent[] = [];
    const err = await (async () => {
      for await (const ev of c.stream({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: 'oi' }],
      }))
        events.push(ev);
    })().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'provider', retryable: true });
    expect((err as Error).message).toMatch(/terminou antes do fim/);
    // nenhum uso final de 0 tokens / US$ 0
    expect(events.some((e) => e.type === 'usage' && e.final)).toBe(false);
  });

  it('streaming com o pedaço de uso e sem o [DONE]: termina com o uso final', async () => {
    const { c } = client([
      sseResponse([
        { data: { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: USAGE } },
      ]),
    ]);
    const events = await collect(c.stream({ model: 'deepseek-flash', messages: [] }));
    expect(events.at(-1)).toMatchObject({ type: 'usage', final: true, usage: { inputTokens: 1_000 } });
  });

  it('erro 400: provider, sem retentativa, com a mensagem do provedor', async () => {
    const { f, c } = client([
      jsonResponse(400, {
        error: { message: 'Invalid model', type: 'invalid_request_error', code: 'invalid_request_error' },
      }),
    ]);
    const err = await c
      .complete({ model: 'x', messages: [{ role: 'user', content: 'oi' }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'provider', retryable: false });
    expect((err as Error).message).toMatch(/deepseek: Invalid model/);
    expect(f.calls).toHaveLength(1);
  });

  it('chave recusada (401): auth; sem saldo (402 Insufficient Balance): quota; nenhum é retentado', async () => {
    const auth = client([
      jsonResponse(401, { error: { message: 'Authentication Fails', type: 'authentication_error' } }),
    ]);
    await expect(auth.c.complete({ model: 'deepseek-flash', messages: [] })).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    const quota = client([
      jsonResponse(402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } }),
    ]);
    await expect(quota.c.complete({ model: 'deepseek-flash', messages: [] })).rejects.toMatchObject({
      kind: 'quota',
      retryable: false,
    });
    expect(auth.f.calls).toHaveLength(1);
    expect(quota.f.calls).toHaveLength(1);
  });

  it('429: limite de taxa, tenta de novo e passa; esgotadas as tentativas, sobe rate_limit', async () => {
    const ok = client([
      jsonResponse(429, { error: { message: 'Rate Limit Reached' } }),
      jsonResponse(200, completion('ok')),
    ]);
    expect((await ok.c.complete({ model: 'deepseek-flash', messages: [] })).text).toBe('ok');
    expect(ok.f.calls).toHaveLength(2);
    const bad = client(
      [jsonResponse(429, { error: { message: 'Rate Limit Reached' } }), jsonResponse(429, { error: {} })],
      { maxRetries: 1 },
    );
    await expect(bad.c.complete({ model: 'deepseek-flash', messages: [] })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
    expect(bad.f.calls).toHaveLength(2);
  });

  it('503 (servidor sobrecarregado): server/provider retentável', async () => {
    const { f, c } = client([
      jsonResponse(503, { error: { message: 'Server Overloaded' } }),
      jsonResponse(200, completion('ok')),
    ]);
    expect((await c.complete({ model: 'deepseek-flash', messages: [] })).text).toBe('ok');
    expect(f.calls).toHaveLength(2);
  });

  it('timeout: o provedor não responde no prazo; erro timeout retentável (também no streaming)', async () => {
    const { f, c } = client([hangingResponse(), hangingResponse()], { timeoutMs: 20, maxRetries: 1 });
    await expect(c.complete({ model: 'deepseek-flash', messages: [] })).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
    expect(f.calls).toHaveLength(2);
    const s = client([hangingResponse()], { maxRetries: 0 });
    await expect(
      collect(s.c.stream({ model: 'deepseek-flash', messages: [], timeoutMs: 20 })),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('cancelado por quem chamou: não tenta de novo', async () => {
    const ac = new AbortController();
    const { f, c } = client([hangingResponse(), jsonResponse(200, completion('não'))]);
    const p = c.complete({ model: 'deepseek-flash', messages: [], signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ retryable: false });
    expect(f.calls).toHaveLength(1);
  });

  it('sinal de quem chamou que expira (AbortSignal.timeout): cancelamento, sem retentativa', async () => {
    const { f, c } = client([hangingResponse(), hangingResponse(), hangingResponse()]);
    const err = await c
      .complete({ model: 'deepseek-flash', messages: [], signal: AbortSignal.timeout(20) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: 'provider', retryable: false });
    expect((err as Error).message).toMatch(/cancelada/);
    expect(f.calls).toHaveLength(1);
    const s = client([hangingResponse(), hangingResponse()]);
    await expect(
      collect(s.c.stream({ model: 'deepseek-flash', messages: [], signal: AbortSignal.timeout(20) })),
    ).rejects.toMatchObject({ retryable: false });
    expect(s.f.calls).toHaveLength(1);
  });

  it('cancelado durante a espera entre tentativas: a espera acaba na hora e nada é tentado de novo', async () => {
    const f = fakeFetch([
      jsonResponse(429, { error: { message: 'Rate Limit Reached' } }),
      jsonResponse(200, completion('não')),
    ]);
    // espera real (abortável) de até 60 s entre as tentativas
    const c = new DeepSeekCompletionClient({
      apiKey: 'k',
      fetch: f,
      retry: { baseDelayMs: 60_000, random: () => 1 },
    });
    const ac = new AbortController();
    const started = Date.now();
    const p = c.complete({ model: 'deepseek-flash', messages: [], signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ kind: 'provider', retryable: false });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(f.calls).toHaveLength(1);
  });

  it('já cancelado antes de chamar: nada sai', async () => {
    const { f, c } = client([jsonResponse(200, completion('não'))]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      c.complete({ model: 'deepseek-flash', messages: [], signal: ac.signal }),
    ).rejects.toMatchObject({
      retryable: false,
    });
    expect(f.calls).toHaveLength(0);
  });

  it('sem chave: erro de configuração; a fábrica monta o cliente pelo nome', () => {
    expect(() => new DeepSeekCompletionClient({})).toThrow(/DEEPSEEK_API_KEY/);
    expect(createCompletionClient('deepseek', { apiKey: 'k' }).provider).toBe('deepseek');
  });
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['ok', 'block'] } },
};
const REQ: LlmJsonRequest = {
  tier: 'light',
  system: 'Modere a mensagem.',
  messages: [{ role: 'user', content: 'olá' }],
  schema: SCHEMA,
  schemaName: 'moderation',
  purpose: 'moderation:test',
};
const MODELS = { light: 'deepseek-flash', standard: 'deepseek-flash', research: 'deepseek-v4-pro' };

describe('DeepSeekLlmClient (saída JSON com schema)', () => {
  it('modo JSON com o schema nas instruções; valida e devolve o uso com o custo', async () => {
    const f = fakeFetch([jsonResponse(200, completion('{"verdict":"ok"}'))]);
    const c = new DeepSeekLlmClient({ fetch: f, models: MODELS, retry: noSleep });
    const r = await c.generateJson<{ verdict: string }>(REQ);
    expect(r).toMatchObject({
      data: { verdict: 'ok' },
      provider: 'deepseek',
      model: 'deepseek-flash',
      citations: [],
    });
    expect(r.usage).toMatchObject({ inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 600 });
    expect(r.usage.costUsd).toBeCloseTo(COST, 6);
    const body = f.calls[0]!.body as {
      messages: Array<{ role: string; content: string }>;
      response_format: unknown;
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]!.content).toContain('Modere a mensagem.');
    expect(body.messages[0]!.content).toContain(JSON.stringify(SCHEMA));
  });

  it('saída fora do schema: tenta de novo (conferindo o orçamento) e cobra as duas', async () => {
    const f = fakeFetch([
      jsonResponse(200, completion('{"verdict":"talvez"}')),
      jsonResponse(200, completion('{"verdict":"block"}')),
    ]);
    const spent: unknown[] = [];
    const c = new DeepSeekLlmClient({ fetch: f, models: MODELS, retry: noSleep });
    const r = await c.generateJson<{ verdict: string }>({ ...REQ, budgetCheck: (s) => void spent.push(s) });
    expect(r.data.verdict).toBe('block');
    expect(r.usage).toMatchObject({ inputTokens: 2_000, outputTokens: 1_000 });
    expect(spent).toEqual([{ tokens: 1_500, usd: expect.any(Number) }]);
  });

  it('erro depois de uma resposta paga: o uso vai junto do erro', async () => {
    const f = fakeFetch([
      jsonResponse(200, completion('não é json')),
      jsonResponse(400, { error: { message: 'bad' } }),
    ]);
    const c = new DeepSeekLlmClient({ fetch: f, models: MODELS, retry: noSleep });
    const err = await c.generateJson(REQ).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'provider', usage: { inputTokens: 1_000, outputTokens: 500 } });
  });

  it('resposta cortada (length): incompleta, sem retentativa', async () => {
    const f = fakeFetch([jsonResponse(200, completion('{"verd', 'length'))]);
    const c = new DeepSeekLlmClient({ fetch: f, models: MODELS, retry: noSleep });
    await expect(c.generateJson(REQ)).rejects.toMatchObject({ kind: 'incomplete', retryable: false });
  });

  it('busca na web: erro de configuração antes de chamar', async () => {
    const f = fakeFetch([]);
    const c = new DeepSeekLlmClient({ fetch: f, models: MODELS });
    await expect(c.generateJson({ ...REQ, webSearch: true })).rejects.toMatchObject({ kind: 'config' });
    expect(f.calls).toHaveLength(0);
  });

  it('sem chave: erro de configuração', () => {
    expect(() => new DeepSeekLlmClient({ models: MODELS })).toThrow(/DEEPSEEK_API_KEY/);
  });
});

describe('DeepSeek e anexo', () => {
  it('recusa PDF anexado (config, sem tentar de novo)', () => {
    const c = new DeepSeekCompletionClient({ apiKey: 'k' });
    expect(() =>
      c.wire(
        {
          model: 'deepseek-flash',
          messages: [{ role: 'user', content: 'leia' }],
          attachments: [{ mediaType: 'application/pdf', data: 'JVBERi0=' }],
        },
        false,
      ),
    ).toThrow(LlmError);
  });
});
