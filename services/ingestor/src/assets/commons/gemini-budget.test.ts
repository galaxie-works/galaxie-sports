import {
  AiDisabledError,
  BudgetExceededError,
  MemoryTokenBudgetStore,
  TokenBudget,
  estimateCostUsd,
  type BudgetPolicy,
} from '@galaxie/ai-ledger';
import { describe, expect, it, vi } from 'vitest';
import { ASSETS_AGENT, rankEstimate, rankWithGemini } from './gemini.js';

/** A ordem das fotos da F1 entra no ledger diário de IA como agente `assets` (reserva antes, uso depois). */
const img = { body: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', title: 'File:Senna.jpg' };
const reply = [{ index: 0, kind: 'portrait', keep: true, quality: 8 }];
const ok = (usage?: object) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
          ...(usage ? { usageMetadata: usage } : {}),
        }),
      ),
  );
const policy = (p: Partial<BudgetPolicy> = {}): BudgetPolicy => ({
  dailyLimit: null,
  dailyUsdLimit: 10,
  agentUsdLimits: { assets: 0.5 },
  ...p,
});
const ledger = (p?: Partial<BudgetPolicy>) => {
  const store = new MemoryTokenBudgetStore();
  return { store, budget: new TokenBudget(store, policy(p), () => new Date('2026-10-26T12:00:00Z')) };
};
const MODEL = 'gemini-3.5-flash-lite';

describe('ordem das fotos no ledger de IA (agente assets)', () => {
  it('grava a chamada com o uso do Gemini (raciocínio conta como saída), o custo e o purpose próprio', async () => {
    const { store, budget } = ledger();
    const fetch = ok({ promptTokenCount: 14_000, candidatesTokenCount: 600, thoughtsTokenCount: 400 });
    const out = await rankWithGemini([img], 'Ayrton Senna', 'driver', {
      apiKey: 'k',
      fetch: fetch as unknown as typeof globalThis.fetch,
      budget,
    });
    expect(out).toEqual([{ index: 0, kind: 'portrait', keep: true, quality: 8 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.entries).toHaveLength(1);
    const e = store.entries[0]!;
    expect(e).toMatchObject({
      agent: ASSETS_AGENT,
      purpose: 'assets:commons:driver:Ayrton Senna',
      provider: 'gemini',
      model: MODEL,
      inputTokens: 14_000,
      outputTokens: 1_000,
      webSearches: 0,
      outcome: 'ok',
    });
    expect(e.costUsd).toBe(
      estimateCostUsd(MODEL, { inputTokens: 14_000, outputTokens: 1_000 }, 0, 0, 'gemini'),
    );
    expect(e.costUsd).toBeGreaterThan(0);
    // o teto de saída vai no pedido (limita o custo e a estimativa da reserva)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { generationConfig: { maxOutputTokens: number } };
    expect(sent.generationConfig.maxOutputTokens).toBe(8_192);
  });

  it('teto do agente assets gasto no dia: recusa antes de chamar o Gemini (BudgetExceededError em US$)', async () => {
    const { store, budget } = ledger();
    await store.record({
      agent: 'assets',
      purpose: 'assets:commons:car:x',
      provider: 'gemini',
      model: MODEL,
      tier: 'light',
      inputTokens: 1,
      outputTokens: 1,
      webSearches: 0,
      costUsd: 0.5,
      outcome: 'ok',
      at: new Date('2026-10-26T08:00:00Z'),
    });
    const fetch = ok();
    const call = rankWithGemini([img], 'Ayrton Senna', 'driver', {
      apiKey: 'k',
      fetch: fetch as unknown as typeof globalThis.fetch,
      budget,
    });
    await expect(call).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(call).rejects.toMatchObject({ agent: 'assets', unit: 'usd' });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it('o teto global do dia também vale (o gasto dos agentes conta)', async () => {
    const { store, budget } = ledger({ dailyUsdLimit: 1 });
    await store.record({
      agent: 'wtw',
      purpose: 'wtw:x',
      provider: 'openai',
      model: 'gpt-6-luna',
      tier: 'research',
      inputTokens: 1,
      outputTokens: 1,
      webSearches: 0,
      costUsd: 1,
      outcome: 'ok',
      at: new Date('2026-10-26T09:00:00Z'),
    });
    const fetch = ok();
    await expect(
      rankWithGemini([img], 'Ayrton Senna', 'driver', {
        apiKey: 'k',
        fetch: fetch as unknown as typeof globalThis.fetch,
        budget,
      }),
    ).rejects.toMatchObject({ agent: 'global', unit: 'usd' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AI_STATUS=off: nenhuma chamada (AiDisabledError) e nada gravado', async () => {
    const { store, budget } = ledger({ status: 'off' });
    const fetch = ok();
    await expect(
      rankWithGemini([img], 'Ayrton Senna', 'driver', {
        apiKey: 'k',
        fetch: fetch as unknown as typeof globalThis.fetch,
        budget,
      }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(0);
  });

  it('erro da API: grava a linha como erro e lança; resposta sem o uso conta a estimativa', async () => {
    const { store, budget } = ledger();
    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'no' } }), {
          status: 403,
        }),
    );
    await expect(
      rankWithGemini([img], 'Ayrton Senna', 'driver', {
        apiKey: 'k',
        fetch: failing as unknown as typeof globalThis.fetch,
        budget,
      }),
    ).rejects.toThrow(/PERMISSION_DENIED/);
    expect(store.entries[0]).toMatchObject({ outcome: 'error', inputTokens: 0, outputTokens: 0 });

    await rankWithGemini([img], 'Ayrton Senna', 'driver', {
      apiKey: 'k',
      fetch: ok() as unknown as typeof globalThis.fetch,
      budget,
    });
    const estimate = rankEstimate(['x'], 1, MODEL);
    expect(store.entries[1]!.outcome).toBe('ok');
    expect(store.entries[1]!.outputTokens).toBe(8_192);
    expect(store.entries[1]!.inputTokens).toBeGreaterThanOrEqual(estimate.inputTokens);
  });

  it('a estimativa da reserva cobre 12 miniaturas no modelo leve (~US$ 0,03) e cabe no teto assets=0,5', () => {
    const e = rankEstimate(['x'.repeat(2_000)], 12, MODEL);
    expect(e.tokens).toBe(e.inputTokens + 8_192);
    expect(e.usd).toBeGreaterThan(0.01);
    expect(e.usd).toBeLessThan(0.1);
  });
});
