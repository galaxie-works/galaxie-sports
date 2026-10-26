/**
 * Política de execução da IA (#357): faixas por prioridade dentro do teto global, prioridade pela
 * competição (market-audience.yaml + config/ai-policy.yaml), dia de orçamento às 06:00 em Brasília e o
 * caminho painel → runtime setting → serviço. Nenhuma chamada real a provedor (FakeLlmClient).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BudgetExceededError,
  DEFAULT_P0_MIN_AUDIENCE,
  LlmError,
  MemoryTokenBudgetStore,
  TokenBudget,
  ledgerSettingsFromEnv,
  loadAiPolicy,
  parseAiPolicy,
} from '@galaxie/ai-ledger';
import { MarketAudience } from '@galaxie/geo';
import {
  DEFAULT_BAND_SHARES,
  DEFAULT_BAND_SHARES_TEXT,
  DEFAULT_BUDGET_DAY,
  applyOverrides,
  formatBandShares,
  settingDef,
  validateSettingKey,
} from '@galaxie/runtime-config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { byPriority, usesLlm } from '../context/run.js';
import { DEFAULT_AGENT_USD_BUDGETS, parseAgentUsdBudgets } from './config.js';
import { BudgetedLlmClient } from './budget.js';
import { FakeLlmClient } from './fake.js';
import { competitionPriority, priorityResolver } from './priority.js';
import type { LlmJsonRequest } from './types.js';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const policy = loadAiPolicy(repo('config/ai-policy.yaml'));
const audience = new MarketAudience({
  schema_version: 1,
  common: { football: { 'premier-league': 20, laliga: 20 } },
  markets: {
    BR: { football: { 'brasileirao-serie-a': 35, 'brasileirao-serie-b': 25 } },
    MX: { football: { 'liga-mx': 35, 'concacaf-champions-cup': 15 } },
  },
});
const priorityOf = priorityResolver({ minAudience: DEFAULT_P0_MIN_AUDIENCE, policy, audience });

afterEach(() => vi.restoreAllMocks());

describe('config/ai-policy.yaml', () => {
  it('é válido, cobre todo agente com teto próprio e só cita competições do catálogo', () => {
    for (const agent of Object.keys(parseAgentUsdBudgets(DEFAULT_AGENT_USD_BUDGETS)!))
      expect(policy.agents[agent], agent).toBeDefined();
    expect(policy.agents.context).toBe('priority');
    expect(policy.agents.lineups).toBe('clients');
    const catalog = parse(readFileSync(repo('config/competitions/football.yaml'), 'utf8')) as {
      competitions: { slug: string }[];
    };
    const slugs = new Set(catalog.competitions.map((c) => c.slug));
    for (const slug of [...policy.competitions.p0, ...policy.competitions.p1])
      expect(slugs.has(slug), slug).toBe(true);
  });

  it('recusa faixa desconhecida e competição nas duas listas', () => {
    expect(() => parseAiPolicy({ schema_version: 1, agents: { wtw: 'p9' } })).toThrow(LlmError);
    expect(() =>
      parseAiPolicy({ schema_version: 1, agents: {}, competitions: { p0: ['x'], p1: ['x'] } }),
    ).toThrow(/p0 e p1/);
  });
});

describe('prioridade pela competição', () => {
  it('P0 = audiência ≥ 25 num mercado; P1 = o resto com audiência; resto = sem audiência', () => {
    expect(priorityOf({ slug: 'brasileirao-serie-a' })).toBe('p0');
    expect(priorityOf({ slug: 'brasileirao-serie-b' })).toBe('p0');
    expect(priorityOf({ slug: 'premier-league' })).toBe('p1');
    expect(priorityOf({ slug: 'concacaf-champions-cup' })).toBe('p1');
    expect(priorityOf({ slug: 'eredivisie' })).toBe('rest');
    expect(priorityOf({ sport: 'basketball', slug: 'nba' })).toBe('rest');
    expect(priorityOf(null)).toBe('rest');
  });

  it('exceções do arquivo: seleções vêm antes da audiência', () => {
    expect(priorityOf({ slug: 'fifa-world-cup' })).toBe('p0');
    expect(priorityOf({ slug: 'copa-america' })).toBe('p0');
    expect(priorityOf({ slug: 'fifa-club-world-cup' })).toBe('p1');
  });

  it('o corte do painel move a fronteira P0/P1', () => {
    const strict = { audience, policy, minAudience: 30 };
    expect(competitionPriority({ slug: 'brasileirao-serie-b' }, strict)).toBe('p1');
    expect(competitionPriority({ slug: 'liga-mx' }, strict)).toBe('p0');
  });

  it('resumo e cenário: fila P0 → P1 → resto, horário dentro de cada uma; LLM só para P0 e P1', () => {
    const at = (h: number) => new Date(`2026-10-26T${String(h).padStart(2, '0')}:00:00Z`);
    const rows = [
      { id: 'eredivisie', startsAt: at(10), sport: 'football', slug: 'eredivisie' },
      { id: 'premier', startsAt: at(11), sport: 'football', slug: 'premier-league' },
      { id: 'brasileirao', startsAt: at(20), sport: 'football', slug: 'brasileirao-serie-a' },
      { id: 'liga-mx', startsAt: at(22), sport: 'football', slug: 'liga-mx' },
    ];
    expect(byPriority(rows, priorityOf, 10)).toEqual([
      { id: 'brasileirao', priority: 'p0' },
      { id: 'liga-mx', priority: 'p0' },
      { id: 'premier', priority: 'p1' },
      { id: 'eredivisie', priority: 'rest' },
    ]);
    // o corte da fila vem depois da ordem: o P0 das 22h não fica de fora pelo jogo das 10h
    expect(byPriority(rows, priorityOf, 2).map((r) => r.id)).toEqual(['brasileirao', 'liga-mx']);
    expect(usesLlm('p0') && usesLlm('p1')).toBe(true);
    expect(usesLlm('rest')).toBe(false);
  });
});

const req = (purpose: string, slug?: string): LlmJsonRequest => ({
  tier: 'light',
  system: 's',
  messages: [{ role: 'user', content: 'x' }],
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  schemaName: 'ok',
  purpose,
  ...(slug ? { competition: { slug } } : {}),
});

/** Cliente com orçamento, faixas da política e um gasto de US$ 1 por chamada (teto global de US$ 10). */
function client(opts: { manual?: boolean; now?: () => Date } = {}) {
  const store = new MemoryTokenBudgetStore();
  const fake = new FakeLlmClient(() => ({ data: { ok: true }, usage: { costUsd: 1 } }));
  const budget = new TokenBudget(
    store,
    {
      dailyLimit: null,
      dailyUsdLimit: 10,
      agentUsdLimits: {},
      agentDefaultUsdLimit: null,
      day: DEFAULT_BUDGET_DAY,
      bands: { shares: DEFAULT_BAND_SHARES, policy, manual: opts.manual ?? false, priorityOf },
    },
    opts.now,
  );
  return { store, fake, llm: new BudgetedLlmClient(fake, budget) };
}

describe('faixas por prioridade no teto global', () => {
  it('cada chamada grava a faixa: P0, P1, clientes, resto e manual', async () => {
    const { llm, store } = client();
    await llm.generateJson(req('context:recap:1', 'brasileirao-serie-a'));
    await llm.generateJson(req('context:recap:2', 'premier-league'));
    await llm.generateJson(req('lineups:extract:x'));
    await llm.generateJson(req('review:1'));
    expect(store.entries.map((e) => e.band)).toEqual(['p0', 'p1', 'clients', 'rest']);
    // agente fora da política: `default_band` (rest)
    const novo = client();
    await novo.llm.generateJson(req('agente-novo:1'));
    expect(novo.store.entries[0]!.band).toBe('rest');
    const manual = client({ manual: true });
    await manual.llm.generateJson(req('context:recap:1', 'brasileirao-serie-a'));
    expect(manual.store.entries[0]!.band).toBe('manual');
  });

  it('faixa esgotada não invade outra: P1 (15% de US$ 10) para em US$ 1,50 e a P0 segue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, fake } = client();
    await llm.generateJson(req('context:recap:1', 'premier-league'));
    await llm.generateJson(req('context:recap:2', 'premier-league'));
    const refused = llm.generateJson(req('context:recap:3', 'premier-league'));
    await expect(refused).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(refused).rejects.toMatchObject({ agent: 'faixa:p1', unit: 'usd' });
    expect(fake.calls).toHaveLength(2);
    // o saldo das outras faixas (e do global) continua lá, mas a P1 não pega dele
    await llm.generateJson(req('context:recap:4', 'brasileirao-serie-a'));
    expect(fake.calls).toHaveLength(3);
  });

  it('a reserva só serve a P0: a P0 passa dos 45% até 55%; a P1 nunca chega nela', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, fake, store } = client();
    for (let i = 0; i < 6; i++) await llm.generateJson(req(`context:recap:${i}`, 'brasileirao-serie-a'));
    // 4,50 da faixa + 1,00 da reserva = 5,50: a 6ª chamada (gasto 5 < 5,5) ainda coube na reserva
    expect(fake.calls).toHaveLength(6);
    await expect(llm.generateJson(req('context:recap:8', 'brasileirao-serie-a'))).rejects.toMatchObject({
      agent: 'faixa:p0',
    });
    expect(store.entries.every((e) => e.band === 'p0')).toBe(true);
  });

  it('manual (10%) recusa a partir de US$ 1 sem tocar no futebol', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, fake } = client({ manual: true });
    await llm.generateJson(req('f1bio:senna'));
    await expect(llm.generateJson(req('f1bio:prost'))).rejects.toMatchObject({ agent: 'faixa:manual' });
    expect(fake.calls).toHaveLength(1);
  });

  it('o dia de orçamento vira às 06:00 em Brasília: o gasto das 05:59 é do dia anterior', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = new Date('2026-10-26T08:00:00Z'); // 05:00 em Brasília: ainda dia 25
    const { llm, fake, store } = client({ now: () => now });
    await llm.generateJson(req('context:recap:1', 'premier-league'));
    await llm.generateJson(req('context:recap:2', 'premier-league'));
    expect(store.entries.map((e) => e.budgetDay)).toEqual(['2026-10-25', '2026-10-25']);
    now = new Date('2026-10-26T08:59:00Z'); // 05:59: a P1 do dia 25 está gasta
    await expect(llm.generateJson(req('context:recap:3', 'premier-league'))).rejects.toMatchObject({
      agent: 'faixa:p1',
    });
    now = new Date('2026-10-26T09:00:00Z'); // 06:00: dia 26, faixa zerada (às 00:00 UTC nada mudou)
    await llm.generateJson(req('context:recap:4', 'premier-league'));
    expect(fake.calls).toHaveLength(3);
    expect(store.entries.at(-1)!.budgetDay).toBe('2026-10-26');
  });
});

describe('painel → runtime setting → serviço (mesmas regras)', () => {
  it('o que os sliders gravam passa no registro e o serviço lê igual', () => {
    const shares = { p0: 60, reserve: 10, p1: 10, clients: 12, rest: 5, manual: 3 };
    const values = {
      AI_BAND_SHARES: formatBandShares(shares),
      AI_DAILY_USD_BUDGET: '12.5',
      AI_P0_MIN_AUDIENCE: '30',
    };
    // o painel (saveAiPolicy) valida pelo registro antes de gravar
    for (const [key, value] of Object.entries(values))
      expect(validateSettingKey(key, value), key).toMatchObject({ ok: true, value });
    // o scheduler entrega aos jobs o env com as sobrescritas do banco; o ledger lê pelas mesmas regras
    const { env } = applyOverrides({}, new Map(Object.entries(values)));
    const read = ledgerSettingsFromEnv(env);
    expect(read.bandShares).toEqual(shares);
    expect(read.dailyUsdBudget).toBe(12.5);
    expect(read.p0MinAudience).toBe(30);
    expect(read.budgetDay).toEqual(DEFAULT_BUDGET_DAY);
  });

  it('faixas que não somam 100: o painel recusa e o serviço também (falha a configuração, sem IA)', () => {
    const bad = 'p0=70,reserve=10,p1=15,clients=12,rest=5,manual=3';
    expect(validateSettingKey('AI_BAND_SHARES', bad)).toMatchObject({ ok: false, error: { code: 'shares' } });
    expect(() => ledgerSettingsFromEnv({ AI_BAND_SHARES: bad })).toThrow(LlmError);
    expect(() => ledgerSettingsFromEnv({ AI_BAND_SHARES: bad })).toThrow(/AI_BAND_SHARES/);
  });

  it('padrões do registro = padrões do serviço', () => {
    const s = ledgerSettingsFromEnv({});
    expect(s.bandShares).toEqual(DEFAULT_BAND_SHARES);
    expect(settingDef('AI_BAND_SHARES')?.default).toBe(DEFAULT_BAND_SHARES_TEXT);
    expect(settingDef('AI_P0_MIN_AUDIENCE')?.default).toBe(String(DEFAULT_P0_MIN_AUDIENCE));
    expect(settingDef('AI_BUDGET_DAY_START')?.default).toBe(DEFAULT_BUDGET_DAY.start);
    expect(settingDef('AI_BUDGET_TIMEZONE')?.default).toBe(DEFAULT_BUDGET_DAY.timeZone);
    expect(s.budgetDay).toEqual({ timeZone: 'America/Sao_Paulo', start: '06:00' });
  });
});
