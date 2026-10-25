import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  llmUsage,
  participant,
  runMigrations,
  season,
  sport,
  stage,
  tenant,
  wtwResearch,
  wtwRun,
  type Database,
} from '@galaxie/db';
import {
  Blocklist,
  currentOptions,
  currentResearchedRights,
  getPublicWhereToWatch,
  parseCountryConfig,
  queueRerun,
  ResearchedRightsIndex,
  WtwConfig,
} from '@galaxie/where-to-watch';
import { BudgetedLlmClient, PgTokenBudgetStore, TokenBudget } from '../src/llm/budget.js';
import { LlmError } from '../src/llm/errors.js';
import { FakeLlmClient } from '../src/llm/fake.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { FakePageFetcher } from '../src/wtw/fetcher.js';
import { activeMarkets } from '../src/wtw/markets.js';
import type { WtwPolicy } from '../src/wtw/relevance.js';
import { planRightsResearch, RightsResearcher } from '../src/wtw/rights-runner.js';
import { WtwRunner } from '../src/wtw/runner.js';
import { enqueueRuns, planDueRuns } from '../src/wtw/scheduler.js';
import {
  finishResearch,
  marketSpendToday,
  researchBackoffMs,
  startResearch,
  WTW_RESEARCH_MAX_FAILURES,
} from '../src/wtw/spend.js';
import type { WtwAllocationOutput, WtwAssignment, WtwRightsOutput } from '../src/wtw/schema.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
const H = 3_600_000;
const KICKOFF = new Date('2026-11-04T23:00:00Z');

// ─── configuração genérica: dois mercados, emissoras fictícias ──────────────────────────────────
const sources = {
  organizers: ['organizador.example'],
  press: ['imprensa.example'],
  aggregators: ['guia.example'],
};
const rightsSource = 'https://organizador.example/direitos';
const br = parseCountryConfig(
  'BR',
  {
    country: 'BR',
    language: 'pt-BR',
    broadcasters: [
      {
        id: 'emissora_a',
        name: 'Emissora A',
        medium: 'free_tv',
        access_model: 'free',
        domains: ['emissora-a.example'],
      },
      {
        id: 'streaming_b',
        name: 'Streaming B',
        medium: 'streaming_svod',
        access_model: 'subscription',
        domains: ['streaming-b.example'],
      },
      {
        id: 'canal_c',
        name: 'Canal C',
        medium: 'pay_tv',
        access_model: 'subscription',
        domains: ['canal-c.example'],
      },
    ],
  },
  {
    country: 'BR',
    rights: [
      {
        competition: 'liga-dividida',
        season: 2026,
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
        distribution: 'split',
        holders: ['emissora_a', 'streaming_b'],
        sources: [rightsSource],
      },
      {
        competition: 'liga-exclusiva',
        season: 2026,
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
        distribution: 'exclusive',
        holders: ['canal_c'],
        sources: [rightsSource],
      },
    ],
  },
  sources,
);
const mx = parseCountryConfig(
  'MX',
  {
    country: 'MX',
    broadcasters: [
      {
        id: 'emissora_m',
        name: 'Emissora M',
        medium: 'free_tv',
        access_model: 'free',
        domains: ['emissora-m.example'],
      },
      {
        id: 'streaming_n',
        name: 'Streaming N',
        medium: 'streaming_svod',
        access_model: 'subscription',
        domains: ['streaming-n.example'],
      },
    ],
  },
  {
    country: 'MX',
    rights: [
      {
        competition: 'liga-dividida',
        season: 2026,
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
        distribution: 'split',
        holders: ['emissora_m', 'streaming_n'],
        sources: [rightsSource],
      },
    ],
  },
  sources,
);
const config = new WtwConfig([br, mx], new Blocklist([]));
const policy: WtwPolicy = { minRelevance: 60, dailyUsdPerMarket: 1 };

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

let seq = 0;
/** Rodada inteira de uma competição: N jogos com times do país e importância informada. */
async function seedRound(opts: {
  slug: string;
  round?: string;
  games?: number;
  importance?: number;
  startsAt?: Date;
  tier?: number;
}): Promise<string[]> {
  const [comp] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: opts.slug,
      name: opts.slug,
      type: 'league',
      tier: opts.tier ?? 1,
      countryCode: null,
    })
    .onConflictDoUpdate({ target: [competition.sport, competition.slug], set: { tier: opts.tier ?? 1 } })
    .returning();
  const [ssn] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026 })
    .onConflictDoUpdate({ target: [season.competitionId, season.year], set: { label: '2026' } })
    .returning();
  const [stg] = await db
    .insert(stage)
    .values({
      seasonId: ssn!.id,
      kind: 'regular',
      name: { 'pt-BR': 'Rodada' },
      providerLabel: opts.round ?? `Rodada ${++seq}`,
    })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < (opts.games ?? 3); i++) {
    const [home, away] = await db
      .insert(participant)
      .values([
        { sport: 'football', kind: 'club', name: `Time ${++seq}`, countryCode: null },
        { sport: 'football', kind: 'club', name: `Time ${++seq}`, countryCode: null },
      ])
      .returning();
    const startsAt = new Date((opts.startsAt ?? KICKOFF).getTime() + i * 2 * H);
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: comp!.id,
        seasonId: ssn!.id,
        stageId: stg!.id,
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 2 * H),
        importance: opts.importance ?? 70,
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: ev!.id, participantId: home!.id, side: 'home' },
      { eventId: ev!.id, participantId: away!.id, side: 'away' },
    ]);
    ids.push(ev!.id);
  }
  return ids;
}

const GRADE_BR = 'https://emissora-a.example/grade-da-rodada';
const GRADE_MX = 'https://emissora-m.example/programacion';
const PAGES: Record<string, string> = {
  // trechos do modelo nem sempre literais ("J2 na Streaming B" × "J2 no Streaming B"): ainda publicam
  [GRADE_BR]: '<p>Grade da rodada: J1 na Emissora A; J2 no Streaming B.</p>',
  [GRADE_MX]: '<p>Programación: J1 por Emissora M.</p>',
};

const assignment = (match: string, country: string, broadcaster: string, url: string): WtwAssignment => ({
  match,
  country,
  broadcaster,
  channel: null,
  region: null,
  watch_url: null,
  evidence: [{ url, excerpt: `${match} na ${broadcaster}`, published_at: null, stance: 'confirms' }],
});

/** Responde a alocação: só os países pedidos na mensagem. */
const allocationReply = (req: LlmJsonRequest): WtwAllocationOutput => {
  const msg = req.messages[0]!.content;
  const out: WtwAssignment[] = [];
  if (msg.includes('- BR (Brasil)')) {
    out.push(assignment('J1', 'BR', 'Emissora A', GRADE_BR), assignment('J2', 'BR', 'Streaming B', GRADE_BR));
  }
  if (msg.includes('- MX (México)')) out.push(assignment('J1', 'MX', 'Emissora M', GRADE_MX));
  return { assignments: out, notes: null };
};

function setup(
  now: Date,
  opts: { pages?: Record<string, string>; dailyLimit?: number | null; policy?: WtwPolicy } = {},
) {
  const fake = new FakeLlmClient((req: LlmJsonRequest) => ({
    data: allocationReply(req),
    usage: { inputTokens: 40_000, outputTokens: 3_000, webSearchCalls: 6, costUsd: 0.12 },
  }));
  const budget = new TokenBudget(
    new PgTokenBudgetStore(db),
    { dailyLimit: opts.dailyLimit ?? 10_000_000 },
    () => now,
  );
  const llm = new BudgetedLlmClient(fake, budget);
  const fetcher = new FakePageFetcher({ ...(opts.pages ?? PAGES) });
  const runner = new WtwRunner({ db, llm, config, fetcher, policy: opts.policy ?? policy, now: () => now });
  return { fake, fetcher, runner };
}

async function plan(now: Date, markets: string[], eventId?: string) {
  const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
  return planDueRuns(db, { now, markets, config, researched, ...(eventId ? { eventId } : {}) });
}

describe('mercados ativos', () => {
  it('união dos tenants com where_to_watch; WTW_MARKETS sobrescreve', async () => {
    expect(await activeMarkets(db, {})).toEqual([]);
    await db.insert(tenant).values([
      {
        slug: 'a',
        name: 'A',
        plan: 'fan_experience',
        modules: ['core_data', 'where_to_watch'],
        markets: ['br', 'AR'],
      },
      { slug: 'b', name: 'B', plan: 'core_data', modules: ['core_data'], markets: [] },
    ]);
    expect(await activeMarkets(db, {})).toEqual(['AR', 'BR']);
    expect(await activeMarkets(db, { WTW_MARKETS: 'mx, XX' })).toEqual(['MX']);
  });
});

describe('onde assistir por rodada', () => {
  it('T-7d: só a tabela de direitos (sem LLM) — exclusiva publica, dividida fica "a confirmar"', async () => {
    const [excl] = await seedRound({ slug: 'liga-exclusiva', games: 1 });
    const [split] = await seedRound({
      slug: 'liga-dividida',
      games: 1,
      startsAt: new Date(KICKOFF.getTime() + 24 * H),
    });
    const [none] = await seedRound({ slug: 'liga-sem-direitos', games: 1 });
    const now = new Date(KICKOFF.getTime() - 6 * 24 * H);
    const due = [
      ...(await plan(now, ['BR', 'MX'], excl)),
      ...(await plan(now, ['BR', 'MX'], split)),
      ...(await plan(now, ['BR', 'MX'], none)),
    ];
    // competição sem direitos não entra (fica para a pesquisa por temporada)
    expect(due.map((d) => [d.country, d.window, d.mode, d.rights.distribution])).toEqual([
      ['BR', 'T-7d', 'rights', 'exclusive'],
      ['BR', 'T-7d', 'rights', 'split'],
      ['MX', 'T-7d', 'rights', 'split'],
    ]);
    expect(await enqueueRuns(db, due, now)).toBe(3);
    expect(await enqueueRuns(db, due, now)).toBe(0);

    const { runner, fake } = setup(now);
    const out = await runner.runQueued({ limit: 50, maxCalls: 3 });
    expect(out.filter((o) => o.status === 'done')).toHaveLength(3);
    expect(fake.calls).toHaveLength(0);

    const pubExcl = await getPublicWhereToWatch(db, { eventId: excl!, country: 'BR' });
    expect(
      pubExcl!.options.map((o) => [o.row.broadcasterId, o.row.status, Number(o.row.confidence)]),
    ).toEqual([['canal_c', 'confirmed', 0.9]]);
    expect(pubExcl!.options[0]!.row.evidence[0]).toMatchObject({ url: rightsSource, sourceKind: 'rights' });
    const pubSplit = await getPublicWhereToWatch(db, { eventId: split!, country: 'BR' });
    expect(pubSplit).toMatchObject({ status: 'unknown', options: [] });
    expect(pubSplit!.toConfirm.map((o) => o.row.broadcasterId).sort()).toEqual(['emissora_a', 'streaming_b']);
  });

  it('T-48h: UMA chamada para a rodada inteira e os dois mercados; página buscada uma vez; custo rateado', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 3, round: 'Rodada 20' });
    const now = new Date(KICKOFF.getTime() - 40 * H);
    const due = await plan(now, ['BR', 'MX']);
    const mine = due.filter((d) => ids.includes(d.eventId));
    expect(mine).toHaveLength(6);
    expect(new Set(mine.map((d) => [d.window, d.mode, d.group].join(' ')))).toEqual(
      new Set(['T-48h allocate liga-dividida|Rodada 20']),
    );
    await enqueueRuns(db, mine, now);

    const { runner, fake, fetcher } = setup(now);
    const out = await runner.runQueued({ limit: 1, maxCalls: 1, eventId: ids[0]! });
    // uma execução reservada traz as irmãs da rodada (outros jogos e mercados)
    expect(out).toHaveLength(6);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call).toMatchObject({
      tier: 'research',
      webSearch: true,
      purpose: 'wtw:alloc:liga-dividida:Rodada_20',
    });
    expect(call.messages[0]!.content).toMatch(/J3:/);
    expect(call.allowedDomains).toEqual(expect.arrayContaining(['emissora-a.example', 'emissora-m.example']));
    expect(fetcher.requested.filter((u) => u === GRADE_BR)).toHaveLength(1);

    const pub1 = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' });
    expect(pub1!.options.map((o) => o.row.broadcasterId)).toEqual(['emissora_a']);
    expect(pub1!.toConfirm).toEqual([]);
    const pub2 = await getPublicWhereToWatch(db, { eventId: ids[1]!, country: 'BR' });
    expect(pub2!.options.map((o) => o.row.broadcasterId)).toEqual(['streaming_b']);
    const pub3 = await getPublicWhereToWatch(db, { eventId: ids[2]!, country: 'BR' });
    expect(pub3!.options).toEqual([]);
    expect(pub3!.toConfirm.map((o) => o.row.broadcasterId).sort()).toEqual(['emissora_a', 'streaming_b']);
    const mx1 = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'MX' });
    expect(mx1!.options.map((o) => o.row.broadcasterId)).toEqual(['emissora_m']);

    const [research] = await db.select().from(wtwResearch).where(eq(wtwResearch.kind, 'allocation'));
    expect(research).toMatchObject({
      status: 'done',
      markets: ['BR', 'MX'],
      inputTokens: 40_000,
      costUsd: '0.120000',
    });
    const runs = await db
      .select()
      .from(wtwRun)
      .where(and(eq(wtwRun.window, 'T-48h'), eq(wtwRun.status, 'done')));
    const shares = runs.filter((r) => ids.includes(r.eventId));
    expect(shares.every((r) => r.costUsd === '0.020000' && r.inputTokens === 6_667)).toBe(true);
    const usage = await db.select().from(llmUsage).where(eq(llmUsage.agent, 'wtw'));
    expect(usage).toHaveLength(1);
  });

  it('relevância abaixo do limiar: nenhuma chamada — detentores "a confirmar"', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 2, importance: 30 });
    const now = new Date(KICKOFF.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(now, ['BR'])).filter((d) => ids.includes(d.eventId)),
      now,
    );
    const { runner, fake } = setup(now);
    const out = await runner.runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(fake.calls).toHaveLength(0);
    expect(out[0]!.stats.allocation).toMatch(/relevância abaixo de 60/);
    const pub = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' });
    expect(pub!.toConfirm).toHaveLength(2);
  });

  it('teto diário por mercado: o mercado que estourou sai da chamada, o outro segue', async () => {
    // outro dia UTC (o gasto do BR não vaza para os demais testes)
    const now = new Date(KICKOFF.getTime() - 64 * H);
    await db.insert(wtwResearch).values({
      kind: 'allocation',
      researchKey: 'teste:gasto-br',
      competitionSlug: 'liga-dividida',
      markets: ['BR'],
      status: 'done',
      costUsd: '0.990000',
      createdAt: now,
    });
    const ids = await seedRound({
      slug: 'liga-dividida',
      games: 1,
      round: 'Rodada 30',
      startsAt: new Date(KICKOFF.getTime() - 24 * H),
    });
    await enqueueRuns(
      db,
      (await plan(now, ['BR', 'MX'])).filter((d) => ids.includes(d.eventId)),
      now,
    );
    const { runner, fake } = setup(now);
    const out = await runner.runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.messages[0]!.content).not.toMatch(/- BR \(Brasil\)/);
    expect(fake.calls[0]!.purpose).toMatch(/:MX$/);
    expect(out.find((o) => o.country === 'BR')!.stats.allocation).toMatch(/teto diário/);
  });

  it('teto diário por mercado vale a cada pedaço da rodada, não só no começo do grupo', async () => {
    // rodada de 13 jogos = 2 chamadas; a primeira já leva o BR para perto do teto (US$ 1)
    const startsAt = new Date(KICKOFF.getTime() + 3 * 24 * H);
    const now = new Date(startsAt.getTime() - 40 * H);
    const ids = await seedRound({ slug: 'liga-dividida', games: 13, round: 'Rodada 70', startsAt });
    await enqueueRuns(
      db,
      (await plan(now, ['BR'])).filter((d) => ids.includes(d.eventId)),
      now,
    );
    const fake = new FakeLlmClient(() => ({
      data: { assignments: [assignment('J1', 'BR', 'Emissora A', GRADE_BR)], notes: null },
      usage: { inputTokens: 40_000, outputTokens: 3_000, webSearchCalls: 6, costUsd: 0.9 },
    }));
    const runner = new WtwRunner({
      db,
      llm: fake,
      config,
      fetcher: new FakePageFetcher({ ...PAGES }),
      policy,
      now: () => now,
    });
    const out = await runner.runQueued({ limit: 50, maxCalls: 3, eventId: ids[0]! });
    expect(fake.calls).toHaveLength(1);
    expect(out).toHaveLength(13);
    const last = out.find((o) => o.eventId === ids[12])!;
    expect(last.stats.allocation).toMatch(/teto diário/);
    expect(out.find((o) => o.eventId === ids[0])!.stats.allocation).toMatch(/alocação por rodada/);
  });

  it('T-3h: revalida sem LLM; fonte que deixou de citar a emissora derruba a opção e volta o "a confirmar"', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 1, round: 'Rodada 40' });
    const t48 = new Date(KICKOFF.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(t48, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t48,
    );
    await setup(t48).runner.runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect((await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' }))!.options).toHaveLength(1);

    const t3 = new Date(KICKOFF.getTime() - 2.5 * H);
    const same = setup(t3);
    await enqueueRuns(
      db,
      (await plan(t3, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t3,
    );
    const [r1] = await same.runner.runQueued({ limit: 10, eventId: ids[0]! });
    expect(r1).toMatchObject({ window: 'T-3h', mode: 'revalidate', status: 'done' });
    expect(same.fake.calls).toHaveLength(0);
    expect(r1!.stats).toMatchObject({ inserted: 0 });

    const t30 = new Date(KICKOFF.getTime() - 20 * 60_000);
    const changed = setup(t30, { pages: { [GRADE_BR]: '<p>Grade em atualização.</p>' } });
    await enqueueRuns(
      db,
      (await plan(t30, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t30,
    );
    const [r2] = await changed.runner.runQueued({ limit: 10, eventId: ids[0]! });
    expect(r2).toMatchObject({ window: 'T-30min', mode: 'revalidate', status: 'done' });
    expect(changed.fake.calls).toHaveLength(0);
    const pub = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' });
    expect(pub!.options).toEqual([]);
    expect(pub!.toConfirm.map((o) => o.row.broadcasterId).sort()).toEqual(['emissora_a', 'streaming_b']);
  });

  it('T-3h: o jogo trocou de canal na agenda compacta: a fonte que tinha o jogo cai para 0,4', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 2, round: 'Rodada 42' });
    const names = async (id: string) =>
      (
        await db
          .select({ name: participant.name, side: eventParticipant.side })
          .from(eventParticipant)
          .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
          .where(eq(eventParticipant.eventId, id))
      )
        .sort((a, b) => (a.side === 'home' ? -1 : b.side === 'home' ? 1 : 0))
        .map((r) => r.name);
    const [h1, a1] = await names(ids[0]!);
    const [h2, a2] = await names(ids[1]!);
    const AGENDA = 'https://emissora-a.example/agenda-compacta';
    const t48 = new Date(KICKOFF.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(t48, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t48,
    );
    const fake = new FakeLlmClient(() => ({
      data: {
        // paráfrase do modelo: vale pela proximidade dos times com a emissora na página
        assignments: [
          {
            ...assignment('J1', 'BR', 'Emissora A', AGENDA),
            evidence: [
              {
                url: AGENDA,
                excerpt: `A Emissora A mostra ${h1} contra ${a1} no sábado`,
                published_at: null,
                stance: 'confirms' as const,
              },
            ],
          },
        ],
        notes: null,
      },
      usage: { inputTokens: 1_000, outputTokens: 100, costUsd: 0.01 },
    }));
    const runner = (now: Date, page: string) =>
      new WtwRunner({
        db,
        llm: fake,
        config,
        fetcher: new FakePageFetcher({ [AGENDA]: page }),
        policy,
        now: () => now,
      });
    await runner(t48, `<p>${h1} x ${a1}, 16h, Emissora A. ${h2} x ${a2}, 18h30, Streaming B.</p>`).runQueued({
      limit: 10,
      maxCalls: 3,
      eventId: ids[0]!,
    });
    const before = (await currentOptions(db, ids[0]!, 'BR')).find((o) => o.broadcasterId === 'emissora_a')!;
    expect(before.status).toBe('confirmed');
    expect(before.evidence.find((e) => e.url === AGENDA)?.excerptVerified).toBe(true);

    // T-3h: o jogo 1 passou para o Streaming B; a Emissora A segue na página, no jogo vizinho
    const t3 = new Date(KICKOFF.getTime() - 2.5 * H);
    await enqueueRuns(
      db,
      (await plan(t3, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t3,
    );
    await runner(t3, `<p>${h1} x ${a1}, 16h, Streaming B. ${h2} x ${a2}, 18h30, Emissora A.</p>`).runQueued({
      limit: 10,
      eventId: ids[0]!,
    });
    const pub = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' });
    expect(pub!.options.map((o) => o.row.broadcasterId)).not.toContain('emissora_a');
    const after = (await currentOptions(db, ids[0]!, 'BR')).find((o) => o.broadcasterId === 'emissora_a')!;
    // a fonte cai para 0,4 e a opção volta ao piso "a confirmar" dos direitos; a marca continua
    expect(after).toMatchObject({ status: 'probable', flags: ['to_confirm'] });
    expect(after.evidence.find((e) => e.url === AGENDA)).toMatchObject({ excerptVerified: true });
  });

  it('T-3h: página da emissora que ainda a cita, mas sem o trecho do jogo, não sustenta mais a opção', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 1, round: 'Rodada 41' });
    const t48 = new Date(KICKOFF.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(t48, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t48,
    );
    await setup(t48).runner.runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(
      (await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' }))!.options.map(
        (o) => o.row.broadcasterId,
      ),
    ).toEqual(['emissora_a']);

    // a grade mudou: o J1 passou para o Streaming B, mas a página segue citando a Emissora A
    const t3 = new Date(KICKOFF.getTime() - 2.5 * H);
    const moved = setup(t3, {
      pages: { [GRADE_BR]: '<p>Grade da rodada: J1 no Streaming B; J2 na Emissora A.</p>' },
    });
    await enqueueRuns(
      db,
      (await plan(t3, ['BR'])).filter((d) => ids.includes(d.eventId)),
      t3,
    );
    const [r] = await moved.runner.runQueued({ limit: 10, eventId: ids[0]! });
    expect(r).toMatchObject({ window: 'T-3h', mode: 'revalidate', status: 'done' });
    expect(moved.fake.calls).toHaveLength(0);
    const pub = await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' });
    expect(pub!.options).toEqual([]);
    expect(pub!.toConfirm.map((o) => o.row.broadcasterId).sort()).toEqual(['emissora_a', 'streaming_b']);
  });

  it('orçamento global esgotado: alocação adiada sem chamar o provedor; os direitos saem e a execução volta para a fila', async () => {
    const ids = await seedRound({ slug: 'liga-dividida', games: 1, round: 'Rodada 50' });
    const now = new Date(KICKOFF.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(now, ['BR'])).filter((d) => ids.includes(d.eventId)),
      now,
    );
    const { runner, fake } = setup(now, { dailyLimit: 10 });
    const [o] = await runner.runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(o).toMatchObject({ status: 'done' });
    expect(o!.stats.allocation).toMatch(/alocação falhou: Orçamento diário/);
    expect(fake.calls).toHaveLength(0);
    expect((await currentOptions(db, ids[0]!, 'BR')).every((r) => r.status === 'probable')).toBe(true);
    // sem orçamento a rodada não fecha como "feita": volta para a fila e é alocada quando houver orçamento
    const [row] = await db.select().from(wtwRun).where(eq(wtwRun.eventId, ids[0]!));
    expect(row?.status).toBe('queued');
  });

  it('reexecução manual: alocação só daquele jogo; evento já iniciado é pulado', async () => {
    const [id] = await seedRound({ slug: 'liga-dividida', games: 1, round: 'Rodada 60' });
    const now = new Date(KICKOFF.getTime() - 5 * 24 * H);
    const { runner, fake } = setup(now);
    const { runId } = await queueRerun(db, {
      eventId: id!,
      country: 'BR',
      actor: 'editor.ana',
      reason: 'teste',
      now,
    });
    const [o] = await runner.runQueued({ limit: 5, eventId: id! });
    expect(o).toMatchObject({ runId, mode: 'full', status: 'done' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.purpose).toMatch(/:BR$/);

    const [old] = await seedRound({
      slug: 'liga-dividida',
      games: 1,
      startsAt: new Date('2026-10-01T00:00:00Z'),
    });
    const later = new Date('2026-10-02T00:00:00Z');
    const s2 = setup(later);
    await queueRerun(db, { eventId: old!, country: 'BR', actor: 'editor.ana', reason: 'teste', now: later });
    const [skipped] = await s2.runner.runQueued({ limit: 5, eventId: old! });
    expect(skipped).toMatchObject({ status: 'skipped' });
    expect(s2.fake.calls).toHaveLength(0);
  });
});

describe('pesquisas retentadas: custo, espera e limite de falhas', () => {
  const MIN = 60_000;
  const start = (key: string, now: Date) =>
    startResearch(db, { kind: 'allocation', researchKey: key, competition: 'x', markets: ['XX'], now });

  it('a retentativa conta no dia dela e soma o custo das tentativas anteriores', async () => {
    const t0 = new Date('2026-12-01T10:00:00Z');
    const first = await start('teste:retentativa', t0);
    expect(first).toMatchObject({ failures: 0 });
    await finishResearch(db, first.id!, {
      status: 'failed',
      usage: { inputTokens: 1_000, outputTokens: 100, costUsd: 0.05 },
      error: 'provedor fora',
      now: t0,
    });
    // ainda na espera depois da 1ª falha (30 min)
    expect(await start('teste:retentativa', new Date(t0.getTime() + 10 * MIN))).toMatchObject({
      id: null,
      reason: 'backoff',
      retryAt: new Date(t0.getTime() + 30 * MIN),
    });
    // dia seguinte (UTC): a nova tentativa passa a contar no dia dela, com o custo da anterior somado
    const t1 = new Date('2026-12-02T09:00:00Z');
    const again = await start('teste:retentativa', t1);
    expect(again).toEqual({ id: first.id, failures: 0 });
    await finishResearch(db, again.id!, {
      status: 'done',
      usage: { inputTokens: 2_000, outputTokens: 200, costUsd: 0.1 },
      now: t1,
    });
    const [row] = await db.select().from(wtwResearch).where(eq(wtwResearch.id, first.id!));
    expect(row).toMatchObject({
      status: 'done',
      costUsd: '0.150000',
      inputTokens: 3_000,
      outputTokens: 300,
      createdAt: t1,
    });
    expect((await marketSpendToday(db, t1)).get('XX')).toBeCloseTo(0.15);
    expect((await marketSpendToday(db, t0)).get('XX')).toBeUndefined();
    expect(await start('teste:retentativa', t1)).toEqual({ id: null, reason: 'done' });
  });

  it('desiste depois de 3 falhas no dia; volta a tentar no dia seguinte', async () => {
    let now = new Date('2026-12-03T08:00:00Z');
    for (let i = 0; i < WTW_RESEARCH_MAX_FAILURES; i++) {
      const s = await start('teste:desiste', now);
      expect(s, `tentativa ${i + 1}`).toMatchObject({ failures: i });
      await finishResearch(db, s.id!, { status: 'failed', error: 'timeout', now });
      now = new Date(now.getTime() + researchBackoffMs(i + 1));
    }
    expect(await start('teste:desiste', now)).toEqual({ id: null, reason: 'exhausted' });
    expect(await start('teste:desiste', new Date('2026-12-04T08:00:00Z'))).toMatchObject({ failures: 0 });
  });

  it('as falhas contam na família da pesquisa: trocar os mercados da chave não reinicia o limite', async () => {
    let now = new Date('2026-12-05T08:00:00Z');
    const fam = (key: string) =>
      startResearch(db, {
        kind: 'allocation',
        researchKey: `teste:fam:${key}`,
        family: 'teste:fam:',
        competition: 'x',
        markets: ['XX'],
        now,
      });
    for (const [i, key] of ['BR,MX', 'BR', 'MX'].entries()) {
      const s = await fam(key);
      expect(s, key).toMatchObject({ failures: i });
      await finishResearch(db, s.id!, { status: 'failed', error: 'provedor fora', now });
      // ainda na espera, nem outra chave da família chama
      expect(await fam('outra')).toMatchObject({ id: null, reason: i < 2 ? 'backoff' : 'exhausted' });
      now = new Date(now.getTime() + researchBackoffMs(i + 1));
    }
    expect(await fam('outra')).toEqual({ id: null, reason: 'exhausted' });
  });

  it('alocação com o provedor fora: espera entre as rodadas do agendador e desiste no limite do dia', async () => {
    const startsAt = new Date(KICKOFF.getTime() + 6 * 24 * H);
    const ids = await seedRound({ slug: 'liga-dividida', games: 1, round: 'Rodada 80', startsAt });
    let now = new Date(startsAt.getTime() - 40 * H);
    await enqueueRuns(
      db,
      (await plan(now, ['BR'])).filter((d) => ids.includes(d.eventId)),
      now,
    );
    const fake = new FakeLlmClient(() => new LlmError('provedor fora do ar', 'provider', true));
    const runner = () =>
      new WtwRunner({
        db,
        llm: fake,
        config,
        fetcher: new FakePageFetcher({ ...PAGES }),
        policy,
        now: () => now,
      });
    const runRow = async () => (await db.select().from(wtwRun).where(eq(wtwRun.eventId, ids[0]!)))[0]!;

    const [o1] = await runner().runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(o1!.stats.allocation).toMatch(/alocação falhou: provedor fora/);
    expect(fake.calls).toHaveLength(1);
    expect(await runRow()).toMatchObject({
      status: 'queued',
      scheduledFor: new Date(now.getTime() + 30 * 60_000),
    });

    // antes da espera, nada é reservado (nenhuma chamada)
    now = new Date(now.getTime() + 10 * 60_000);
    expect(await runner().runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! })).toEqual([]);
    expect(fake.calls).toHaveLength(1);

    // 2ª e 3ª tentativas, cada uma depois da sua espera; na 3ª falha desiste no dia (fecha com os direitos)
    now = new Date(now.getTime() + 21 * 60_000);
    await runner().runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(fake.calls).toHaveLength(2);
    now = (await runRow()).scheduledFor;
    await runner().runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! });
    expect(fake.calls).toHaveLength(3);
    expect(await runRow()).toMatchObject({ status: 'done' });
    now = new Date(now.getTime() + 6 * H);
    expect(await runner().runQueued({ limit: 10, maxCalls: 3, eventId: ids[0]! })).toEqual([]);
    expect(fake.calls).toHaveLength(3);
  });
});

describe('direitos por temporada (nível 1)', () => {
  it('liga curada no próprio país ainda é pesquisada nos vizinhos; liga sem audiência fica de fora', async () => {
    // slugs reais: a audiência vem de config/geo/market-audience.yaml (liga-mx = 35 no México)
    await seedRound({ slug: 'liga-mx', games: 2, importance: 30 });
    await seedRound({ slug: 'eredivisie', games: 2, importance: 30 });
    const mxCurated = parseCountryConfig(
      'MX',
      {
        country: 'MX',
        broadcasters: [
          {
            id: 'emissora_m',
            name: 'Emissora M',
            medium: 'free_tv',
            access_model: 'free',
            domains: ['emissora-m.example'],
          },
        ],
      },
      {
        country: 'MX',
        rights: [
          {
            competition: 'liga-mx',
            season: 2026,
            valid_from: '2026-01-01',
            valid_to: '2026-12-31',
            distribution: 'split',
            holders: ['emissora_m'],
            sources: [rightsSource],
          },
        ],
      },
      sources,
    );
    const cfg = new WtwConfig([br, mxCurated], new Blocklist([]));
    const now = new Date(KICKOFF.getTime() - 10 * 24 * H);
    const needs = await planRightsResearch(db, { now, config: cfg, minRelevance: 60 });
    // 30 de importância + 35 de audiência no México passa do limiar; a chamada cobre só quem não tem direitos
    expect(needs.find((n) => n.competition.slug === 'liga-mx')).toMatchObject({
      chunks: [['BR']],
      maxRelevance: 65,
    });
    // Eredivisie: sem audiência em nenhum mercado, fica abaixo do limiar (30) e não gasta pesquisa
    expect(needs.find((n) => n.competition.slug === 'eredivisie')).toBeUndefined();
    // --pais BR: a audiência no México não conta (a liga não importa no mercado pedido)
    const onlyBr = await planRightsResearch(db, { now, config: cfg, markets: ['BR'], minRelevance: 60 });
    expect(onlyBr.find((n) => n.competition.slug === 'liga-mx')).toBeUndefined();
  });

  it('uma chamada cobre os mercados sem direitos; validador confere cada detentor; o resultado alimenta a agenda', async () => {
    const [id] = await seedRound({ slug: 'liga-nova', games: 1, importance: 80 });
    const now = new Date(KICKOFF.getTime() - 10 * 24 * H);
    const needs = await planRightsResearch(db, { now, config, minRelevance: 60 });
    const need = needs.find((n) => n.competition.slug === 'liga-nova')!;
    expect(need.chunks).toEqual([['BR', 'MX']]);

    const reply: WtwRightsOutput = {
      markets: [
        {
          country: 'BR',
          distribution: 'exclusive',
          notes: null,
          holders: [
            {
              broadcaster: 'Streaming B',
              channels: [],
              kind: 'streaming',
              all_matches: true,
              evidence: [
                {
                  url: 'https://streaming-b.example/liga-nova',
                  excerpt: 'Streaming B terá a Liga Nova',
                  published_at: null,
                  stance: 'confirms',
                },
              ],
            },
          ],
        },
        {
          country: 'MX',
          distribution: 'exclusive',
          notes: null,
          holders: [
            {
              // URL inventada: não responde → detentor descartado → nada utilizável no MX
              broadcaster: 'Emissora M',
              channels: [],
              kind: 'free_tv',
              all_matches: true,
              evidence: [
                {
                  url: 'https://emissora-m.example/nao-existe',
                  excerpt: 'x',
                  published_at: null,
                  stance: 'confirms',
                },
              ],
            },
          ],
        },
      ],
      notes: null,
    };
    const fake = new FakeLlmClient([
      { data: reply, usage: { inputTokens: 80_000, outputTokens: 5_000, costUsd: 0.3 } },
    ]);
    const fetcher = new FakePageFetcher({
      'https://streaming-b.example/liga-nova': '<p>O Streaming B terá a Liga Nova.</p>',
    });
    const researcher = new RightsResearcher({ db, llm: fake, config, fetcher, policy, now: () => now });
    const out = await researcher.run([need], { maxCalls: 2 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ purpose: 'wtw:rights:liga-nova:2026', webSearch: true });
    expect(out[0]).toMatchObject({ status: 'done', markets: ['BR', 'MX'], costUsd: 0.3 });
    expect(out[0]!.byCountry).toMatchObject({
      BR: { status: 'confirmed', distribution: 'exclusive', holders: ['streaming_b'] },
      MX: { status: 'pending', distribution: 'to_confirm', holders: [] },
    });
    // idempotente no mês: não pesquisa de novo
    expect(await researcher.run([need], { maxCalls: 2 })).toEqual([]);
    expect(
      (await planRightsResearch(db, { now, config, minRelevance: 60 })).find(
        (n) => n.competition.slug === 'liga-nova',
      ),
    ).toBeUndefined();

    // a agenda passa a usar os direitos pesquisados: exclusivo → publica sem LLM
    const t7 = new Date(KICKOFF.getTime() - 6 * 24 * H);
    const due = await plan(t7, ['BR', 'MX'], id);
    expect(due.map((d) => [d.country, d.mode, d.rights.origin])).toEqual([['BR', 'rights', 'research']]);
    await enqueueRuns(db, due, t7);
    const s = setup(t7);
    await s.runner.runQueued({ limit: 5, eventId: id! });
    const pub = await getPublicWhereToWatch(db, { eventId: id!, country: 'BR' });
    // pesquisa validada com fonte da própria emissora (0,9) + detentor (0,1)
    expect(pub!.options.map((o) => [o.row.broadcasterId, Number(o.row.confidence)])).toEqual([
      ['streaming_b', 1],
    ]);

    // reconfirmação mensal sem tokens: a fonte sumiu → nova versão pendente, volta para a fila
    const month = new Date(now.getTime() + 31 * 24 * H);
    const later = new RightsResearcher({
      db,
      llm: fake,
      config,
      fetcher: new FakePageFetcher({}),
      policy,
      now: () => month,
    });
    expect(await later.revalidate()).toMatchObject({ checked: 2, touched: 0, changed: 1 });
    expect(fake.calls).toHaveLength(1);
    const rows = await currentResearchedRights(db, { competitions: ['liga-nova'], countries: ['BR'] });
    expect(rows[0]).toMatchObject({ status: 'pending', flags: ['source_changed'] });
  });
});
