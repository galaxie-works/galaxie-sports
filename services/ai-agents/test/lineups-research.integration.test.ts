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

/** Link do grounding que o validador segue até a página do plano (o `Location` do 302). */
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/EXEMPLO-1';
const PAGE = `${OP}/planos/esportes`;
const resolveUrl = async (url: string) => (url === REDIRECT ? PAGE : url);

const discovery = {
  data: {
    platforms: [
      {
        name: 'Operadora Exemplo',
        kind: 'pay_tv_operator',
        website: OP,
        // domínio do grupo vale; comparador informado como "oficial" não
        dominios_oficiais: ['grupo.exemplo', 'selectra.com.br'],
        sources: [src(`${OP}/sobre`)],
      },
      {
        name: 'Streaming Exemplo',
        kind: 'streaming',
        website: ST,
        dominios_oficiais: [],
        sources: [src(ST)],
      },
      // URL inventada pelo modelo (fora da busca): não entra
      {
        name: 'Operadora Sem Fonte',
        kind: 'vmvpd',
        website: null,
        dominios_oficiais: [],
        sources: [src('https://inventada.exemplo')],
      },
      // política editorial: descartada sem registrar o nome
      {
        name: 'Operadora Bloqueada Exemplo',
        kind: 'pay_tv_operator',
        website: 'https://bloqueada.exemplo',
        dominios_oficiais: [],
        sources: [src('https://bloqueada.exemplo')],
      },
    ],
    notes: null,
  },
  groundedUrls: [`${OP}/sobre`, ST, 'https://bloqueada.exemplo'],
};

const operatorPlans = (price: number, withSecond = true) => ({
  data: {
    planos: [
      {
        plano_nome: 'Plano Exemplo Esportes',
        preco_mensal: price,
        moeda_iso: 'BRL',
        plano_url: PAGE,
        fonte_url: PAGE,
        trecho_da_fonte: `Plano Exemplo Esportes: R$ ${price.toFixed(2).replace('.', ',')} por mês. Streaming Exemplo incluso.`,
        canais: [
          // fonte oficial pelo redirecionamento do grounding
          {
            canal_nome: 'Canal Exemplo',
            fonte_url: REDIRECT,
            trecho: 'Plano Exemplo Esportes: Canal Exemplo.',
          },
          ...(withSecond
            ? [
                // só o comparador cita: entra sem prova
                {
                  canal_nome: 'Canal Exemplo 2 HD',
                  fonte_url: 'https://agregador.exemplo/grade',
                  trecho: 'Plano Exemplo Esportes tem Canal Exemplo 2 HD.',
                },
              ]
            : []),
          { canal_nome: 'Canal Desconhecido', fonte_url: PAGE, trecho: 'Canal Desconhecido no plano.' },
          // da memória: sem fonte, sem conteúdo
          { canal_nome: 'Canal Exemplo 2', fonte_url: null, trecho: null },
        ],
        streamings_inclusos: [{ streaming_id: 'Streaming Exemplo', fonte_url: PAGE, trecho: null }],
      },
      {
        plano_nome: 'Plano Sem Fonte',
        preco_mensal: null,
        moeda_iso: null,
        plano_url: null,
        fonte_url: 'https://inventada.exemplo/plano',
        trecho_da_fonte: 'Plano Sem Fonte',
        canais: [],
        streamings_inclusos: [],
      },
    ],
    notas: null,
  },
  groundedUrls: [PAGE, REDIRECT, 'https://agregador.exemplo/grade'],
});

const streamingPlans = {
  data: {
    planos: [
      {
        plano_nome: 'Mensal',
        preco_mensal: 29.9,
        moeda_iso: 'BRL',
        plano_url: `${ST}/planos`,
        fonte_url: `${ST}/planos`,
        trecho_da_fonte: 'Plano Mensal: R$ 29,90 por mês.',
        canais: [],
        streamings_inclusos: [],
      },
    ],
    notas: null,
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
      operator: operatorPlans(99.9),
      streaming: streamingPlans,
    });
    const budgeted = withTokenBudget(llm, { db, dailyLimit: null, provider: 'fake', now: () => NOW });
    const out = await new LineupResearcher({ db, llm: budgeted, config, now: () => NOW, resolveUrl }).run({
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
    // a busca dos planos mira o site e os domínios oficiais da plataforma
    expect(llm.calls[1]).toMatchObject({ allowedDomains: ['operadora.exemplo', 'grupo.exemplo'] });

    const rows = await db.select().from(platform).orderBy(platform.slug);
    expect(rows.map((r) => [r.slug, r.kind, r.reviewStatus, r.broadcasterId, r.officialDomains])).toEqual([
      ['br-operadora-exemplo', 'pay_tv_operator', 'draft', null, ['grupo.exemplo']],
      ['br-streaming-exemplo', 'streaming', 'draft', 'streaming_exemplo', []],
    ]);

    const lineup = await getPlatformLineup(db, rows[0]!.id, { minReview: 'draft', includeUnverified: true });
    expect(
      lineup!.plans.map((p) => [p.plan.name, p.plan.priceText, p.plan.priceAmount, p.plan.priceCurrency]),
    ).toEqual([['Plano Exemplo Esportes', 'R$ 99,90/mês', 99.9, 'BRL']]);
    const plan = lineup!.plans[0]!;
    expect(plan.plan.verification).toMatchObject({ tier: 'official', verified: true });
    expect(plan.plan.sources.map((s) => s.url)).toEqual([PAGE]);
    // o redirecionamento foi seguido e a URL final é a guardada
    const [c1, c2] = plan.channels;
    expect([c1!.channelId, c1!.access, c1!.sources.map((s) => s.url)]).toEqual([
      'canal_exemplo',
      'included',
      [PAGE],
    ]);
    expect(c1!.verification).toMatchObject({
      source_url: REDIRECT,
      final_url: PAGE,
      checks: { redirect: 'pass' },
    });
    expect([c2!.channelId, c2!.access, c2!.verification?.tier]).toEqual([
      'canal_exemplo_2',
      'unverified',
      'comparator',
    ]);
    // streaming provado pelo trecho do plano ("incluso")
    expect(plan.services.map((s) => [s.serviceId, s.access])).toEqual([['streaming_exemplo', 'included']]);
    expect(out[1]!.drops.unknown).toEqual(['Canal Desconhecido']);
    expect(out[1]!.verification).toMatchObject({ plans: 1, pricedPlans: 1, included: 2, unverified: 1 });

    // a leitura pública nunca mostra o que está sem prova
    const pub = await getPlatformLineup(db, rows[0]!.id, { minReview: 'draft' });
    expect(pub!.plans[0]!.channels.map((c) => c.channelId)).toEqual(['canal_exemplo']);

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
      operator: operatorPlans(109.9, false),
      streaming: streamingPlans,
    });
    const out = await new LineupResearcher({ db, llm, config, now: () => later, resolveUrl }).run({
      countries: ['BR'],
      revisit: true,
      maxCalls: 10,
    });
    expect(out.map((o) => o.status)).toEqual(['done', 'done', 'done']);
    const changes = out.flatMap((o) => o.changes);
    expect(changes).toContainEqual({
      target: { type: 'plan', id: plan!.id },
      fields: ['priceText', 'priceAmount'],
    });
    expect(changes).toContainEqual({
      target: { type: 'plan_channel', planId: plan!.id, channelId: 'canal_exemplo_2' },
      fields: ['removed'],
    });

    const [after] = await db.select().from(platformPlan).where(eq(platformPlan.id, plan!.id));
    expect(after).toMatchObject({
      reviewStatus: 'approved',
      priceText: 'R$ 99,90/mês',
      priceAmount: 99.9,
      proposedChange: { priceText: 'R$ 109,90/mês', priceAmount: 109.9 },
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
