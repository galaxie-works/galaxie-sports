import { settingDef } from '@galaxie/runtime-config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetExceededError, LlmError } from './errors.js';
import { MemoryTokenBudgetStore, TokenBudget, ledgerPolicy, type BudgetPolicy } from './ledger.js';
import {
  DEFAULT_AGENT_DEFAULT_USD_BUDGET,
  DEFAULT_AGENT_USD_BUDGETS,
  ledgerSettingsFromEnv,
  mergeAgentUsdBudgets,
  parseAgentUsdBudgets,
} from './state.js';

const DAY = new Date('2026-10-26T12:00:00Z');
const spend = (store: MemoryTokenBudgetStore, agent: string, costUsd: number, at = DAY) =>
  store.record({
    agent,
    purpose: `${agent}:x`,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    tier: 'light',
    inputTokens: 1,
    outputTokens: 1,
    webSearches: 0,
    costUsd,
    outcome: 'ok',
    at,
  });
const budgetOf = (policy: Partial<BudgetPolicy>, store = new MemoryTokenBudgetStore()) => ({
  store,
  budget: new TokenBudget(store, { dailyLimit: null, dailyUsdLimit: 10, ...policy }, () => DAY),
});

afterEach(() => vi.restoreAllMocks());

describe('teto padrão do agente fora da lista (AI_AGENT_DEFAULT_USD_BUDGET)', () => {
  it('agente novo não fica sem teto: vale o padrão, com aviso no log uma vez por dia', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, budget } = budgetOf({ agentUsdLimits: { wtw: 3 }, agentDefaultUsdLimit: 0.5 });
    await budget.reserve('novo', 100, 0.1);
    await budget.reserve('novo', 100, 0.1);
    const defaults = warn.mock.calls.filter(([m]) => String(m).includes('teto padrão'));
    expect(defaults).toHaveLength(1);
    expect(String(defaults[0]![0])).toMatch(
      /agente novo fora de AI_AGENT_USD_BUDGETS: segue no teto padrão de US\$ 0,50\/dia \(AI_AGENT_DEFAULT_USD_BUDGET\)/,
    );
    await spend(store, 'novo', 0.45);
    await expect(budget.reserve('novo', 100, 0.1)).rejects.toMatchObject({
      agent: 'novo',
      unit: 'usd',
      limit: 0.5,
    });
    expect(budget.agentUsdLimitOf('novo')).toEqual({ limit: 0.5, isDefault: true, origin: 'default' });
    expect(budget.describe('novo')).toBe('ligado · limitado · US$ 0,5/dia');
    expect((await budget.usdStatus('novo')).limitUsd).toBe(0.5);
  });

  it('agente da lista usa o teto próprio, sem aviso; `unlimited` (null) continua só no global', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, budget } = budgetOf({
      agentUsdLimits: { wtw: 3, livre: null },
      agentDefaultUsdLimit: 0.5,
    });
    await spend(store, 'wtw', 2);
    await spend(store, 'livre', 4);
    await budget.reserve('wtw', 100, 0.5);
    await budget.reserve('livre', 100, 0.5);
    expect(warn.mock.calls.some(([m]) => String(m).includes('teto padrão'))).toBe(false);
    expect(budget.agentUsdLimitOf('livre')).toEqual({ limit: null, isDefault: false, origin: 'config' });
  });

  it('o aviso volta no dia seguinte', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = DAY;
    const budget = new TokenBudget(
      new MemoryTokenBudgetStore(),
      { dailyLimit: null, agentUsdLimits: {}, agentDefaultUsdLimit: 0.5 },
      () => now,
    );
    await budget.reserve('novo', 1, 0.01);
    now = new Date('2026-10-27T12:00:00Z');
    await budget.reserve('novo', 1, 0.01);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('teto padrão'))).toHaveLength(2);
  });

  it('padrão `unlimited` (null): o agente fora da lista fica só no teto global', async () => {
    const { store, budget } = budgetOf({ agentUsdLimits: {}, agentDefaultUsdLimit: null });
    await spend(store, 'novo', 5);
    await budget.reserve('novo', 100, 1);
    await spend(store, 'outro', 5);
    await expect(budget.reserve('novo', 100, 1)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('configuração do ledger', () => {
  it('padrões: os tetos numéricos de todos os agentes conhecidos e US$ 0,50 para o agente novo', () => {
    const s = ledgerSettingsFromEnv({});
    expect(s.agentDefaultUsdBudget).toBe(DEFAULT_AGENT_DEFAULT_USD_BUDGET);
    expect(s.agentDefaultUsdBudget).toBe(0.5);
    expect(s.agentUsdBudgets).toEqual({
      lineups: 2,
      wtw: 3,
      context: 1.5,
      related: 0.5,
      f1profile: 2,
      f1bio: 1,
      curator: 1,
      review: 0.5,
      channels: 1,
      live: 0.5,
      assets: 1,
    });
    // nenhum agente da lista padrão fica sem teto
    expect(Object.values(parseAgentUsdBudgets(DEFAULT_AGENT_USD_BUDGETS)!).includes(null)).toBe(false);
  });

  it('AI_AGENT_DEFAULT_USD_BUDGET: número ou unlimited; 0 e fora da faixa falham pela regra do painel', () => {
    expect(ledgerSettingsFromEnv({ AI_AGENT_DEFAULT_USD_BUDGET: '1.25' }).agentDefaultUsdBudget).toBe(1.25);
    expect(
      ledgerSettingsFromEnv({ AI_AGENT_DEFAULT_USD_BUDGET: 'unlimited' }).agentDefaultUsdBudget,
    ).toBeNull();
    expect(() => ledgerSettingsFromEnv({ AI_AGENT_DEFAULT_USD_BUDGET: '0' })).toThrow(LlmError);
    expect(() => ledgerSettingsFromEnv({ AI_AGENT_DEFAULT_USD_BUDGET: '0' })).toThrow(/AI_STATUS=off/);
    expect(() => ledgerSettingsFromEnv({ AI_AGENT_DEFAULT_USD_BUDGET: '5000' })).toThrow(/entre 0.05 e 1000/);
  });

  it('a lista configurada mescla agente a agente sobre os padrões do código (a do painel não apaga os outros)', () => {
    const merged = mergeAgentUsdBudgets({ lineups: 2, wtw: 3, f1bio: null });
    expect(merged.budgets).toMatchObject({ lineups: 2, wtw: 3, f1bio: null, curator: 1, assets: 1 });
    expect(merged.origins).toMatchObject({ lineups: 'config', f1bio: 'config', curator: 'code' });
    const s = ledgerSettingsFromEnv({
      AI_AGENT_USD_BUDGETS: 'lineups=2,wtw=3,context=1.5,related=0.5,f1profile=2',
    });
    const budget = new TokenBudget(new MemoryTokenBudgetStore(), ledgerPolicy(s), () => DAY);
    expect(budget.agentUsdLimitOf('lineups')).toEqual({ limit: 2, isDefault: false, origin: 'config' });
    expect(budget.agentUsdLimitOf('review')).toEqual({ limit: 0.5, isDefault: false, origin: 'code' });
    expect(budget.agentUsdLimitOf('novo')).toEqual({ limit: 0.5, isDefault: true, origin: 'default' });
  });

  it('ledgerPolicy leva o teto padrão para a política', () => {
    const policy = ledgerPolicy(ledgerSettingsFromEnv({ AI_STATUS: 'off' }));
    expect(policy).toMatchObject({ status: 'off', agentDefaultUsdLimit: 0.5, dailyUsdLimit: 10 });
  });
});

describe('pool de tokens próprio da ordem das fotos (assets)', () => {
  const tokens = (store: MemoryTokenBudgetStore, agent: string, n: number) =>
    store.record({
      agent,
      purpose: `${agent}:x`,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      tier: 'light',
      inputTokens: n,
      outputTokens: 0,
      webSearches: 0,
      costUsd: 0,
      outcome: 'ok',
      at: DAY,
    });

  it('os tokens do assets não esgotam o teto global dos outros agentes', async () => {
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(
      store,
      ledgerPolicy(ledgerSettingsFromEnv({ AI_DAILY_TOKEN_BUDGET: '3000000' })),
      () => DAY,
    );
    expect(budget.policy.tokenPools).toEqual({ assets: 600_000 });
    // ~200 alvos de ~15 mil tokens: na conta global, deixariam todos sem IA
    await tokens(store, 'assets', 590_000);
    await tokens(store, 'wtw', 2_500_000);
    await expect(budget.reserve('wtw', 400_000)).resolves.toBeDefined();
    expect((await budget.status()).used).toBe(2_500_000);
    // o assets só confere o próprio pool (20% do global), e para nele
    await expect(budget.reserve('assets', 15_000)).rejects.toMatchObject({
      agent: 'assets',
      unit: 'tokens',
      limit: 600_000,
    });
    await expect(budget.reserve('assets', 5_000)).resolves.toBeDefined();
  });

  it('sem teto global de tokens, o pool também fica sem teto', () => {
    const p = ledgerPolicy(ledgerSettingsFromEnv({ AI_DAILY_TOKEN_BUDGET: 'unlimited' }));
    expect(p.tokenPools).toEqual({ assets: null });
  });
});

describe('registro do painel × padrões do ledger', () => {
  it('AI_AGENT_DEFAULT_USD_BUDGET e AI_AGENT_USD_BUDGETS: o padrão do registro é o do código', () => {
    expect(settingDef('AI_AGENT_DEFAULT_USD_BUDGET')?.default).toBe(String(DEFAULT_AGENT_DEFAULT_USD_BUDGET));
    expect(settingDef('AI_AGENT_USD_BUDGETS')?.default).toBe(DEFAULT_AGENT_USD_BUDGETS);
  });
});
