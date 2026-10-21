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
  sport,
  tenant,
  wtwRun,
  type Database,
} from '@galaxie/db';
import { currentOptions, getPublicWhereToWatch, loadWtwConfig, queueRerun } from '@galaxie/where-to-watch';
import { BudgetedLlmClient, PgTokenBudgetStore, TokenBudget } from '../src/llm/budget.js';
import { FakeLlmClient } from '../src/llm/fake.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { FakePageFetcher } from '../src/wtw/fetcher.js';
import { activeMarkets } from '../src/wtw/markets.js';
import { WtwRunner } from '../src/wtw/runner.js';
import { enqueueRuns, planDueRuns } from '../src/wtw/scheduler.js';
import type { WtwOutput } from '../src/wtw/schema.js';

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
const config = loadWtwConfig({ env: {} });
const H = 3_600_000;
const KICKOFF = new Date('2026-10-28T00:30:00Z');

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

async function seed(opts: { tier: number; slug: string; countryCode: string | null; startsAt?: Date }) {
  const [comp] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: opts.slug,
      name: opts.slug,
      type: 'cup',
      tier: opts.tier,
      countryCode: null,
    })
    .onConflictDoUpdate({ target: [competition.sport, competition.slug], set: { tier: opts.tier } })
    .returning();
  const [home, away] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras' },
      { sport: 'football', kind: 'club', name: 'Fluminense' },
    ])
    .returning();
  const startsAt = opts.startsAt ?? KICKOFF;
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 2 * H),
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: home!.id, side: 'home' },
    { eventId: ev!.id, participantId: away!.id, side: 'away' },
  ]);
  return ev!.id;
}

const PAGES = {
  'https://ge.globo.com/agenda/libertadores':
    '<p>Palmeiras x Fluminense terá transmissão da TV Globo e do sportv.</p>',
  'https://www.espn.com.br/futebol/agenda':
    '<p>ESPN e Disney+ transmitem Palmeiras x Fluminense ao vivo.</p>',
};

const llmReply = (): WtwOutput => ({
  options: [
    {
      broadcaster: 'TV Globo',
      channel: null,
      medium: 'free_tv',
      access_model: 'free',
      region: null,
      watch_url: null,
      evidence: [
        {
          url: 'https://ge.globo.com/agenda/libertadores',
          excerpt: 'Palmeiras x Fluminense terá transmissão da TV Globo',
          published_at: null,
          stance: 'confirms',
        },
      ],
    },
    {
      broadcaster: 'Disney Plus',
      channel: null,
      medium: 'streaming_svod',
      access_model: 'subscription',
      region: null,
      watch_url: 'https://www.disneyplus.com/pt-br',
      evidence: [
        {
          url: 'https://www.espn.com.br/futebol/agenda',
          excerpt: 'ESPN e Disney+ transmitem Palmeiras x Fluminense ao vivo',
          published_at: null,
          stance: 'confirms',
        },
      ],
    },
    {
      // URL inventada: não responde → descartada pelo validador
      broadcaster: 'SBT',
      channel: null,
      medium: 'free_tv',
      access_model: 'free',
      region: null,
      watch_url: null,
      evidence: [
        {
          url: 'https://www.sbt.com.br/nao-existe',
          excerpt: 'SBT exibe',
          published_at: null,
          stance: 'confirms',
        },
      ],
    },
  ],
  notes: null,
});

function setup(
  now: Date,
  pages: Record<string, string | number> = { ...PAGES },
  dailyLimit: number | null = 1_000_000,
) {
  const fake = new FakeLlmClient((_req: LlmJsonRequest) => ({
    data: llmReply(),
    usage: { inputTokens: 12_000, outputTokens: 800, webSearchCalls: 3 },
  }));
  const budget = new TokenBudget(new PgTokenBudgetStore(db), { dailyLimit }, () => now);
  const llm = new BudgetedLlmClient(fake, budget);
  const fetcher = new FakePageFetcher(pages);
  const runner = new WtwRunner({ db, llm, config, fetcher, now: () => now });
  return { fake, llm, fetcher, runner };
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

describe('agendamento + execução do onde assistir', () => {
  it('T-7d: tier 1 entra (só mercados relevantes), tier 2 não; idempotente', async () => {
    const t1 = await seed({ tier: 1, slug: 'conmebol-libertadores', countryCode: null });
    const t2 = await seed({ tier: 2, slug: 'brasileirao-serie-b', countryCode: null });
    const now = new Date(KICKOFF.getTime() - 6 * 24 * H);
    const due = await planDueRuns(db, { now, markets: ['BR', 'MX'], config, eventId: t1 });
    expect(due.map((d) => [d.country, d.window, d.mode])).toEqual([
      ['BR', 'T-7d', 'full'],
      ['MX', 'T-7d', 'full'],
    ]);
    expect(await planDueRuns(db, { now, markets: ['BR'], config, eventId: t2 })).toEqual([]);
    expect(await enqueueRuns(db, due, now)).toBe(2);
    expect(await enqueueRuns(db, due, now)).toBe(0);
    expect(await planDueRuns(db, { now, markets: ['BR', 'MX'], config, eventId: t1 })).toEqual([]);
  });

  it('busca completa: LLM + verificação HTTP + validador → publica com evidência e registra uso', async () => {
    const eventId = await seed({ tier: 1, slug: 'conmebol-libertadores', countryCode: null });
    const now = new Date(KICKOFF.getTime() - 20 * H);
    const { fake, runner, fetcher } = setup(now);
    await enqueueRuns(db, await planDueRuns(db, { now, markets: ['BR'], config, eventId }), now);
    const [outcome] = await runner.runQueued({ limit: 5, eventId });
    expect(outcome).toMatchObject({ status: 'done', mode: 'full', window: 'T-24h' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      tier: 'research',
      webSearch: true,
      purpose: `wtw:event:${eventId}:BR`,
    });
    expect(fetcher.requested).toContain('https://www.sbt.com.br/nao-existe');

    const pub = await getPublicWhereToWatch(db, { eventId, country: 'BR' });
    expect(pub!.status).toBe('resolved');
    // Disney+ sustentado por espn.com.br: mesmo grupo de mídia → fonte primária (0,9) + direitos (0,1)
    expect(pub!.options.map((o) => [o.row.broadcasterId, Number(o.row.confidence)])).toEqual([
      ['globo', 1],
      ['disney_plus', 1],
    ]);
    expect(outcome!.stats).toMatchObject({ discarded: { no_accessible_evidence: 1 }, publicChanged: true });

    const [run] = await db.select().from(wtwRun).where(eq(wtwRun.id, outcome!.runId));
    expect(run).toMatchObject({ status: 'done', inputTokens: 12_000, outputTokens: 800, provider: 'fake' });
    const usage = await db.select().from(llmUsage).where(eq(llmUsage.agent, 'wtw'));
    expect(usage.at(-1)).toMatchObject({ outcome: 'ok', inputTokens: 12_000, webSearches: 3 });
  });

  it('T-3h: revalida sem LLM quando nada mudou; escala para busca completa quando a fonte muda', async () => {
    const eventId = await seed({ tier: 1, slug: 'conmebol-libertadores', countryCode: null });
    const t24 = new Date(KICKOFF.getTime() - 20 * H);
    const first = setup(t24);
    await enqueueRuns(db, await planDueRuns(db, { now: t24, markets: ['BR'], config, eventId }), t24);
    await first.runner.runQueued({ limit: 5, eventId });

    const t3 = new Date(KICKOFF.getTime() - 2.5 * H);
    const same = setup(t3);
    await enqueueRuns(db, await planDueRuns(db, { now: t3, markets: ['BR'], config, eventId }), t3);
    const [r1] = await same.runner.runQueued({ limit: 5, eventId });
    expect(r1).toMatchObject({ window: 'T-3h', status: 'done', mode: 'revalidate' });
    expect(same.fake.calls).toHaveLength(0); // zero tokens
    const opts = await currentOptions(db, eventId, 'BR');
    expect(
      opts.filter((o) => o.status === 'confirmed').every((o) => o.lastVerifiedAt.getTime() === t3.getTime()),
    ).toBe(true);

    // T-30min: a página da Globo mudou e não cita mais a emissora → busca completa
    const t30 = new Date(KICKOFF.getTime() - 20 * 60_000);
    const changed = setup(t30, {
      ...PAGES,
      'https://ge.globo.com/agenda/libertadores': '<p>Jogo adiado? Confira a agenda.</p>',
    });
    await enqueueRuns(db, await planDueRuns(db, { now: t30, markets: ['BR'], config, eventId }), t30);
    const [r2] = await changed.runner.runQueued({ limit: 5, eventId });
    expect(r2).toMatchObject({ window: 'T-30min', status: 'done', mode: 'full' });
    expect(r2!.stats.escalated).toBe('mudança nas fontes salvas');
    expect(changed.fake.calls).toHaveLength(1);
    // a página não menciona mais a Globo → evidência rebaixada → pending (sai da API)
    const pub = await getPublicWhereToWatch(db, { eventId, country: 'BR' });
    expect(pub!.options.map((o) => o.row.broadcasterId)).toEqual(['disney_plus']);
  });

  it('orçamento esgotado → execução `skipped`, sem chamar o provedor; reexecução manual entra na fila', async () => {
    const eventId = await seed({ tier: 1, slug: 'conmebol-libertadores', countryCode: null });
    const now = new Date(KICKOFF.getTime() - 20 * H);
    const { fake, runner } = setup(now, { ...PAGES }, 10);
    const { runId } = await queueRerun(db, {
      eventId,
      country: 'BR',
      actor: 'editor.ana',
      reason: 'teste',
      now,
    });
    const [outcome] = await runner.runQueued({ limit: 5, eventId });
    expect(outcome).toMatchObject({ runId, status: 'skipped' });
    expect(outcome!.error).toMatch(/Orçamento diário/);
    expect(fake.calls).toHaveLength(0);
  });

  it('evento já iniciado é pulado', async () => {
    const eventId = await seed({
      tier: 1,
      slug: 'conmebol-libertadores',
      countryCode: null,
      startsAt: new Date('2026-10-01T00:00:00Z'),
    });
    const now = new Date('2026-10-02T00:00:00Z');
    const { runner, fake } = setup(now);
    await queueRerun(db, { eventId, country: 'BR', actor: 'editor.ana', reason: 'teste', now });
    const [outcome] = await runner.runQueued({ limit: 5, eventId });
    expect(outcome).toMatchObject({ status: 'skipped' });
    expect(fake.calls).toHaveLength(0);
    const runs = await db
      .select()
      .from(wtwRun)
      .where(and(eq(wtwRun.eventId, eventId), eq(wtwRun.status, 'skipped')));
    expect(runs).toHaveLength(1);
  });
});
