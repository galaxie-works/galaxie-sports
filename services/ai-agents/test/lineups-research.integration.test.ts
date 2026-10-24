import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getPlatformLineup,
  llmUsage,
  planChannel,
  platform,
  platformPlan,
  setLineupReviewStatus,
  type Database,
} from '@galaxie/db';
import { Blocklist, parseCountryConfig, syncBroadcasterLibrary, WtwConfig } from '@galaxie/where-to-watch';
import { BudgetExceededError } from '../src/llm/errors.js';
import { FakeLlmClient, type FakeReply } from '../src/llm/fake.js';
import { withTokenBudget } from '../src/llm/factory.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { LineupResearcher, planLineupResearch } from '../src/lineups/research.js';
import { disposableDb } from './helpers.js';

const OP = 'https://operadora.exemplo';
const ST = 'https://streaming.exemplo';
const NOW = new Date('2026-10-24T12:00:00Z');

/** Dicionário sintético: só "Canal Exemplo" e "Streaming Exemplo" (nenhum nome real). */
const config = new WtwConfig(
  [
    parseCountryConfig(
      'BR',
      {
        country: 'BR',
        broadcasters: [
          {
            id: 'canal_exemplo',
            name: 'Canal Exemplo',
            medium: 'pay_tv',
            access_model: 'subscription',
            domains: ['canal.exemplo'],
          },
          {
            id: 'canal_exemplo_2',
            name: 'Canal Exemplo 2',
            channels: ['Canal Exemplo 2 HD'],
            medium: 'pay_tv',
            access_model: 'subscription',
            domains: ['canal2.exemplo'],
          },
          {
            id: 'streaming_exemplo',
            name: 'Streaming Exemplo',
            medium: 'streaming_svod',
            access_model: 'subscription',
            domains: ['streaming.exemplo'],
          },
        ],
      },
      null,
      { organizers: [], press: [], aggregators: ['agregador.exemplo'] },
    ),
  ],
  new Blocklist([{ name: 'Operadora Bloqueada Exemplo', aliases: [], domains: ['bloqueada.exemplo'] }]),
);

const src = (url: string) => ({ url, excerpt: 'paráfrase curta' });

const discovery = {
  data: {
    platforms: [
      { name: 'Operadora Exemplo', kind: 'pay_tv_operator', website: OP, sources: [src(`${OP}/sobre`)] },
      { name: 'Streaming Exemplo', kind: 'streaming', website: ST, sources: [src(ST)] },
      // URL inventada pelo modelo (fora da busca): não entra
      {
        name: 'Operadora Sem Fonte',
        kind: 'vmvpd',
        website: null,
        sources: [src('https://inventada.exemplo')],
      },
      // política editorial: descartada sem registrar o nome
      {
        name: 'Operadora Bloqueada Exemplo',
        kind: 'pay_tv_operator',
        website: 'https://bloqueada.exemplo',
        sources: [src('https://bloqueada.exemplo')],
      },
    ],
    notes: null,
  },
  groundedUrls: [`${OP}/sobre`, ST, 'https://bloqueada.exemplo'],
};

const operatorPlans = (price: string, withSecond = true) => ({
  data: {
    plans: [
      {
        name: 'Plano Exemplo Esportes',
        price_text: price,
        url: `${OP}/planos/esportes`,
        sources: [src(`${OP}/planos/esportes`), src('https://agregador.exemplo/grade')],
        channels: [
          { name: 'Canal Exemplo', access: 'included', source_url: `${OP}/planos/esportes` },
          ...(withSecond
            ? [{ name: 'Canal Exemplo 2 HD', access: 'addon', source_url: `${OP}/planos/esportes` }]
            : []),
          { name: 'Canal Desconhecido', access: 'included', source_url: `${OP}/planos/esportes` },
          // fonte só do agregador: não vale
          { name: 'Canal Exemplo 2', access: 'included', source_url: 'https://agregador.exemplo/grade' },
        ],
        services: [{ name: 'Streaming Exemplo', access: 'included', source_url: `${OP}/planos/esportes` }],
      },
      {
        name: 'Plano Sem Fonte',
        price_text: null,
        url: null,
        sources: [src('https://inventada.exemplo/plano')],
        channels: [],
        services: [],
      },
    ],
    notes: null,
  },
  groundedUrls: [`${OP}/planos/esportes`, 'https://agregador.exemplo/grade'],
});

const streamingPlans = {
  data: {
    plans: [
      {
        name: 'Mensal',
        price_text: 'R$ 29,90/mês',
        url: `${ST}/planos`,
        sources: [src(`${ST}/planos`)],
        channels: [],
        services: [],
      },
    ],
    notes: null,
  },
  groundedUrls: [`${ST}/planos`],
};

function fake(replies: { discover?: FakeReply; operator?: FakeReply; streaming?: FakeReply }) {
  return new FakeLlmClient((req: LlmJsonRequest) => {
    if (req.purpose.startsWith('lineups:discover:')) return replies.discover ?? new Error('sem descoberta');
    if (req.purpose.includes('br-operadora-exemplo')) return replies.operator ?? new Error('sem planos');
    if (req.purpose.includes('br-streaming-exemplo')) return replies.streaming ?? new Error('sem planos');
    return new Error(`purpose inesperado: ${req.purpose}`);
  });
}

const env = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await env.setup();
  await syncBroadcasterLibrary(db, config, NOW);
});
afterAll(() => env.teardown());

describe('lineups-research (LLM falso)', () => {
  it('descobre, levanta os planos e grava só o que tem fonte, como rascunho', async () => {
    expect(await planLineupResearch(db, { countries: ['BR'], now: NOW })).toEqual([
      { kind: 'discover', country: 'BR', reason: 'new_country' },
    ]);
    const llm = fake({
      discover: discovery,
      operator: operatorPlans('R$ 99,90/mês'),
      streaming: streamingPlans,
    });
    const budgeted = withTokenBudget(llm, { db, dailyLimit: null, provider: 'fake', now: () => NOW });
    const out = await new LineupResearcher({ db, llm: budgeted, config, now: () => NOW }).run({
      countries: ['BR'],
      maxCalls: 10,
    });
    expect(out.map((o) => [o.task.kind, o.status])).toEqual([
      ['discover', 'done'],
      ['plans', 'done'],
      ['plans', 'done'],
    ]);
    expect(out[0]!.drops).toMatchObject({ noSource: 1, blocked: 1 });
    expect(llm.calls[0]).toMatchObject({ tier: 'research', webSearch: true });

    const rows = await db.select().from(platform).orderBy(platform.slug);
    expect(rows.map((r) => [r.slug, r.kind, r.reviewStatus, r.broadcasterId])).toEqual([
      ['br-operadora-exemplo', 'pay_tv_operator', 'draft', null],
      ['br-streaming-exemplo', 'streaming', 'draft', 'streaming_exemplo'],
    ]);

    const lineup = await getPlatformLineup(db, rows[0]!.id, { minReview: 'draft' });
    expect(lineup!.plans.map((p) => [p.plan.name, p.plan.priceText, p.plan.reviewStatus])).toEqual([
      ['Plano Exemplo Esportes', 'R$ 99,90/mês', 'draft'],
    ]);
    const plan = lineup!.plans[0]!;
    // agregador fora da fonte do plano; "Canal Exemplo 2" via agregador não vale, mas o HD (mesma entrada) vale
    expect(plan.plan.sources.map((s) => s.url)).toEqual([`${OP}/planos/esportes`]);
    expect(plan.channels.map((c) => [c.channelId, c.access])).toEqual([
      ['canal_exemplo', 'included'],
      ['canal_exemplo_2', 'addon'],
    ]);
    expect(plan.services.map((s) => s.serviceId)).toEqual(['streaming_exemplo']);
    expect(out[1]!.drops.unknown).toEqual(['Canal Desconhecido']);

    // custo no ledger compartilhado, agente `lineups`
    const usage = await db.select().from(llmUsage).where(eq(llmUsage.agent, 'lineups'));
    expect(usage).toHaveLength(3);
  });

  it('é idempotente: rodar de novo não pesquisa nada', async () => {
    expect(await planLineupResearch(db, { countries: ['BR'], now: NOW })).toEqual([]);
    const llm = fake({});
    const out = await new LineupResearcher({ db, llm, config, now: () => NOW }).run({
      countries: ['BR'],
      maxCalls: 5,
    });
    expect(out).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('revisita refaz o que ficou velho e marca o que mudou, sem tirar a aprovação', async () => {
    const [plan] = await db
      .select()
      .from(platformPlan)
      .where(eq(platformPlan.name, 'Plano Exemplo Esportes'));
    await setLineupReviewStatus(db, { type: 'plan', id: plan!.id }, 'approved', 'wagner');
    await setLineupReviewStatus(
      db,
      { type: 'plan_channel', planId: plan!.id, channelId: 'canal_exemplo_2' },
      'approved',
      'wagner',
    );
    await db.execute(sql`update enrich.platform_plan set seen_at = seen_at - interval '40 days'`);
    await db.execute(sql`update enrich.platform set seen_at = seen_at - interval '40 days'`);

    const later = new Date(NOW.getTime() + 86_400_000);
    const tasks = await planLineupResearch(db, { countries: ['BR'], now: later, revisit: true });
    expect(tasks.map((t) => [t.kind, t.reason])).toEqual([
      ['discover', 'revisit'],
      ['plans', 'revisit'],
      ['plans', 'revisit'],
    ]);

    const llm = fake({
      discover: discovery,
      operator: operatorPlans('R$ 109,90/mês', false),
      streaming: streamingPlans,
    });
    const out = await new LineupResearcher({ db, llm, config, now: () => later }).run({
      countries: ['BR'],
      revisit: true,
      maxCalls: 10,
    });
    expect(out.map((o) => o.status)).toEqual(['done', 'done', 'done']);
    const changes = out.flatMap((o) => o.changes);
    expect(changes).toContainEqual({ target: { type: 'plan', id: plan!.id }, fields: ['priceText'] });
    expect(changes).toContainEqual({
      target: { type: 'plan_channel', planId: plan!.id, channelId: 'canal_exemplo_2' },
      fields: ['removed'],
    });

    const [after] = await db.select().from(platformPlan).where(eq(platformPlan.id, plan!.id));
    expect(after).toMatchObject({
      reviewStatus: 'approved',
      priceText: 'R$ 99,90/mês',
      proposedChange: { priceText: 'R$ 109,90/mês' },
    });
    expect(after!.seenAt.getTime()).toBe(later.getTime());
    const [link] = await db
      .select()
      .from(planChannel)
      .where(and(eq(planChannel.planId, plan!.id), eq(planChannel.channelId, 'canal_exemplo_2')));
    expect(link).toMatchObject({ reviewStatus: 'approved', proposedChange: { removed: true } });
    expect(await planLineupResearch(db, { countries: ['BR'], now: later, revisit: true })).toEqual([]);
  });

  it('orçamento esgotado interrompe a execução sem gravar', async () => {
    const llm = new FakeLlmClient([new BudgetExceededError('lineups', 10, 10, 5)]);
    const out = await new LineupResearcher({ db, llm, config, now: () => NOW }).run({
      countries: ['BR'],
      rediscover: true,
      maxCalls: 5,
    });
    expect(out.map((o) => o.status)).toEqual(['skipped']);
    expect(llm.calls).toHaveLength(1);
  });
});
