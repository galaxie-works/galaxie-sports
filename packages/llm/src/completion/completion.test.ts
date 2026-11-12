import { describe, expect, it } from 'vitest';
import { readSse } from '../http.js';
import type { CompletionStreamEvent } from '../types.js';
import { AnthropicCompletionClient } from './anthropic.js';
import { GeminiCompletionClient } from './gemini.js';
import { OpenAiCompletionClient } from './openai-compatible.js';
import { collect, fakeFetch, jsonResponse, sseResponse } from './test-helpers.js';

const noSleep = { sleep: async () => {}, random: () => 0 };
const MSG = [{ role: 'user' as const, content: 'oi' }];
const finalOf = (events: CompletionStreamEvent[]) =>
  events.at(-1) as Extract<CompletionStreamEvent, { type: 'usage' }>;
const textOf = (events: CompletionStreamEvent[]) =>
  events
    .filter((e) => e.type === 'text')
    .map((e) => (e as { delta: string }).delta)
    .join('');

describe('readSse', () => {
  it('junta linhas partidas entre pedaços, lê event:/data: e ignora comentários', async () => {
    const res = sseResponse([{ event: 'a', data: { x: 1 } }, { data: 'texto com: dois pontos' }], 3);
    const raw = await collect(readSse(res.body!));
    expect(raw).toEqual([{ event: 'a', data: '{"x":1}' }, { data: 'texto com: dois pontos' }]);
  });
});

describe('OpenAiCompletionClient', () => {
  it('max_completion_tokens e o cache em prompt_tokens_details', async () => {
    const f = fakeFetch([
      jsonResponse(200, {
        choices: [{ message: { content: 'oi' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
      }),
    ]);
    const c = new OpenAiCompletionClient({ apiKey: 'k', fetch: f, retry: noSleep });
    const r = await c.complete({ model: 'gpt-6-luna', messages: MSG, maxOutputTokens: 10 });
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.calls[0]!.body).toMatchObject({ max_completion_tokens: 10 });
    expect(r).toMatchObject({
      finishReason: 'length',
      usage: { inputTokens: 100, cachedInputTokens: 40, cacheWriteTokens: 0, outputTokens: 10 },
    });
    // preços da tabela para o modelo: 0,10 entrada, 0,01 cache, 0,50 saída
    expect(r.usage.costUsd).toBeCloseTo((60 * 0.1 + 40 * 0.01 + 10 * 0.5) / 1_000_000, 6);
  });
});

describe('AnthropicCompletionClient (Messages API)', () => {
  it('resposta inteira: entrada soma o cache lido e o gravado; gravação a 1,25× a entrada', async () => {
    const f = fakeFetch([
      jsonResponse(200, {
        content: [{ type: 'text', text: 'Olá' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
          output_tokens: 5,
        },
      }),
    ]);
    const c = new AnthropicCompletionClient({ apiKey: 'k', fetch: f, retry: noSleep });
    const r = await c.complete({ model: 'claude-haiku-4-5', system: 'S', messages: MSG });
    expect(f.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(f.calls[0]!.init.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(f.calls[0]!.body).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: 'S',
      messages: MSG,
    });
    expect(r.usage).toMatchObject({
      inputTokens: 160,
      cachedInputTokens: 100,
      cacheWriteTokens: 50,
      outputTokens: 5,
    });
    // preços da tabela para o modelo: 1 entrada, 0,1 cache, 5 saída, 1,25 gravação
    expect(r.usage.costUsd).toBeCloseTo((10 * 1 + 100 * 0.1 + 50 * 1.25 + 5 * 5) / 1_000_000, 6);
  });

  it('streaming: uso parcial no message_start e final depois do message_stop', async () => {
    const f = fakeFetch([
      sseResponse([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 10,
                cache_read_input_tokens: 90,
                cache_creation_input_tokens: 0,
                output_tokens: 1,
              },
            },
          },
        },
        { event: 'ping', data: { type: 'ping' } },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Gol' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } },
        },
        {
          event: 'message_delta',
          data: { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 7 } },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
    ]);
    const c = new AnthropicCompletionClient({ apiKey: 'k', fetch: f, retry: noSleep });
    const events = await collect(c.stream({ model: 'claude-haiku-4-5', messages: MSG }));
    expect(textOf(events)).toBe('Gol!');
    expect(events[0]).toMatchObject({
      type: 'usage',
      final: false,
      usage: { inputTokens: 100, outputTokens: 1 },
    });
    expect(finalOf(events)).toMatchObject({
      final: true,
      finishReason: 'length',
      usage: { inputTokens: 100, cachedInputTokens: 90, cacheWriteTokens: 0, outputTokens: 7 },
    });
    expect(f.calls[0]!.body).toMatchObject({ stream: true });
  });

  it('evento de erro no meio do stream (overloaded): erro tipado com o uso parcial', async () => {
    const f = fakeFetch([
      sseResponse([
        {
          event: 'message_start',
          data: { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } },
        },
        {
          event: 'error',
          data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        },
      ]),
    ]);
    const c = new AnthropicCompletionClient({ apiKey: 'k', fetch: f, retry: noSleep });
    const err = await collect(c.stream({ model: 'claude-haiku-4-5', messages: MSG })).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ kind: 'provider', retryable: true, usage: { inputTokens: 5 } });
  });
});

describe('GeminiCompletionClient (generateContent)', () => {
  it('resposta inteira: papéis, instruções, modo JSON e o raciocínio contado na saída', async () => {
    const f = fakeFetch([
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: 'pensei', thought: true }, { text: '{"a":1}' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          cachedContentTokenCount: 30,
          candidatesTokenCount: 5,
          thoughtsTokenCount: 20,
        },
      }),
    ]);
    const c = new GeminiCompletionClient({ apiKey: 'g', fetch: f, retry: noSleep });
    const r = await c.complete({
      model: 'gemini-3.5-flash-lite',
      system: 'S',
      messages: [...MSG, { role: 'assistant', content: 'a' }],
      json: true,
      maxOutputTokens: 64,
    });
    expect(f.calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(f.calls[0]!.body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'oi' }] },
        { role: 'model', parts: [{ text: 'a' }] },
      ],
      systemInstruction: { parts: [{ text: 'S' }] },
      generationConfig: { maxOutputTokens: 64, responseMimeType: 'application/json' },
    });
    expect(r).toMatchObject({
      text: '{"a":1}',
      finishReason: 'stop',
      usage: { inputTokens: 100, cachedInputTokens: 30, cacheWriteTokens: 0, outputTokens: 25 },
    });
  });

  it('streaming por SSE: texto em pedaços e o uso do último pedaço como final', async () => {
    const f = fakeFetch([
      sseResponse([
        {
          data: {
            candidates: [{ content: { parts: [{ text: 'Bo' }] } }],
            usageMetadata: { promptTokenCount: 10 },
          },
        },
        {
          data: {
            candidates: [{ content: { parts: [{ text: 'la' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
          },
        },
      ]),
    ]);
    const c = new GeminiCompletionClient({ apiKey: 'g', fetch: f, retry: noSleep });
    const events = await collect(c.stream({ model: 'gemini-3.5-flash-lite', messages: MSG }));
    expect(f.calls[0]!.url).toMatch(/:streamGenerateContent\?alt=sse$/);
    expect(textOf(events)).toBe('Bola');
    expect(finalOf(events)).toMatchObject({
      final: true,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it('pedido bloqueado (promptFeedback): content_filter sem texto', async () => {
    const f = fakeFetch([
      jsonResponse(200, {
        promptFeedback: { blockReason: 'SAFETY' },
        usageMetadata: { promptTokenCount: 3 },
      }),
    ]);
    const c = new GeminiCompletionClient({ apiKey: 'g', fetch: f, retry: noSleep });
    expect(await c.complete({ model: 'gemini-3.5-flash-lite', messages: MSG })).toMatchObject({
      text: '',
      finishReason: 'content_filter',
    });
  });

  it('429 RESOURCE_EXHAUSTED com crédito pré-pago esgotado: quota', async () => {
    const f = fakeFetch([
      jsonResponse(429, {
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Your prepayment credits are depleted.' },
      }),
    ]);
    const c = new GeminiCompletionClient({ apiKey: 'g', fetch: f, retry: noSleep });
    await expect(c.complete({ model: 'gemini-3.5-flash-lite', messages: MSG })).rejects.toMatchObject({
      kind: 'quota',
    });
  });
});

describe('anexos (PDF e imagem) na última mensagem do usuário', () => {
  const files = [
    { mediaType: 'application/pdf' as const, data: 'UERG', name: 'grade.pdf' },
    { mediaType: 'image/png' as const, data: 'UE5H' },
  ];
  const req = {
    model: 'm',
    messages: [
      { role: 'user' as const, content: 'antes' },
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 'leia a grade' },
    ],
    attachments: files,
  };
  const k = { apiKey: 'k', fetch: fakeFetch([]), retry: noSleep };

  it('Anthropic: document e image em base64, antes do texto; as outras mensagens ficam como estão', () => {
    const body = new AnthropicCompletionClient(k).wire(req, false).body as { messages: unknown[] };
    expect(body.messages[0]).toEqual({ role: 'user', content: 'antes' });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'UE5H' } },
        { type: 'text', text: 'leia a grade' },
      ],
    });
  });

  it('OpenAI: file (PDF com nome) e image_url em data URL', () => {
    const body = new OpenAiCompletionClient(k).wire(req, false).body as { messages: unknown[] };
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'leia a grade' },
        { type: 'file', file: { filename: 'grade.pdf', file_data: 'data:application/pdf;base64,UERG' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,UE5H' } },
      ],
    });
  });

  it('Gemini: inline_data antes do texto', () => {
    const body = new GeminiCompletionClient(k).wire(req, false).body as { contents: unknown[] };
    expect(body.contents[2]).toEqual({
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: 'UERG' } },
        { inline_data: { mime_type: 'image/png', data: 'UE5H' } },
        { text: 'leia a grade' },
      ],
    });
  });

  it('sem anexos o corpo não muda (texto simples)', () => {
    const body = new AnthropicCompletionClient(k).wire({ ...req, attachments: [] }, false).body as {
      messages: unknown[];
    };
    expect(body.messages[2]).toEqual({ role: 'user', content: 'leia a grade' });
  });

  it('anexo sem mensagem do usuário é erro de configuração, nos três provedores (o arquivo não some calado)', () => {
    const lone = {
      model: 'm',
      messages: [{ role: 'assistant' as const, content: 'ok' }],
      attachments: files,
    };
    for (const client of [
      new AnthropicCompletionClient(k),
      new OpenAiCompletionClient(k),
      new GeminiCompletionClient(k),
    ])
      expect(() => client.wire(lone, false)).toThrow(/anexo sem mensagem do usuário/);
  });
});
