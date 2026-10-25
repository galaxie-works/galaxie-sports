/**
 * Orçamento em US$ (tokens + buscas na web), teto por agente e teto de buscas por chamada.
 * Caso real que motivou: 2026-10-24, 1.101 buscas do Gemini e US$ 20,88 no dia sem bater o teto de tokens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetedLlmClient,
  estimateRequestUsd,
  MemoryTokenBudgetStore,
  overSearchCap,
  TokenBudget,
  UNCAPPED_SEARCH_ESTIMATE,
} from './budget.js';
import {
  DEFAULT_AGENT_USD_BUDGETS,
  DEFAULT_DAILY_USD_BUDGET,
  DEFAULT_MAX_SEARCHES_PER_CALL,
  llmSettingsFromEnv,
  parseAgentUsdBudgets,
} from './config.js';
import { BudgetExceededError, LlmError } from './errors.js';
import { createLlmClient, withTokenBudget } from './factory.js';
import { FakeLlmClient } from './fake.js';
import {
  estimateCostUsd,
  GEMINI_GROUNDING_USD_PER_QUERY,
  searchUsdFor,
  WEB_SEARCH_USD_PER_CALL,
} from './pricing.js';
import { AnthropicLlmClient } from './providers/anthropic.js';
import { OpenAiLlmClient } from './providers/openai.js';
import type { LlmJsonRequest } from './types.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};

const req = (over: Partial<LlmJsonRequest> = {}): LlmJsonRequest => ({
  tier: 'research',
  system: 'sistema',
  messages: [{ role: 'user', content: 'oi' }],
  schema: SCHEMA,
  schemaName: 'resposta',
  purpose: 'lineups:plans:op:BR',
  maxOutputTokens: 1_000,
  ...over,
});

const NOW = new Date('2026-10-24T12:00:00Z');

/** Uma chamada de pesquisa do Gemini: 100 mil tokens de entrada, 2 mil de saída e `searches` buscas. */
const geminiCall = (searches: number) => ({
  data: { answer: 'ok' },
  usage: {
    inputTokens: 100_000,
    outputTokens: 2_000,
    webSearchCalls: searches,
    costUsd: estimateCostUsd(
      'gemini-3.8-flash',
      { inputTokens: 100_000, outputTokens: 2_000 },
      searches,
      GEMINI_GROUNDING_USD_PER_QUERY,
    )!,
  },
});

afterEach(() => vi.restoreAllMocks());

describe('configuração do orçamento em US$', () => {
  it('padrões: US$ 10/dia, tetos por agente e 5 buscas por chamada; o de tokens continua', () => {
    const s = llmSettingsFromEnv({});
    expect(s.dailyTokenBudget).toBe(2_000_000);
    expect(s.dailyUsdBudget).toBe(DEFAULT_DAILY_USD_BUDGET);
    expect(DEFAULT_DAILY_USD_BUDGET).toBe(10);
    expect(s.agentUsdBudgets).toEqual({ lineups: 2, wtw: 3, context: 1.5, related: 0.5, f1profile: 1 });
    expect(s.maxSearchesPerCall).toBe(DEFAULT_MAX_SEARCHES_PER_CALL);
  });

  it('AI_DAILY_USD_BUDGET=0 desliga a IA (como agente=0); sem teto só com "unlimited"', async () => {
    expect(llmSettingsFromEnv({ AI_DAILY_USD_BUDGET: '0' }).dailyUsdBudget).toBe(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeLlmClient([{ data: { answer: 'a' } }]);
    const off = withTokenBudget(fake, { env: { AI_DAILY_USD_BUDGET: '0' } });
    await expect(off.generateJson(req())).rejects.toMatchObject({ agent: 'global', unit: 'usd' });
    expect(fake.calls).toHaveLength(0);
  });

  it('sobrescritas, "unlimited"/0 e vazio = padrão', () => {
    const s = llmSettingsFromEnv({
      AI_DAILY_USD_BUDGET: '7,5',
      AI_AGENT_USD_BUDGETS: 'lineups=1 wtw=0.25',
      AI_MAX_SEARCHES_PER_CALL: '3',
    });
    expect(s.dailyUsdBudget).toBe(7.5);
    expect(s.agentUsdBudgets).toEqual({ lineups: 1, wtw: 0.25 });
    expect(s.maxSearchesPerCall).toBe(3);
    const open = llmSettingsFromEnv({
      AI_DAILY_USD_BUDGET: 'unlimited',
      AI_MAX_SEARCHES_PER_CALL: '0',
      AI_AGENT_USD_BUDGETS: '  ',
    });
    expect(open.dailyUsdBudget).toBeNull();
    expect(open.maxSearchesPerCall).toBeNull();
    expect(open.agentUsdBudgets).toEqual(parseAgentUsdBudgets(DEFAULT_AGENT_USD_BUDGETS));
  });

  it('valor inválido falha a configuração (a CLI segue sem IA, só com o determinístico)', () => {
    expect(() => llmSettingsFromEnv({ AI_DAILY_USD_BUDGET: '-1' })).toThrow(LlmError);
    expect(() => llmSettingsFromEnv({ AI_DAILY_USD_BUDGET: 'dez' })).toThrow(/AI_DAILY_USD_BUDGET/);
    expect(() => llmSettingsFromEnv({ AI_AGENT_USD_BUDGETS: 'lineups:2' })).toThrow(/AI_AGENT_USD_BUDGETS/);
    expect(() => llmSettingsFromEnv({ AI_MAX_SEARCHES_PER_CALL: '2.5' })).toThrow(/inteiro/);
  });

  it('parseAgentUsdBudgets: agente=US$, separadores vírgula/espaço/;, minúsculas', () => {
    // a versão do prompt sai da chave (o ledger grava `channels`, não `channels@v1`)
    expect(parseAgentUsdBudgets('Lineups=2, wtw=3;channels@v1=0.2')).toEqual({
      lineups: 2,
      wtw: 3,
      channels: 0.2,
    });
    expect(parseAgentUsdBudgets('')).toEqual({});
    expect(parseAgentUsdBudgets(undefined)).toEqual({});
    expect(parseAgentUsdBudgets('lineups=2,wtw')).toBeNull();
    expect(parseAgentUsdBudgets('lineups=-1')).toBeNull();
  });
});

describe('custo: tokens + buscas → US$', () => {
  it('o grounding do Gemini é cobrado por consulta e entra no custo da chamada', () => {
    // 100k × 0,75 + 2k × 3,75 por milhão = US$ 0,0825; 38 buscas × 0,014 = US$ 0,532
    expect(geminiCall(38).usage.costUsd).toBeCloseTo(0.0825 + 38 * 0.014, 6);
    expect(searchUsdFor('gemini')).toBe(GEMINI_GROUNDING_USD_PER_QUERY);
    expect(searchUsdFor('openai')).toBe(WEB_SEARCH_USD_PER_CALL);
    expect(searchUsdFor('anthropic')).toBe(WEB_SEARCH_USD_PER_CALL);
  });

  it('estimativa antes da chamada: tokens ao preço do modelo + teto de buscas ao preço do provedor', () => {
    const noSearch = estimateRequestUsd(req(), 'gemini-3.8-flash', 'gemini');
    expect(noSearch).toBeGreaterThan(0);
    expect(noSearch).toBeLessThan(0.01);
    const capped = estimateRequestUsd(req({ webSearch: true, maxSearches: 5 }), 'gemini-3.8-flash', 'gemini');
    expect(capped - noSearch).toBeGreaterThan(5 * GEMINI_GROUNDING_USD_PER_QUERY);
    const uncapped = estimateRequestUsd(req({ webSearch: true }), 'gemini-3.8-flash', 'gemini');
    expect(uncapped - capped).toBeCloseTo((UNCAPPED_SEARCH_ESTIMATE - 5) * GEMINI_GROUNDING_USD_PER_QUERY, 6);
    // modelo fora da tabela: o preço mais caro do provedor (nunca de graça) + as buscas
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = estimateRequestUsd(req({ webSearch: true, maxSearches: 2 }), 'gpt-7-nova', 'openai');
    const priciest = estimateRequestUsd(req({ webSearch: true, maxSearches: 2 }), 'gpt-6-astra', 'openai');
    expect(unknown).toBeCloseTo(priciest, 9);
    // sem provedor conhecido (cliente falso): só as buscas
    expect(estimateRequestUsd(req({ webSearch: true, maxSearches: 2 }), 'desconhecido', 'fake')).toBe(
      2 * WEB_SEARCH_USD_PER_CALL,
    );
  });
});

describe('teto global em US$', () => {
  it('soma o custo do dia (tokens + buscas) e recusa quando passa do teto, sem chamar o provedor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(store, { dailyLimit: null, dailyUsdLimit: 1 }, () => NOW);
    const fake = new FakeLlmClient([geminiCall(30), geminiCall(30), geminiCall(30)]);
    const client = new BudgetedLlmClient(fake, budget, () => 'gemini-3.8-flash', 'gemini');
    await client.generateJson(req({ webSearch: true }));
    await client.generateJson(req({ webSearch: true }));
    // 2 × (0,0825 + 0,42) ≈ US$ 1,005: o dia passou do teto; a terceira não sai
    const status = await budget.usdStatus();
    expect(status.usedUsd).toBeCloseTo(2 * (0.0825 + 30 * 0.014), 6);
    expect(status).toMatchObject({ limitUsd: 1, remainingUsd: 0, exhausted: true });
    const err = await client.generateJson(req({ webSearch: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ agent: 'global', unit: 'usd', kind: 'budget', retryable: false });
    expect(fake.calls).toHaveLength(2);
    // o teto de tokens seguiria longe: 204 mil tokens no dia
    expect(await budget.status()).toMatchObject({ used: 204_000, limit: null });
  });

  it('o teto de tokens continua valendo junto com o de US$', async () => {
    const budget = new TokenBudget(
      new MemoryTokenBudgetStore(),
      { dailyLimit: 500, dailyUsdLimit: 100 },
      () => NOW,
    );
    const client = new BudgetedLlmClient(new FakeLlmClient([{ data: { answer: 'a' } }]), budget);
    const err = await client.generateJson(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ unit: 'tokens', agent: 'global' });
  });
});

describe('teto em US$ por agente', () => {
  it('agente no teto fica sem IA até a virada do dia UTC; os outros seguem', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryTokenBudgetStore();
    let now = NOW;
    const budget = new TokenBudget(
      store,
      { dailyLimit: null, dailyUsdLimit: 10, agentUsdLimits: { lineups: 0.5 } },
      () => now,
    );
    const fake = new FakeLlmClient(() => geminiCall(10));
    const client = new BudgetedLlmClient(fake, budget, () => 'gemini-3.8-flash', 'gemini');

    await client.generateJson(req({ webSearch: true })); // ≈ US$ 0,2225
    await client.generateJson(req({ webSearch: true })); // ≈ US$ 0,445
    const err = await client.generateJson(req({ webSearch: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ agent: 'lineups', unit: 'usd', limit: 0.5 });
    expect((err as Error).message).toMatch(/US\$/);
    expect(fake.calls).toHaveLength(2);
    expect(await budget.usdStatus('lineups')).toMatchObject({ limitUsd: 0.5 });

    // outro agente (sem teto próprio) continua, dentro do global
    await client.generateJson(req({ webSearch: true, purpose: 'wtw:channel:x:BR' }));
    expect(fake.calls).toHaveLength(3);

    // a recusa se repete no mesmo dia, mas o aviso sai uma vez só
    await expect(
      client.generateJson(req({ webSearch: true, purpose: 'lineups:plan:y:AR' })),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    const capWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('(lineups)'));
    expect(capWarnings).toHaveLength(1);
    expect(String(capWarnings[0]![0])).toMatch(/virada do dia UTC/);

    // dia seguinte (UTC): volta a ter IA
    now = new Date('2026-10-25T00:05:00Z');
    await client.generateJson(req({ webSearch: true }));
    expect(fake.calls).toHaveLength(4);
  });

  it('teto 0 desliga a IA do agente', async () => {
    const budget = new TokenBudget(
      new MemoryTokenBudgetStore(),
      { dailyLimit: null, agentUsdLimits: { related: 0 } },
      () => NOW,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeLlmClient([{ data: { answer: 'a' } }]);
    const client = new BudgetedLlmClient(fake, budget);
    await expect(client.generateJson(req({ purpose: 'related:event:1' }))).rejects.toMatchObject({
      agent: 'related',
      unit: 'usd',
    });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('teto de buscas por chamada', () => {
  it('vai para o provedor na requisição e a chamada acima do teto gera alerta (e fica no ledger)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(store, { dailyLimit: null, maxSearchesPerCall: 5 }, () => NOW);
    const fake = new FakeLlmClient([geminiCall(12), geminiCall(4), { data: { answer: 'c' } }]);
    const client = new BudgetedLlmClient(fake, budget, () => 'gemini-3.8-flash', 'gemini');

    await client.generateJson(req({ webSearch: true }));
    expect(fake.calls[0]!.maxSearches).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/12 buscas na web, acima do teto de 5/);
    expect(store.entries[0]).toMatchObject({ webSearches: 12, outcome: 'ok' });

    await client.generateJson(req({ webSearch: true, maxSearches: 8 })); // teto do pedido prevalece
    expect(fake.calls[1]!.maxSearches).toBe(8);
    await client.generateJson(req()); // sem busca: sem teto na requisição
    expect(fake.calls[2]!.maxSearches).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('overSearchCap: sem teto nunca acusa', () => {
    expect(overSearchCap(6, 5)).toBe(true);
    expect(overSearchCap(5, 5)).toBe(false);
    expect(overSearchCap(99, null)).toBe(false);
    expect(overSearchCap(99, undefined)).toBe(false);
  });
});

describe('fábrica', () => {
  it('createLlmClient lê os tetos em US$ e de buscas do ambiente', () => {
    const rt = createLlmClient({
      env: {
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
        AI_DAILY_USD_BUDGET: '4',
        AI_AGENT_USD_BUDGETS: 'lineups=1',
        AI_MAX_SEARCHES_PER_CALL: '3',
      },
    });
    expect(rt.budget.policy).toMatchObject({
      dailyLimit: 2_000_000,
      dailyUsdLimit: 4,
      agentUsdLimits: { lineups: 1 },
      maxSearchesPerCall: 3,
    });
  });

  it('withTokenBudget aceita os tetos por opção', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeLlmClient([{ data: { answer: 'a' } }]);
    const wrapped = withTokenBudget(fake, { dailyLimit: null, agentUsdLimits: { lineups: 0 } });
    await expect(wrapped.generateJson(req())).rejects.toMatchObject({ unit: 'usd' });
    expect(fake.calls).toHaveLength(0);
  });
});

/**
 * Auditoria de 2026-10-25: caminhos que furavam o teto em US$ criado depois do dia de US$ 20,88.
 * Provedores reais com SDK falso (nenhuma chamada de rede).
 */
describe('o teto em US$ segura', () => {
  const noSleep = { sleep: async () => {} };
  /** SDK falso da OpenAI: toda chamada recebe a mesma resposta. */
  const openAiSdk = (reply: unknown) => {
    const calls: Record<string, unknown>[] = [];
    const create = async (params: Record<string, unknown>) => {
      calls.push(params);
      return reply;
    };
    return { calls, sdk: { responses: { create } } };
  };
  const openAiReply = (text: string, input: number, output: number, searches = 0) => ({
    status: 'completed',
    output_text: text,
    output: [
      ...Array.from({ length: searches }, () => ({ type: 'web_search_call' })),
      { type: 'message', content: [{ type: 'output_text', text }] },
    ],
    usage: { input_tokens: input, output_tokens: output },
  });

  it('modelo fora da tabela de preços não desliga o teto: preço mais caro do provedor + buscas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models = { light: 'gpt-7-orion', standard: 'gpt-7-orion', research: 'gpt-7-orion' };
    const api = openAiSdk(openAiReply('{"answer":"ok"}', 10_000, 1_000, 5));
    const openai = new OpenAiLlmClient({ models, sdk: api.sdk, retry: noSleep });
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(
      store,
      { dailyLimit: null, dailyUsdLimit: 1, maxSearchesPerCall: 5 },
      () => NOW,
    );
    const client = new BudgetedLlmClient(openai, budget, (t) => models[t], 'openai');

    let refused: unknown;
    for (let i = 0; i < 50 && !refused; i++)
      await client.generateJson(req({ webSearch: true })).catch((e: unknown) => (refused = e));
    expect(refused).toBeInstanceOf(BudgetExceededError);
    // cada chamada: (10k × 10 + 1k × 50) / 1M + 5 buscas × 0,01 = US$ 0,20 (preço do gpt-6-astra)
    expect(store.entries.map((e) => e.costUsd)).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(api.calls).toHaveLength(4);
    expect((await budget.usdStatus()).usedUsd).toBeLessThanOrEqual(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('gpt-7-orion fora da tabela'))).toBe(true);
  });

  it('retentativas: a reserva cobre uma tentativa e o provedor confere o gasto parcial antes de cada nova', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // saída fora do schema (retentável) em todas as tentativas; cada uma custa US$ 0,03
    const api = openAiSdk(openAiReply('{}', 10_000, 1_000));
    const models = { light: 'gpt-6.1-sol', standard: 'gpt-6.1-sol', research: 'gpt-6.1-sol' };
    const openai = new OpenAiLlmClient({ models, sdk: api.sdk, maxRetries: 3, retry: noSleep });
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(store, { dailyLimit: null, dailyUsdLimit: 0.07 }, () => NOW);
    const client = new BudgetedLlmClient(openai, budget, (t) => models[t], 'openai');
    // ~10 mil tokens de entrada + 1 mil de saída: a estimativa (US$ 0,03) cabe; 4 tentativas (0,12) não
    const big = req({ purpose: 'wtw:event:1:BR', messages: [{ role: 'user', content: 'x'.repeat(40_000) }] });

    const err = await client.generateJson(big).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ agent: 'global', unit: 'usd' });
    expect(api.calls).toHaveLength(2); // sem a conferência seriam 4 (AI_MAX_RETRIES=3)
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({ outcome: 'error', inputTokens: 20_000, costUsd: 0.06 });
    expect((await budget.usdStatus()).usedUsd).toBeLessThanOrEqual(0.07);
  });

  it('Anthropic: cada continuação (pause_turn) também passa pela conferência', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: Record<string, unknown>[] = [];
    // todo turno pausa com uma busca: US$ 0,03 em tokens + 0,01 da busca
    const create = async (params: Record<string, unknown>) => {
      calls.push(params);
      const id = `srvtoolu_${calls.length}`;
      return {
        stop_reason: 'pause_turn',
        content: [
          { type: 'server_tool_use', id, name: 'web_search', input: { query: 'q' } },
          { type: 'web_search_tool_result', tool_use_id: id, content: [] },
        ],
        usage: { input_tokens: 10_000, output_tokens: 1_000, server_tool_use: { web_search_requests: 1 } },
      };
    };
    const models = {
      light: 'claude-sonnet-5-5',
      standard: 'claude-sonnet-5-5',
      research: 'claude-sonnet-5-5',
    };
    const anthropic = new AnthropicLlmClient({ models, sdk: { messages: { create } }, retry: noSleep });
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(
      store,
      { dailyLimit: null, dailyUsdLimit: 0.1, maxSearchesPerCall: 1 },
      () => NOW,
    );
    const client = new BudgetedLlmClient(anthropic, budget, (t) => models[t], 'anthropic');

    const err = await client
      .generateJson(req({ webSearch: true, maxOutputTokens: 100 }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    // estimativa ≈ US$ 0,05 (overhead de 20 mil tokens da busca + 1 busca): 0,04 + 0,05 cabe; 0,08 + 0,05 não
    expect(calls).toHaveLength(2);
    expect(store.entries[0]).toMatchObject({ outcome: 'error', webSearches: 2, costUsd: 0.08 });
  });

  it('falha ao gravar o ledger não descarta a chamada já paga (nem faz o agente pagar de novo)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemoryTokenBudgetStore();
    store.record = async () => {
      throw new Error('conexão perdida');
    };
    const budget = new TokenBudget(store, { dailyLimit: null }, () => NOW);
    const fake = new FakeLlmClient([{ data: { answer: 'pago' }, usage: { costUsd: 0.5 } }]);
    const client = new BudgetedLlmClient(fake, budget);
    const out = await client.generateJson<{ answer: string }>(req());
    expect(out.data.answer).toBe('pago');
    expect(fake.calls).toHaveLength(1);
    expect(String(error.mock.calls[0]![0])).toMatch(/falha ao gravar o uso no ledger.*conexão perdida/);
  });

  it('teto por agente não depende da versão do prompt (`channels@v2` cai no teto de `channels`)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const budget = new TokenBudget(
      new MemoryTokenBudgetStore(),
      { dailyLimit: null, agentUsdLimits: parseAgentUsdBudgets('channels@v1=0')! },
      () => NOW,
    );
    const fake = new FakeLlmClient([{ data: { answer: 'a' } }]);
    const client = new BudgetedLlmClient(fake, budget);
    await expect(client.generateJson(req({ purpose: 'channels@v2:tenant:BR' }))).rejects.toMatchObject({
      agent: 'channels',
      unit: 'usd',
    });
    expect(fake.calls).toHaveLength(0);
  });
});
