import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

import {
  HOME_CARDS,
  HOME_LINKS,
  aiCeilingPercent,
  buildHomeCards,
  failedJobs,
  homePendingTotal,
  missingCredentials,
  openAlerts,
  recentChanges,
  requiredSecret,
  type HomeSources,
} from './home-cards';

type Ops = NonNullable<HomeSources['ops']>;

const job = (name: string, errors24h: number) =>
  ({
    name,
    service: 'ingestor',
    runNow: true,
    last: null,
    lastOkAt: null,
    errors24h,
    queued: null,
  }) as Ops['jobs'][number];

const setting = (key: string, configured: boolean) =>
  ({
    key,
    section: 'credentials',
    value: null,
    source: 'env',
    configured,
  }) as unknown as Ops['settings'][number];

const llm = (costUsd: number, usdBudget: number | null, status: 'on' | 'off' = 'on') =>
  ({ status, usdBudget, totals: { costUsd } }) as unknown as Ops['llm'];

const history = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: n - i,
    key: 'LIVE_FEATURED',
    action: 'set',
    oldValue: null,
    newValue: 'on',
    changedBy: 'ana@galaxie',
    changedAt: new Date(Date.UTC(2026, 10, 11, 12 - i)).toISOString(),
  })) as Ops['history'];

function ops(over: Partial<Ops> = {}): Ops {
  return {
    jobs: [job('sync-daily', 0), job('live-run', 3), job('data-quality', 1)],
    services: [
      { service: 'ingestor', reportedAt: '2026-11-11T10:00:00Z', alive: true },
      { service: 'agents', reportedAt: '2026-11-11T08:00:00Z', alive: false },
      { service: 'live', reportedAt: null, alive: false },
    ],
    credit: {
      status: 'fail',
      code: 'http',
      provider: 'openai',
      model: null,
      http: 402,
      error: null,
      checkedAt: '',
    },
    settings: [
      setting('APISPORTS_KEY', true),
      setting('YOUTUBE_API_KEY', false),
      setting('OPENAI_API_KEY', false),
    ],
    llm: llm(8.5, 10),
    history: history(7),
    ...over,
  };
}

describe('agregadores do Início', () => {
  it('jobs com falha nas últimas 24 h', () => {
    expect(failedJobs(ops())).toBe(2);
  });

  it('alertas: serviço que relatou e caiu, mais a conta de IA reprovada', () => {
    expect(openAlerts(ops())).toBe(2);
    expect(openAlerts(ops({ credit: null }))).toBe(1);
  });

  it('credenciais faltando (só segredos do registro)', () => {
    expect(missingCredentials(ops())).toBe(2);
    expect(missingCredentials(ops({ settings: [setting('LIVE_FEATURED', false)] }))).toBe(0);
  });

  it('credenciais faltando: só as obrigatórias (opcionais e IA sem uso não contam)', () => {
    const value = (key: string, v: string) =>
      ({ ...setting(key, true), value: v }) as Ops['settings'][number];
    // opcionais: Stripe, token do GitHub das sugestões, métricas, chave da qualidade
    const optional = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'FEEDBACK_GITHUB_TOKEN',
      'METRICS_TOKEN',
      'QUALITY_API_KEY',
    ];
    for (const key of optional) expect(requiredSecret(ops(), key), key).toBe(false);
    expect(missingCredentials(ops({ settings: optional.map((k) => setting(k, false)) }))).toBe(0);
    // obrigatórias
    for (const key of ['APISPORTS_KEY', 'BETTER_AUTH_SECRET', 'S3_ACCESS_KEY', 'SMTP_HOST'])
      expect(requiredSecret(ops(), key), key).toBe(true);
    // IA: padrão do registro (ligada; OpenAI no AI_PROVIDER, Gemini na revisão e nos canais); Anthropic sem uso
    const keys = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'].map((k) => setting(k, false));
    expect(missingCredentials(ops({ settings: keys }))).toBe(2);
    // alguém passa a usar a Anthropic: a chave dela conta
    expect(missingCredentials(ops({ settings: [...keys, value('AI_RIGHTS_PROVIDER', 'anthropic')] }))).toBe(
      3,
    );
    // IA desligada: nenhuma chave de provedor faz falta
    expect(missingCredentials(ops({ settings: [...keys, value('AI_STATUS', 'off')] }))).toBe(0);
  });

  it('IA perto do teto: % do teto em US$; sem teto ou desligada, nada', () => {
    expect(aiCeilingPercent(ops())).toBe(85);
    expect(aiCeilingPercent(ops({ llm: llm(8.5, null) }))).toBeNull();
    expect(aiCeilingPercent(ops({ llm: llm(8.5, 10, 'off') }))).toBeNull();
  });

  it('as últimas 5 mudanças, da mais nova para a mais velha', () => {
    const recent = recentChanges(ops());
    expect(recent).toHaveLength(5);
    expect(recent[0]!.id).toBe(7);
    expect(recentChanges(null)).toEqual([]);
  });
});

describe('cartões do Início', () => {
  it('sete cartões, sempre na mesma ordem, com contagem e link', () => {
    const cards = buildHomeCards({ review: { pending: 12 }, requests: { open: 3 }, ops: ops() });
    expect(cards.map((c) => c.id)).toEqual([...HOME_CARDS]);
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(by.review).toMatchObject({ state: 'pending', count: 12, href: HOME_LINKS.review });
    expect(by.requests).toMatchObject({ state: 'pending', count: 3, href: '/ajustes/grades?aba=pedidos' });
    expect(by.failedJobs).toMatchObject({ state: 'pending', count: 2, tone: 'destructive' });
    expect(by.alerts).toMatchObject({ state: 'pending', count: 2 });
    expect(by.credentials).toMatchObject({ state: 'pending', count: 2, tone: 'warning' });
    expect(by.aiCeiling).toMatchObject({ state: 'pending', count: 1, percent: 85 });
    expect(by.signups).toMatchObject({ state: 'soon', href: '/ajustes/cadastros' });
    expect(homePendingTotal(cards)).toBe(12 + 3 + 2 + 2 + 2 + 1);
  });

  it('sem pendência o cartão fica neutro, não some', () => {
    const quiet = ops({
      jobs: [job('sync-daily', 0)],
      services: [],
      credit: null,
      settings: [setting('APISPORTS_KEY', true)],
      llm: llm(1, 10),
    });
    const cards = buildHomeCards({ review: { pending: 0 }, requests: { open: 0 }, ops: quiet });
    expect(cards).toHaveLength(HOME_CARDS.length);
    expect(cards.filter((c) => c.id !== 'signups').every((c) => c.state === 'clear')).toBe(true);
    expect(homePendingTotal(cards)).toBe(0);
  });

  it('fonte que falhou deixa só o cartão dela sem dados', () => {
    const cards = buildHomeCards({ review: null, requests: { open: 1 }, ops: null });
    const by = Object.fromEntries(cards.map((c) => [c.id, c.state]));
    expect(by).toMatchObject({
      review: 'unavailable',
      requests: 'pending',
      failedJobs: 'unavailable',
      aiCeiling: 'unavailable',
    });
  });

  it('cada cartão leva ao item do menu novo (#1068)', () => {
    expect(HOME_LINKS).toEqual({
      review: '/ajustes/revisao',
      requests: '/ajustes/grades?aba=pedidos',
      failedJobs: '/ajustes/tarefas',
      alerts: '/ajustes/status',
      credentials: '/ajustes/credenciais',
      aiCeiling: '/ajustes/ia',
      signups: '/ajustes/cadastros',
    });
  });

  it('aceita outros links', () => {
    const links = { ...HOME_LINKS, failedJobs: '/ajustes/tarefas' };
    const card = buildHomeCards({ review: null, requests: null, ops: null }, links).find(
      (c) => c.id === 'failedJobs',
    );
    expect(card?.href).toBe('/ajustes/tarefas');
  });

  it.each(LOCALES)('todo cartão tem texto (%s)', (locale) => {
    const T = getDictionary(locale).ops.home.cards;
    for (const id of HOME_CARDS) expect(T[id].title).not.toBe('');
  });
});
