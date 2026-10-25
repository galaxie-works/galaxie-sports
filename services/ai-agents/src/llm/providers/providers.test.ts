import { describe, expect, it } from 'vitest';
import { LlmError } from '../errors.js';
import type { LlmJsonRequest } from '../types.js';
import { AnthropicLlmClient, searchUsesFor } from './anthropic.js';
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

  it('pesquisa com web_search, continua pause_turn (mesma conversa) e lê a ferramenta de saída', async () => {
    const sdk = fakeSdk([
      {
        // pausou depois de 2 buscas cobradas, com uma terceira pendente
        stop_reason: 'pause_turn',
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 's1',
            content: [{ type: 'web_search_result', url: 'https://conmebol.com/r', title: 'r' }],
          },
          { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'y' } },
        ],
        usage: usage(500, 50, 2),
      },
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'web_search_tool_result', tool_use_id: 's2', content: [] },
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
    expect(first.system).toMatch(
      /^sistema\n\nextra\n\nAo terminar, entregue a resposta final chamando a ferramenta submit_resposta_final/,
    );
    expect(first.tool_choice).toEqual({ type: 'auto' });
    // teto padrão 6: a conversa declara a metade, para caber uma continuação
    expect(first.tools).toEqual([
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
        allowed_domains: ['globo.com', 'conmebol.com'],
        user_location: { type: 'approximate', country: 'BR' },
      },
      expect.objectContaining({ name: 'submit_resposta_final', input_schema: SCHEMA, strict: true }),
    ]);
    // 2 buscas + max_uses 3 ≤ 6: continua a mesma conversa, com ferramentas e system idênticos
    expect((sdk.calls[1]!.messages as unknown[]).length).toBe(2); // pergunta + turno pausado
    expect(sdk.calls[1]!.tools).toEqual(first.tools);
    expect(sdk.calls[1]!.system).toBe(first.system);
    expect(client.buildTools(req({ maxSearches: 3 }))[0]).toMatchObject({ max_uses: 3 });
    expect(out.citations.map((c) => c.url)).toEqual(['https://conmebol.com/r', 'https://ge.globo.com/x']);
    expect(out.usage).toMatchObject({ inputTokens: 1_200, outputTokens: 130, webSearchCalls: 3 });
  });

  it('nunca força a ferramenta nem manda temperature (400 nos modelos atuais); sem chamada → pede de novo', async () => {
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
    await client.generateJson(req({ temperature: 0.3 }));
    expect(sdk.calls[1]!.tool_choice).toEqual({ type: 'auto' });
    expect((sdk.calls[1]!.messages as { role: string; content: unknown }[]).at(-1)).toEqual({
      role: 'user',
      content: 'Entregue agora a resposta final chamando a ferramenta submit_resposta_final.',
    });

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
    await c2.generateJson(req({ webSearch: false, temperature: 0 }));
    expect(sdk2.calls[0]!.tool_choice).toEqual({ type: 'auto' });
    expect(sdk2.calls[0]).not.toHaveProperty('temperature');
    expect(sdk2.calls[0]!.system).toContain('chamando a ferramenta submit_resposta_final');
    expect((sdk2.calls[0]!.tools as unknown[]).length).toBe(1);
  });

  describe('teto de buscas vale para a chamada inteira (turnos e tentativas)', () => {
    /** Uma busca cobrada, com o resultado na mesma resposta. */
    const searched = (id: string, url = `https://conmebol.com/${id}`) => [
      { type: 'server_tool_use', id, name: 'web_search', input: { query: id } },
      {
        type: 'web_search_tool_result',
        tool_use_id: id,
        content: [{ type: 'web_search_result', url, title: id, encrypted_content: 'cifrado' }],
      },
    ];
    const cited = (text: string, url: string, quote: string) => ({
      type: 'text',
      text,
      citations: [{ type: 'web_search_result_location', url, title: 't', cited_text: quote }],
    });
    const submitOk = (answer = 'ok') => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_resposta_final', input: { answer } }],
      usage: usage(100, 10),
    });
    const toolNames = (call: Record<string, unknown>) =>
      (call.tools as Record<string, unknown>[]).map((t) => t.name);
    const lastContent = (call: Record<string, unknown>) =>
      String((call.messages as { content: unknown }[]).at(-1)!.content);
    const client = (create: (p: Record<string, unknown>) => Promise<unknown>, maxRetries = 3) =>
      new AnthropicLlmClient({ models: A_MODELS, sdk: { messages: { create } }, maxRetries, retry: noSleep });

    it('pause_turn com buscas cobradas: continua enquanto o pior caso cabe; depois, entrega sem busca', async () => {
      const sdk = fakeSdk([
        { stop_reason: 'pause_turn', content: searched('s1'), usage: usage(100, 10, 2) },
        {
          stop_reason: 'pause_turn',
          content: [
            ...searched('s2'),
            cited('Globo tem os direitos.', 'https://ge.globo.com/x', 'Globo exibe'),
          ],
          usage: usage(100, 10, 2),
        },
        submitOk(),
      ]);
      const out = await client(sdk.create).generateJson(req({ maxSearches: 5 }));
      expect(sdk.calls).toHaveLength(3);
      // teto 5 → max_uses 2; 2 + 2 ≤ 5: a continuação sai na mesma conversa, com as mesmas ferramentas
      expect((sdk.calls[0]!.tools as Record<string, unknown>[])[0]).toMatchObject({ max_uses: 2 });
      expect(sdk.calls[1]!.tools).toEqual(sdk.calls[0]!.tools);
      expect((sdk.calls[1]!.messages as unknown[]).length).toBe(2);
      // 4 + 2 > 5: a entrega vai numa conversa nova, sem a busca, com texto, fontes e trechos citados
      expect(toolNames(sdk.calls[2]!)).toEqual(['submit_resposta_final']);
      const delivery = lastContent(sdk.calls[2]!);
      expect(delivery).toContain('## Resultado da pesquisa\nGlobo tem os direitos.');
      expect(delivery).toContain('- https://conmebol.com/s1 (s1)');
      expect(delivery).toContain('- https://ge.globo.com/x (t)\n   - "Globo exibe"');
      expect(sdk.calls[2]!.system).toContain('sem fonte, não entra');
      expect(out.usage).toMatchObject({ webSearchCalls: 4 });
    });

    it('modelo que nunca chama a ferramenta: sem retentativa e sem buscas além do teto', async () => {
      const calls: Record<string, unknown>[] = [];
      const create = async (params: Record<string, unknown>) => {
        calls.push(structuredClone(params));
        const searching = calls.length <= 2;
        return {
          stop_reason: 'end_turn',
          content: [
            ...(searching ? searched(`s${calls.length}`) : []),
            { type: 'text', text: `texto ${calls.length}` },
          ],
          usage: usage(100, 10, searching ? 2 : 0),
        };
      };
      const err = await client(create)
        .generateJson(req({ maxSearches: 5 }))
        .catch((e: unknown) => e as LlmError & { usage: unknown });
      expect(err).toMatchObject({ kind: 'schema', retryable: false });
      expect(err.usage).toMatchObject({ webSearchCalls: 4 });
      // uma tentativa só: 2 requisições com busca (pedido de entrega na mesma conversa), 2 de entrega
      expect(calls).toHaveLength(4);
      expect(calls[1]!.tools).toEqual(calls[0]!.tools);
      for (const call of calls.slice(2)) expect(toolNames(call)).toEqual(['submit_resposta_final']);
      // a conversa de entrega leva só o texto da conversa com busca e cresce só por anexo
      expect(lastContent(calls[2]!)).toContain('texto 1\n\ntexto 2');
      expect(calls[3]!.messages).toEqual([
        ...(calls[2]!.messages as unknown[]),
        expect.objectContaining({ role: 'assistant' }),
        expect.objectContaining({ role: 'user' }),
      ]);
    });

    it('entrega fora do schema depois de pesquisar: a retentativa não pesquisa e recebe a entrada e o erro', async () => {
      const sdk = fakeSdk([
        {
          stop_reason: 'tool_use',
          content: [
            ...searched('s1'),
            { type: 'tool_use', name: 'submit_resposta_final', input: { resposta: 'x' } },
          ],
          usage: usage(100, 10, 2),
        },
        submitOk('certo'),
      ]);
      const out = await client(sdk.create).generateJson<{ answer: string }>(req({ maxSearches: 5 }));
      expect(out.data.answer).toBe('certo');
      expect(sdk.calls).toHaveLength(2);
      expect(toolNames(sdk.calls[1]!)).toEqual(['submit_resposta_final']);
      const delivery = lastContent(sdk.calls[1]!);
      expect(delivery).toContain('## Entrega anterior recusada');
      expect(delivery).toContain('Entrada recusada: {"resposta":"x"}');
      expect(delivery).toMatch(/não seguiu o schema \(Saída fora do schema/);
      // o modelo não deixou texto: avisa em vez de inventar
      expect(delivery).toContain('(o modelo não deixou texto da pesquisa)');
      expect(out.usage).toMatchObject({ webSearchCalls: 2 });
    });

    it('entrega fora do schema sem nenhuma busca: a retentativa refaz a conversa normal com o teto inteiro', async () => {
      const sdk = fakeSdk([
        {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'respondo de memória' },
            { type: 'tool_use', name: 'submit_resposta_final', input: {} },
          ],
          usage: usage(100, 10, 0),
        },
        submitOk(),
      ]);
      await client(sdk.create).generateJson(req({ maxSearches: 5 }));
      expect(sdk.calls).toHaveLength(2);
      expect(sdk.calls[1]!.tools).toEqual(sdk.calls[0]!.tools); // busca com max_uses 2 de novo
      expect(lastContent(sdk.calls[1]!)).toContain('## Entrega anterior recusada');
      expect(sdk.calls[1]!.system).toBe(sdk.calls[0]!.system);
    });

    it('conversa de entrega sem fontes não exige fonte e mantém os exemplos do assistente', async () => {
      const sdk = fakeSdk([
        // a busca foi cobrada mas não trouxe resultado nem citação
        { stop_reason: 'pause_turn', content: [], usage: usage(100, 10, 1) },
        submitOk(),
      ]);
      await client(sdk.create).generateJson(
        req({
          maxSearches: 1,
          messages: [
            { role: 'user', content: 'exemplo' },
            { role: 'assistant', content: 'resposta exemplo' },
            { role: 'user', content: 'pergunta' },
          ],
        }),
      );
      const delivery = sdk.calls[1]!;
      expect(toolNames(delivery)).toEqual(['submit_resposta_final']);
      expect((delivery.messages as { role: string }[]).map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'user',
      ]);
      expect(lastContent(delivery)).toContain('## Fontes encontradas\n(nenhuma)');
      expect(delivery.system).not.toContain('sem fonte, não entra');
    });

    it('falha antes de qualquer busca: a nova tentativa ainda tem o teto inteiro', async () => {
      const sdk = fakeSdk([Object.assign(new Error('overloaded'), { status: 529 }), submitOk()]);
      await client(sdk.create).generateJson(req({ maxSearches: 5 }));
      expect(sdk.calls).toHaveLength(2);
      expect((sdk.calls[1]!.tools as Record<string, unknown>[])[0]).toMatchObject({
        name: 'web_search',
        max_uses: 2,
      });
    });

    it('max_uses por conversa: metade do que sobra (mín. 1)', () => {
      expect([0, 1, 2, 3, 5, 6].map(searchUsesFor)).toEqual([0, 1, 1, 1, 2, 3]);
    });
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
