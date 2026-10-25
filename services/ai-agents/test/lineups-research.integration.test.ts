import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getPlatformLineup,
  llmUsage,
  planChannel,
  platform,
  platformPlan,
  setLineupReviewStatus,
  upsertLineupDraft,
  type Database,
} from '@galaxie/db';
import { Blocklist, parseCountryConfig, syncBroadcasterLibrary, WtwConfig } from '@galaxie/where-to-watch';
import { BudgetExceededError } from '../src/llm/errors.js';
import { FakeLlmClient, type FakeReply } from '../src/llm/fake.js';
import { withTokenBudget } from '../src/llm/factory.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { memoryPageStore, OfficialPageReader } from '../src/lineups/pages.js';
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

/** Etapa 1 da operadora: a lista dos planos (um deles a IA não acha depois) e o catálogo de complementos. */
const operatorCatalog = (withGhost = true) => ({
  data: {
    planos: [
      {
        plano_nome: 'Plano Exemplo Esportes',
        plano_url: PAGE,
        fonte_url: PAGE,
        trecho: 'Plano Exemplo Esportes',
      },
      ...(withGhost
        ? [
            // listado, mas a 2ª etapa não acha: plano faltando
            { plano_nome: 'Plano Fantasma', plano_url: null, fonte_url: PAGE, trecho: 'Plano Fantasma' },
            {
              plano_nome: 'Plano Sem Fonte',
              plano_url: null,
              fonte_url: 'https://inventada.exemplo/plano',
              trecho: 'Plano Sem Fonte',
            },
          ]
        : []),
      // sem fonte na lista: nem vai para a 2ª etapa
      { plano_nome: 'Plano da Memória', plano_url: null, fonte_url: null, trecho: null },
    ],
    complementos: [
      {
        nome: 'Streaming Exemplo',
        tipo: 'streaming',
        preco_mensal: 19.9,
        moeda_iso: 'BRL',
        fidelidade_meses: null,
        fonte_url: PAGE,
        trecho: 'Streaming Exemplo à parte por R$ 19,90 por mês',
        data_da_fonte: null,
      },
    ],
    notas: null,
  },
  groundedUrls: [PAGE],
});

/** Etapa 2: o detalhe de cada plano (pela mensagem, que diz qual é o plano). */
const operatorPlan =
  (price: number, withSecond = true) =>
  (req: LlmJsonRequest) => {
    const content = req.messages.map((m) => m.content).join('\n');
    if (content.includes('Plano: Plano Fantasma.'))
      return {
        data: {
          plano_nome: 'Plano Fantasma',
          encontrado: false,
          plano_url: null,
          fonte_url: null,
          trecho_da_fonte: null,
          precos: [],
          streamings_inclusos: [],
          canais: [],
          notas: null,
        },
        groundedUrls: [],
      };
    if (content.includes('Plano: Plano Sem Fonte.'))
      return {
        data: {
          plano_nome: 'Plano Sem Fonte',
          encontrado: true,
          plano_url: null,
          fonte_url: 'https://inventada.exemplo/plano',
          trecho_da_fonte: 'Plano Sem Fonte',
          precos: [],
          streamings_inclusos: [],
          canais: [],
          notas: null,
        },
        groundedUrls: [],
      };
    return {
      data: {
        plano_nome: 'Plano Exemplo Esportes',
        encontrado: true,
        plano_url: PAGE,
        fonte_url: PAGE,
        trecho_da_fonte: 'Plano Exemplo Esportes. Streaming Exemplo incluso.',
        precos: [
          {
            preco_mensal: price,
            moeda_iso: 'BRL',
            fonte_url: PAGE,
            trecho: `Plano Exemplo Esportes: R$ ${price.toFixed(2).replace('.', ',')} por mês.`,
            data_da_fonte: null,
          },
        ],
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
        notas: null,
      },
      groundedUrls: [PAGE, REDIRECT, 'https://agregador.exemplo/grade'],
    };
  };

const streamingCatalog = {
  data: {
    planos: [
      { plano_nome: 'Mensal', plano_url: `${ST}/planos`, fonte_url: `${ST}/planos`, trecho: 'Plano Mensal' },
    ],
    complementos: [],
    notas: null,
  },
  groundedUrls: [`${ST}/planos`],
};

const streamingPlan = {
  data: {
    plano_nome: 'Mensal',
    encontrado: true,
    plano_url: `${ST}/planos`,
    fonte_url: `${ST}/planos`,
    trecho_da_fonte: 'Plano Mensal',
    precos: [
      {
        preco_mensal: 29.9,
        moeda_iso: 'BRL',
        fonte_url: `${ST}/planos`,
        trecho: 'Plano Mensal: R$ 29,90 por mês.',
        data_da_fonte: null,
      },
    ],
    canais: [],
    streamings_inclusos: [],
    notas: null,
  },
  groundedUrls: [`${ST}/planos`],
};

function fake(replies: {
  discover?: FakeReply;
  operator?: { catalog: FakeReply; plan: (req: LlmJsonRequest) => FakeReply };
  streaming?: boolean;
}) {
  return new FakeLlmClient((req: LlmJsonRequest) => {
    if (req.purpose.startsWith('lineups:discover:')) return replies.discover ?? new Error('sem descoberta');
    if (req.purpose.includes('br-operadora-exemplo')) {
      if (!replies.operator) return new Error('sem planos');
      return req.purpose.startsWith('lineups:catalog:')
        ? replies.operator.catalog
        : replies.operator.plan(req);
    }
    if (req.purpose.includes('br-streaming-exemplo')) {
      if (!replies.streaming) return new Error('sem planos');
      return req.purpose.startsWith('lineups:catalog:') ? streamingCatalog : streamingPlan;
    }
    return new Error(`purpose inesperado: ${req.purpose}`);
  });
}

/** Leitor do site oficial com fetch falso: a operadora passou a redirecionar para a marca nova. */
const rebrandReader = () =>
  new OfficialPageReader({
    fetch: async (url) =>
      url === OP || url === `${OP}/`
        ? new Response(null, { status: 301, headers: { location: 'https://www.marca-nova.exemplo/inicio' } })
        : new Response('', { status: 404 }),
    store: memoryPageStore(),
    sleep: async () => undefined,
  });

const env = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await env.setup();
  await syncBroadcasterLibrary(db, config, NOW);
});
afterAll(() => env.teardown());

describe('lineups-research com busca (--com-busca, LLM falso)', () => {
  it('descobre, levanta os planos e grava só o que tem fonte, como rascunho', async () => {
    expect(await planLineupResearch(db, { countries: ['BR'], now: NOW })).toEqual([
      { kind: 'discover', country: 'BR', reason: 'new_country' },
    ]);
    const llm = fake({
      discover: discovery,
      operator: { catalog: operatorCatalog(), plan: operatorPlan(99.9) },
      streaming: true,
    });
    const budgeted = withTokenBudget(llm, { db, dailyLimit: null, provider: 'fake', now: () => NOW });
    const out = await new LineupResearcher({ db, llm: budgeted, config, now: () => NOW, resolveUrl }).run({
      countries: ['BR'],
      maxCalls: 10,
      // a pesquisa antiga, com busca em cada etapa (a padrão é pela página oficial)
      mode: 'search',
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
    ).toEqual([
      ['Plano Exemplo Esportes', 'R$ 99,90/mês', 99.9, 'BRL'],
      // listado na 1ª etapa, sem detalhe na 2ª: entra acusado como faltando
      ['Plano Fantasma', null, null, null],
    ]);
    expect(lineup!.plans[1]!.plan.verification).toMatchObject({
      verified: false,
      checks: { details: 'fail' },
    });
    expect([out[1]!.missingPlans, out[1]!.calls]).toEqual([['Plano Fantasma'], 4]);
    // catálogo de complementos da plataforma
    expect(lineup!.addons.map((a) => [a.refId, a.kind, a.priceAmount, a.priceText])).toEqual([
      ['streaming_exemplo', 'service', 19.9, 'R$ 19,90/mês'],
    ]);
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
    expect(out[1]!.verification).toMatchObject({
      plans: 2,
      pricedPlans: 1,
      included: 2,
      unverified: 1,
      addons: 1,
    });

    // a leitura pública nunca mostra o que está sem prova
    const pub = await getPlatformLineup(db, rows[0]!.id, { minReview: 'draft' });
    expect(pub!.plans[0]!.channels.map((c) => c.channelId)).toEqual(['canal_exemplo']);

    // custo no ledger compartilhado, agente `lineups`
    const usage = await db.select().from(llmUsage).where(eq(llmUsage.agent, 'lineups'));
    // descoberta + (lista + 3 planos) da operadora + (lista + 1 plano) do streaming
    expect(usage).toHaveLength(7);
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
      operator: { catalog: operatorCatalog(false), plan: operatorPlan(109.9, false) },
      streaming: true,
    });
    const out = await new LineupResearcher({
      db,
      llm,
      config,
      now: () => later,
      resolveUrl,
      pages: rebrandReader(),
    }).run({
      countries: ['BR'],
      revisit: true,
      maxCalls: 10,
      // a pesquisa antiga, com busca em cada etapa (a padrão é pela página oficial)
      mode: 'search',
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
    // rebrand: o site oficial passou a redirecionar para outro domínio — mudança para revisar
    const [op] = await db.select().from(platform).where(eq(platform.slug, 'br-operadora-exemplo'));
    expect(op!.proposedChange).toMatchObject({ website: 'https://www.marca-nova.exemplo/' });
    expect(op!.website).toBe(`${OP}/`);
    expect(
      out.find((o) => o.task.kind === 'plans' && o.task.slug === 'br-operadora-exemplo')?.rebrandTo,
    ).toBe('https://www.marca-nova.exemplo/');
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

describe('lineups-research: o que entra na fila', () => {
  const later = new Date(NOW.getTime() + 86_400_000);

  it('plataforma só com planos rejeitados volta a ser pesquisada (o rejeitado não conta)', async () => {
    const r = await upsertLineupDraft(db, {
      platform: {
        name: 'Operadora Rejeitada Exemplo',
        kind: 'pay_tv_operator',
        country: 'BR',
        website: 'https://rejeitada.exemplo',
        sources: ['https://rejeitada.exemplo/sobre'],
      },
      plans: [{ name: 'Plano Errado', sources: ['https://rejeitada.exemplo/planos'] }],
      seenAt: NOW,
    });
    await setLineupReviewStatus(db, { type: 'plan', id: r.planIds['plano-errado']! }, 'rejected', 'wagner');
    expect(await planLineupResearch(db, { countries: ['BR'], now: later })).toEqual([
      {
        kind: 'plans',
        country: 'BR',
        platformId: r.platformId,
        slug: 'br-operadora-rejeitada-exemplo',
        name: 'Operadora Rejeitada Exemplo',
        reason: 'no_plans',
      },
    ]);
    // na revisita, a plataforma sem plano válido vale pelo seen_at dela
    const old = new Date(NOW.getTime() + 40 * 86_400_000);
    const revisit = await planLineupResearch(db, { countries: ['BR'], now: old, revisit: true });
    expect(revisit.filter((t) => t.kind === 'plans').map((t) => t.kind === 'plans' && t.slug)).toContain(
      'br-operadora-rejeitada-exemplo',
    );
  });

  it('plataforma descoberta na revisita já entra na fila dos planos', async () => {
    const old = new Date(NOW.getTime() + 40 * 86_400_000);
    const llm = new FakeLlmClient((req: LlmJsonRequest) =>
      req.purpose.startsWith('lineups:discover:')
        ? {
            data: {
              platforms: [
                {
                  name: 'Operadora Nova Exemplo',
                  kind: 'vmvpd',
                  website: 'https://nova.exemplo',
                  dominios_oficiais: [],
                  sources: [src('https://nova.exemplo/sobre')],
                },
              ],
              notes: null,
            },
            groundedUrls: ['https://nova.exemplo/sobre'],
          }
        : new Error('sem planos neste teste'),
    );
    const out = await new LineupResearcher({ db, llm, config, now: () => old, resolveUrl }).run({
      countries: ['BR'],
      revisit: true,
      maxCalls: 20,
      mode: 'search',
    });
    expect(out[0]!.newPlatforms.map((p) => p.slug)).toEqual(['br-operadora-nova-exemplo']);
    expect(
      out.flatMap((o) => (o.task.kind === 'plans' ? [[o.task.slug, o.task.reason]] : [])),
    ).toContainEqual(['br-operadora-nova-exemplo', 'no_plans']);
  });

  it('--redescobrir enfileira os planos de todas as plataformas, não só das sem plano', async () => {
    const tasks = await planLineupResearch(db, { countries: ['BR'], now: later, rediscover: true });
    expect(tasks.map((t) => [t.kind, t.kind === 'plans' ? t.slug : null, t.reason])).toEqual([
      ['discover', null, 'rediscover'],
      ['plans', 'br-operadora-exemplo', 'requested'],
      ['plans', 'br-operadora-nova-exemplo', 'no_plans'],
      ['plans', 'br-operadora-rejeitada-exemplo', 'no_plans'],
      ['plans', 'br-streaming-exemplo', 'requested'],
    ]);
  });
});
