import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getPlatformLineup,
  llmUsage,
  platform,
  platformPlan,
  setLineupReviewStatus,
  upsertLineupDraft,
  type Database,
} from '@galaxie/db';
import { Blocklist, parseCountryConfig, syncBroadcasterLibrary, WtwConfig } from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../src/llm/fake.js';
import { withTokenBudget } from '../src/llm/factory.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { memoryPageStore, OfficialPageReader, type PageRenderer } from '../src/lineups/pages.js';
import { LineupResearcher, planLineupResearch } from '../src/lineups/research.js';
import type { LineupPageExtractOutput } from '../src/lineups/schema.js';
import { disposableDb } from './helpers.js';

const OP = 'https://operadora.exemplo';
const PLANS = `${OP}/planos`;
const NOW = new Date('2026-10-25T12:00:00Z');

/** Dicionário sintético: só "Canal Exemplo", "Canal Exemplo 2" e "Streaming Exemplo" (nenhum nome real). */
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
      { organizers: [], press: [], aggregators: [] },
    ),
  ],
  new Blocklist([]),
);

/** A página de planos como o navegador a vê: o cartão do plano e a lista aberta pelo botão dele. */
const rendered = (price: string) => ({
  finalUrl: PLANS,
  status: 200,
  text: [
    'Conheça nossos planos',
    'Plano Exemplo Esportes',
    `R$ ${price}`,
    'por mês',
    'Streaming Exemplo incluso no plano.',
    'Mostrar lista de canais',
    'Personalize seu plano',
    'Canal Exemplo 2',
    'R$ 9,90',
    'por mês',
  ].join('\n'),
  sections: [{ label: 'Plano Exemplo Esportes', text: 'Canais\nEsportes\nCanal Exemplo' }],
  blocked: false,
});

let page = rendered('99,90');
const renderer: PageRenderer = { render: async () => page, close: async () => undefined };

/** Leitor com fetch falso (HTML sem a grade: precisa do navegador) e cache em memória. */
const reader = (maxPages?: number) =>
  new OfficialPageReader({
    fetch: async (url) =>
      url.endsWith('/robots.txt')
        ? new Response('', { status: 404 })
        : url === PLANS
          ? new Response('<html><body><div id="app"></div></body></html>', { status: 200 })
          : new Response('', { status: 404 }),
    renderer,
    store: memoryPageStore(),
    sleep: async () => undefined,
    minIntervalMs: 0,
    ...(maxPages !== undefined ? { maxPages } : {}),
  });

const extraction = (price: number): LineupPageExtractOutput => ({
  planos: [
    {
      plano_nome: 'Plano Exemplo Esportes',
      trecho_do_plano: 'Plano Exemplo Esportes',
      precos: [
        {
          preco_mensal: price,
          moeda_iso: 'BRL',
          trecho: `Plano Exemplo Esportes R$ ${price.toFixed(2).replace('.', ',')} por mês`,
        },
      ],
      canais: [
        { canal_nome: 'Canal Exemplo', trecho: 'Canal Exemplo' },
        // a linha está no complemento, não na lista do plano: sem prova deste plano
        { canal_nome: 'Canal Exemplo 2', trecho: 'Canal Exemplo 2' },
      ],
      streamings_inclusos: [
        { streaming_nome: 'Streaming Exemplo', trecho: 'Streaming Exemplo incluso no plano.' },
      ],
    },
  ],
  complementos: [
    {
      nome: 'Canal Exemplo 2',
      tipo: 'canal',
      preco_mensal: 9.9,
      moeda_iso: 'BRL',
      fidelidade_meses: null,
      trecho: 'Canal Exemplo 2 R$ 9,90 por mês',
    },
  ],
  notas: null,
});

function fake(price: number) {
  return new FakeLlmClient((req: LlmJsonRequest) => {
    if (req.purpose.startsWith('lineups:pages-url:'))
      return {
        data: {
          paginas: [
            { url: PLANS, tipo: 'lista_de_planos' },
            // fora do domínio oficial: não entra
            { url: 'https://comparador.exemplo/operadora', tipo: 'lista_de_planos' },
          ],
          notas: null,
        },
        groundedUrls: [PLANS, 'https://comparador.exemplo/operadora'],
        usage: { webSearchCalls: 2 },
      };
    if (req.purpose.startsWith('lineups:extract:')) return { data: extraction(price) };
    return new Error(`purpose inesperado: ${req.purpose}`);
  });
}

const env = disposableDb();
let db: Database;
let platformId: string;

beforeAll(async () => {
  db = await env.setup();
  await syncBroadcasterLibrary(db, config, NOW);
  const r = await upsertLineupDraft(db, {
    platform: {
      name: 'Operadora Exemplo',
      kind: 'pay_tv_operator',
      country: 'BR',
      website: OP,
      sources: [`${OP}/sobre`],
    },
    seenAt: NOW,
  });
  platformId = r.platformId;
});
afterAll(() => env.teardown());

describe('lineups-research pela página oficial (LLM e site falsos)', () => {
  it('sem página guardada: uma busca curta acha a URL, a página é lida e a extração não busca', async () => {
    const llm = fake(99.9);
    const budgeted = withTokenBudget(llm, { db, dailyLimit: null, provider: 'fake', now: () => NOW });
    const out = await new LineupResearcher({
      db,
      llm: budgeted,
      config,
      now: () => NOW,
      pages: reader(),
    }).run({
      countries: ['BR'],
      maxCalls: 4,
    });
    expect(out.map((o) => [o.task.kind, o.status, o.searchCalls, o.extractCalls, o.searches])).toEqual([
      ['plans', 'done', 1, 1, 2],
    ]);
    expect(llm.calls.map((c) => [c.purpose, c.tier, c.webSearch])).toEqual([
      ['lineups:pages-url:br-operadora-exemplo:BR', 'research', true],
      ['lineups:extract:br-operadora-exemplo:BR', 'light', false],
    ]);
    // a extração recebe o texto da página, com a lista aberta do plano
    expect(llm.calls[1]!.messages[0]!.content).toContain(
      '### Lista aberta no cartão: Plano Exemplo Esportes',
    );

    const [row] = await db.select().from(platform).where(eq(platform.id, platformId));
    expect(row!.planPages).toEqual([PLANS]);
    expect(row!.planPagesHash).toMatch(/^[0-9a-f]{64}$/);

    const lineup = await getPlatformLineup(db, platformId, { minReview: 'draft', includeUnverified: true });
    const plan = lineup!.plans[0]!;
    expect([plan.plan.name, plan.plan.priceAmount, plan.plan.priceText]).toEqual([
      'Plano Exemplo Esportes',
      99.9,
      'R$ 99,90/mês',
    ]);
    expect(plan.plan.verification).toMatchObject({
      tier: 'official',
      verified: true,
      checks: { page: 'pass' },
      page: { url: PLANS, via: 'render' },
    });
    expect(plan.channels.map((c) => [c.channelId, c.access])).toEqual([
      ['canal_exemplo', 'included'],
      ['canal_exemplo_2', 'unverified'],
    ]);
    expect(plan.services.map((s) => [s.serviceId, s.access])).toEqual([['streaming_exemplo', 'included']]);
    expect(lineup!.addons.map((a) => [a.refId, a.kind, a.priceAmount])).toEqual([
      ['canal_exemplo_2', 'channel', 9.9],
    ]);

    // as buscas reais no ledger: 2 na descoberta da URL, 0 na extração
    const usage = await db.select().from(llmUsage).where(eq(llmUsage.agent, 'lineups'));
    expect(usage.map((u) => [u.purpose.split(':')[1], u.webSearches]).sort()).toEqual([
      ['extract', 0],
      ['pages-url', 2],
    ]);
  });

  it('página igual à da última extração: nenhuma chamada ao modelo, e a revisita não volta amanhã', async () => {
    await db.execute(sql`update enrich.platform_plan set seen_at = seen_at - interval '40 days'`);
    await db.execute(sql`update enrich.platform set seen_at = seen_at - interval '40 days'`);
    const later = new Date(NOW.getTime() + 86_400_000);
    const tasks = await planLineupResearch(db, { countries: ['BR'], now: later, revisit: true });
    expect(tasks.map((t) => [t.kind, t.reason])).toEqual([
      ['discover', 'revisit'],
      ['plans', 'revisit'],
    ]);
    const llm = fake(99.9);
    const out = await new LineupResearcher({ db, llm, config, now: () => later, pages: reader() }).run({
      countries: ['BR'],
      platformSlug: 'br-operadora-exemplo',
      maxCalls: 4,
    });
    expect(out.map((o) => [o.status, o.pagesUnchanged, o.calls])).toEqual([['done', true, 0]]);
    expect(llm.calls).toHaveLength(0);
    const [plan] = await db.select().from(platformPlan).where(eq(platformPlan.platformId, platformId));
    expect(plan!.seenAt.getTime()).toBe(later.getTime());
    expect(
      (await planLineupResearch(db, { countries: ['BR'], now: later, revisit: true })).filter(
        (t) => t.kind === 'plans',
      ),
    ).toEqual([]);
  });

  it('página mudou: extrai de novo (sem buscar a URL, que está guardada) e o preço novo entra', async () => {
    page = rendered('109,90');
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const llm = fake(109.9);
    const out = await new LineupResearcher({ db, llm, config, now: () => later, pages: reader() }).run({
      countries: ['BR'],
      platformSlug: 'br-operadora-exemplo',
      maxCalls: 4,
    });
    expect(out.map((o) => [o.status, o.pagesUnchanged, o.searchCalls, o.extractCalls])).toEqual([
      ['done', false, 0, 1],
    ]);
    expect(llm.calls.map((c) => c.purpose)).toEqual(['lineups:extract:br-operadora-exemplo:BR']);
    const [plan] = await db.select().from(platformPlan).where(eq(platformPlan.platformId, platformId));
    expect(plan!.priceAmount).toBe(109.9);
  });

  /** Revisita direta da plataforma (a grade completa marca o que sumiu como `removed`). */
  const revisit = async (extracted: LineupPageExtractOutput, at: Date) => {
    const llm = new FakeLlmClient((req: LlmJsonRequest) =>
      req.purpose.startsWith('lineups:extract:')
        ? { data: extracted }
        : new Error(`purpose inesperado: ${req.purpose}`),
    );
    const researcher = new LineupResearcher({ db, llm, config, now: () => at, pages: reader() });
    return researcher.researchFromPages(
      {
        kind: 'plans',
        country: 'BR',
        platformId,
        slug: 'br-operadora-exemplo',
        name: 'Operadora Exemplo',
        reason: 'revisit',
      },
      Infinity,
      { force: true },
    );
  };

  it('revisita com a página cortada no prompt não marca canal nem complemento como removido', async () => {
    const base = rendered('109,90');
    // a página passa do teto de caracteres do prompt: o modelo não viu tudo
    page = { ...base, text: `${base.text}\n${'Texto institucional. '.repeat(10_000)}` };
    const extracted = extraction(109.9);
    const out = await revisit(
      { ...extracted, planos: [{ ...extracted.planos[0]!, canais: [] }], complementos: [] },
      new Date(NOW.getTime() + 3 * 86_400_000),
    );
    expect(out.status).toBe('done');
    expect([out.removed, out.changes.filter((c) => c.fields.includes('removed'))]).toEqual([0, []]);
  });

  it('revisita com a página inteira e sem complementos marca o complemento antigo como removido', async () => {
    page = rendered('109,90');
    const out = await revisit(
      { ...extraction(109.9), complementos: [] },
      new Date(NOW.getTime() + 4 * 86_400_000),
    );
    expect(out.status).toBe('done');
    expect(out.changes.filter((c) => c.fields.includes('removed')).map((c) => c.target.type)).toEqual([
      'addon',
    ]);
    const lineup = await getPlatformLineup(db, platformId, { minReview: 'draft', includeUnverified: true });
    expect(lineup!.addons.map((a) => [a.refId, a.proposedChange])).toEqual([
      ['canal_exemplo_2', expect.objectContaining({ removed: true })],
    ]);
  });

  /** Plataforma só com plano rejeitado e sem página de planos guardada: a revisita busca as URLs. */
  const withoutPages = async (name: string, site: string) => {
    const r = await upsertLineupDraft(db, {
      platform: { name, kind: 'pay_tv_operator', country: 'BR', website: site, sources: [`${site}/sobre`] },
      plans: [{ name: 'Plano Errado', sources: [`${site}/plano-errado`] }],
      seenAt: NOW,
    });
    await setLineupReviewStatus(db, { type: 'plan', id: r.planIds['plano-errado']! }, 'rejected', 'wagner');
    return r.platformId;
  };
  const pagesSearch = (urls: string[]) =>
    new FakeLlmClient((req: LlmJsonRequest) =>
      req.purpose.startsWith('lineups:pages-url:')
        ? {
            data: { paginas: urls.map((url) => ({ url, tipo: 'lista_de_planos' })), notas: null },
            groundedUrls: urls,
          }
        : new Error(`purpose inesperado: ${req.purpose}`),
    );
  const taskOf = async (slug: string, at: Date) =>
    (await planLineupResearch(db, { countries: ['BR'], now: at, revisit: true })).find(
      (t) => t.kind === 'plans' && t.slug === slug,
    ) as Extract<Awaited<ReturnType<typeof planLineupResearch>>[number], { kind: 'plans' }> | undefined;

  it('busca das URLs que não leu nada não volta no dia seguinte; sem páginas no limite, nem busca', async () => {
    const SITE = 'https://rejeitada.exemplo';
    const id = await withoutPages('Operadora Rejeitada Exemplo', SITE);
    const day1 = new Date(NOW.getTime() + 40 * 86_400_000);
    const task = await taskOf('br-operadora-rejeitada-exemplo', day1);
    expect(task?.platformId).toBe(id);

    // limite de páginas da execução já atingido: a busca paga nem roda
    const idle = pagesSearch([`${SITE}/planos`]);
    const skipped = await new LineupResearcher({
      db,
      llm: idle,
      config,
      now: () => day1,
      pages: reader(0),
    }).researchFromPages(task!);
    expect([skipped.calls, idle.calls.length, skipped.note]).toEqual([
      0,
      0,
      'limite de páginas desta execução atingido; a busca das URLs de planos fica para a próxima',
    ]);

    // a busca roda, a URL achada dá 404: nada lido, e a revisita espera os 30 dias
    const llm = pagesSearch([`${SITE}/planos`]);
    const out = await new LineupResearcher({
      db,
      llm,
      config,
      now: () => day1,
      pages: reader(),
    }).researchFromPages(task!);
    expect([out.calls, out.pages.map((p) => p.status)]).toEqual([1, ['error']]);
    const day2 = new Date(day1.getTime() + 86_400_000);
    expect(await taskOf('br-operadora-rejeitada-exemplo', day2)).toBeUndefined();
  });

  it('URL achada pela busca e não lida só pelo limite de páginas fica guardada (a busca não se repete)', async () => {
    const SITE = 'https://limite.exemplo';
    const id = await withoutPages('Operadora Limite Exemplo', SITE);
    const day1 = new Date(NOW.getTime() + 40 * 86_400_000);
    const task = await taskOf('br-operadora-limite-exemplo', day1);
    const llm = pagesSearch([`${SITE}/planos`, `${SITE}/precos`]);
    const out = await new LineupResearcher({
      db,
      llm,
      config,
      now: () => day1,
      pages: reader(1),
    }).researchFromPages(task!);
    expect(out.pages.map((p) => [p.url, p.status, p.limited ?? false])).toEqual([
      [`${SITE}/planos`, 'error', false],
      [`${SITE}/precos`, 'error', true],
    ]);
    const [row] = await db.select().from(platform).where(eq(platform.id, id));
    expect(row!.planPages).toEqual([`${SITE}/precos`]);
    // não renova o seen_at: a página guardada é lida na próxima execução, sem nova busca
    expect(await taskOf('br-operadora-limite-exemplo', new Date(day1.getTime() + 86_400_000))).toBeDefined();
  });
});
