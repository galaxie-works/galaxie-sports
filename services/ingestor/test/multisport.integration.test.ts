import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  closeDb,
  competition,
  country,
  createDb,
  games,
  gamesCompetition,
  medal,
  medalReference,
  medalTableSnapshot,
  msEvent,
  msParticipant,
  msPerson,
  noc,
  providerMap,
  runMigrations,
  season,
  sourceRef,
  sport,
  teamMember,
  type Database,
} from '@galaxie/db';
import { linkGamesCompetitions } from '../src/multisport/competition-link.js';
import { deriveMedalTable } from '../src/multisport/medal-table.js';
import {
  medalHistoryByNoc,
  medalTableForGames,
  refreshMedalTableSnapshot,
} from '../src/multisport/medal-store.js';
import { coverageByEdition, seedWikipediaReferences } from '../src/multisport/qa/report.js';
import { seedMultisport } from '../src/multisport/seed.js';
import {
  BRONZE,
  date,
  FINAL,
  GOLD,
  lit,
  response,
  SEMI,
  SILVER,
  statementRow,
  uri,
  type StatementSpec,
} from '../src/multisport/wikidata/fixtures.js';
import { WikidataMedalLoader } from '../src/multisport/wikidata/loader.js';
import { PgSparqlCache, SparqlClient } from '../src/multisport/wikidata/sparql-client.js';
import type { SparqlBinding } from '../src/multisport/wikidata/sparql-client.js';

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

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  await seedMultisport(db, '2026-10-21');
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function gamesId(slug: string): Promise<string> {
  const [g] = await db.select({ id: games.id }).from(games).where(eq(games.slug, slug));
  return g!.id;
}

describe('seed', () => {
  it('é idempotente e grava CONs, edições e status', async () => {
    await seedMultisport(db, '2026-10-21');
    const nocs = await db.select().from(noc);
    expect(nocs.filter((n) => n.iocMember)).toHaveLength(206);
    expect(nocs.find((n) => n.code === 'CHI')).toMatchObject({ iso3: 'CHL', iso2: 'CL', panamMember: true });
    const [lima] = await db.select().from(games).where(eq(games.slug, 'pan-2027'));
    expect(lima).toMatchObject({ status: 'upcoming', startDate: '2027-07-23', endDate: '2027-08-08' });
    const [milano] = await db.select().from(games).where(eq(games.slug, 'og-winter-2026'));
    expect(milano!.status).toBe('completed');
  });
});

describe('quadro de medalhas derivado (view + snapshot)', () => {
  it('conta dois bronzes, empates e ignora revogadas — igual à derivação em TypeScript', async () => {
    const gid = await gamesId('og-summer-2024');
    const [judo, swim] = await db
      .insert(msEvent)
      .values([
        { gamesId: gid, disciplineCode: 'JUD', gender: 'W', name: { en: "women's 57 kg" } },
        { gamesId: gid, disciplineCode: 'SWM', gender: 'M', name: { en: "men's 100 m freestyle" } },
      ])
      .returning();
    const nocs = ['BRA', 'MGL', 'JPN', 'POR', 'USA', 'CAN', 'RUS'];
    const parts = await db
      .insert(msParticipant)
      .values(nocs.map((n) => ({ kind: 'athlete' as const, nocCode: n, externalKey: `test:${n}` })))
      .returning();
    const pid = new Map(parts.map((p) => [p.nocCode, p.id]));
    const rows = [
      { e: judo!.id, n: 'BRA', m: 'G' as const },
      { e: judo!.id, n: 'MGL', m: 'S' as const },
      { e: judo!.id, n: 'JPN', m: 'B' as const },
      { e: judo!.id, n: 'POR', m: 'B' as const },
      { e: swim!.id, n: 'USA', m: 'G' as const },
      { e: swim!.id, n: 'CAN', m: 'G' as const },
      { e: swim!.id, n: 'RUS', m: 'B' as const, revoked: true },
      { e: swim!.id, n: 'BRA', m: 'B' as const },
    ];
    await db.insert(medal).values(
      rows.map((r, i) => ({
        eventId: r.e,
        participantId: pid.get(r.n)!,
        nocCode: r.n,
        medal: r.m,
        source: 'editorial',
        sourceKey: `test:${i}`,
        revokedAt: r.revoked ? new Date('2025-01-01') : null,
        revokedReason: r.revoked ? 'doping' : null,
      })),
    );

    const table = await medalTableForGames(db, 'og-summer-2024');
    const expected = deriveMedalTable(
      rows.map((r) => ({ nocCode: r.n, medal: r.m, revokedAt: r.revoked ? 'x' : null })),
    );
    expect(table).toEqual(expected);
    expect(table.find((r) => r.nocCode === 'BRA')).toMatchObject({
      gold: 1,
      bronze: 1,
      total: 2,
      rankByGold: 1,
    });
    expect(table.find((r) => r.nocCode === 'RUS')).toBeUndefined();
    expect(table.reduce((s, r) => s + r.bronze, 0)).toBe(3);

    const byTotal = await medalTableForGames(db, 'og-summer-2024', 'total');
    expect(byTotal[0]!.nocCode).toBe('BRA');

    expect(await refreshMedalTableSnapshot(db, gid)).toBe(table.length);
    const snap = await db.select().from(medalTableSnapshot).where(eq(medalTableSnapshot.gamesId, gid));
    expect(snap).toHaveLength(table.length);

    const history = await medalHistoryByNoc(db, ['BRA'], ['OG']);
    expect(history).toEqual([expect.objectContaining({ gamesSlug: 'og-summer-2024', gold: 1, bronze: 1 })]);
  });
});

// ─── carga do Wikidata com fetch falso ───────────────────────────────────────────────────────────

const EV_100M = 'Q25397537';
const EV_JUDO = 'Q90001';
const EV_RELAY = 'Q90002';
const EV_HEAT = 'Q90003';

function fakeWdqs(statements: StatementSpec[]) {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    const q = new URLSearchParams(String(init!.body)).get('query')!;
    let rows: SparqlBinding[] = [];
    if (q.includes('wdt:P984')) {
      calls.push('ioc');
      rows = [
        ['Q155', 'BRA'],
        ['Q766', 'JAM'],
        ['Q30', 'USA'],
        ['Q16', 'CAN'],
        ['Q17', 'JPN'],
        ['Q45', 'POR'],
      ].map(([item, code]) => ({ item: uri(item!), code: lit(code!) }));
    } else if (q.includes('pq:P2443')) {
      calls.push('statements');
      const offset = Number(/OFFSET (\d+)/.exec(q)![1]);
      rows = offset === 0 ? statements.map(statementRow) : [];
    } else if (q.includes('VALUES ?ev')) {
      calls.push('events');
      const ev = (qid: string, en: string, cls = 'Q18536594', sportLabel = 'athletics') => ({
        ev: uri(qid),
        cls: uri(cls),
        sportLabel: lit(sportLabel, 'en'),
        endDate: date('2016-08-14'),
        lblEn: lit(en, 'en'),
      });
      rows = [
        ev(EV_100M, "athletics at the 2016 Summer Olympics – men's 100 metres"),
        ev(EV_JUDO, "judo at the 2016 Summer Olympics – women's 57 kg", 'Q18536594', 'judo'),
        ev(EV_RELAY, "athletics at the 2016 Summer Olympics – women's 4 × 100 metres relay"),
        ev(EV_HEAT, "men's 100 metres – heat 1", 'Q2122052'),
      ];
    } else if (q.includes('VALUES ?p')) {
      calls.push('participants');
      const human = (qid: string, country: string, en: string) => ({
        p: uri(qid),
        type: uri('Q5'),
        cit: uri(country),
        lblEn: lit(en, 'en'),
      });
      rows = [
        human('Q1189', 'Q766', 'Usain Bolt'),
        human('Q1652', 'Q30', 'Justin Gatlin'),
        human('Q19952288', 'Q16', 'Andre De Grasse'),
        human('Q201', 'Q155', 'Rafaela Silva'),
        human('Q202', 'Q17', 'Judoca JPN'),
        human('Q203', 'Q45', 'Judoca POR'),
        human('Q204', 'Q17', 'Judoca JPN 2'),
        human('Q301', 'Q30', 'Velocista 1'),
        human('Q302', 'Q30', 'Velocista 2'),
      ];
    } else if (q.includes('VALUES ?item')) {
      calls.push('labels');
    } else if (q.includes('pq:P1114')) {
      calls.push('delegation');
      rows = [{ d: uri('Q17741814'), country: uri('Q155'), medal: uri(GOLD), qty: lit(7) }];
    }
    return new Response(JSON.stringify(response(rows)), { status: 200 });
  };
  return { fetchFn, calls };
}

const RIO_STATEMENTS: StatementSpec[] = [
  { id: 'Q1189-final', ev: EV_100M, p: 'Q1189', rank: 1, stage: FINAL, medal: GOLD },
  { id: 'Q1189-semi', ev: EV_100M, p: 'Q1189', rank: 1, stage: SEMI },
  { id: 'Q1652-a', ev: EV_100M, p: 'Q1652', medal: SILVER },
  { id: 'Q19952288-a', ev: EV_100M, p: 'Q19952288', rank: 3 },
  { id: 'Q201-a', ev: EV_JUDO, p: 'Q201', medal: GOLD },
  { id: 'Q202-a', ev: EV_JUDO, p: 'Q202', medal: SILVER },
  { id: 'Q203-a', ev: EV_JUDO, p: 'Q203', medal: BRONZE },
  { id: 'Q204-a', ev: EV_JUDO, p: 'Q204', medal: BRONZE, deprecated: true },
  { id: 'Q301-a', ev: EV_RELAY, p: 'Q301', medal: GOLD },
  { id: 'Q302-a', ev: EV_RELAY, p: 'Q302', medal: GOLD },
  { id: 'Q1189-heat', ev: EV_HEAT, p: 'Q1189', rank: 1 },
];

describe('WikidataMedalLoader', () => {
  it('carrega, deriva o quadro, guarda o bruto e é idempotente (2ª execução sai do cache)', async () => {
    const [rio] = await db.select().from(games).where(eq(games.slug, 'og-summer-2016'));
    const fake = fakeWdqs(RIO_STATEMENTS);
    const client = new SparqlClient({ fetch: fake.fetchFn, cache: new PgSparqlCache(db), minIntervalMs: 0 });
    const report = await new WikidataMedalLoader(db, client).loadGames(rio!);

    expect(report.medalEvents).toBe(3);
    expect(report.excludedEvents).toBe(1);
    expect(report.medals).toEqual({ active: 7, revoked: 1, G: 3, S: 2, B: 2 });
    expect(report.teamEvents).toBe(1);
    expect(report.delegationReferences).toBe(1);
    expect(client.networkCalls).toBeGreaterThan(0);

    const table = await medalTableForGames(db, 'og-summer-2016');
    expect(table.find((r) => r.nocCode === 'USA')).toMatchObject({ gold: 1, silver: 1, total: 2 });
    expect(table.find((r) => r.nocCode === 'BRA')).toMatchObject({ gold: 1, total: 1 });
    expect(table.find((r) => r.nocCode === 'JPN')).toMatchObject({ silver: 1, bronze: 0 });

    const [relay] = await db.select().from(msEvent).where(eq(msEvent.wikidataQid, EV_RELAY));
    expect(relay).toMatchObject({ isTeam: true, gender: 'W', disciplineCode: 'ATH' });
    const members = await db.select().from(teamMember);
    expect(members).toHaveLength(2);
    const revoked = await db
      .select()
      .from(medal)
      .where(eq(medal.sourceKey, `wikidata:${EV_JUDO}:athlete:Q204:B:revoked`));
    expect(revoked[0]!.revokedAt).not.toBeNull();

    const raw = await db.select().from(apiResponse).where(eq(apiResponse.provider, 'wikidata'));
    expect(raw.length).toBe(client.networkCalls);
    const refs = await db
      .select()
      .from(sourceRef)
      .where(and(eq(sourceRef.source, 'wikidata'), eq(sourceRef.entityType, 'medal')));
    expect(refs).toHaveLength(8);
    expect(refs[0]!.license).toBe('CC0-1.0');
    const [ref] = await db
      .select()
      .from(medalReference)
      .where(and(eq(medalReference.gamesId, rio!.id), eq(medalReference.source, 'wikidata-delegation')));
    expect(ref).toMatchObject({ nocCode: 'BRA', gold: 7 });

    const before = await db.select({ id: medal.id }).from(medal).where(eq(medal.source, 'wikidata'));
    const again = new SparqlClient({ fetch: fake.fetchFn, cache: new PgSparqlCache(db), minIntervalMs: 0 });
    await new WikidataMedalLoader(db, again).loadGames(rio!);
    expect(again.networkCalls).toBe(0);
    const after = await db.select({ id: medal.id }).from(medal).where(eq(medal.source, 'wikidata'));
    expect(after.map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());
    expect(await db.select().from(msPerson)).toHaveLength(9); // atletas com medalha (inclusive a revogada)
  });

  it('remove medalhas que sumiram da fonte ao atualizar (--refresh)', async () => {
    const [rio] = await db.select().from(games).where(eq(games.slug, 'og-summer-2016'));
    const fake = fakeWdqs(RIO_STATEMENTS.filter((s) => s.ev !== EV_RELAY));
    const client = new SparqlClient({
      fetch: fake.fetchFn,
      cache: new PgSparqlCache(db),
      minIntervalMs: 0,
      refresh: true,
    });
    const report = await new WikidataMedalLoader(db, client).loadGames(rio!);
    expect(report.medals.active).toBe(6);
    const relayMedals = await db
      .select()
      .from(medal)
      .where(eq(medal.sourceKey, `wikidata:${EV_RELAY}:team:USA:G`));
    expect(relayMedals).toHaveLength(0);
    await seedWikipediaReferences(db);
    const [cov] = await coverageByEdition(db, ['og-summer-2016']);
    expect(cov).toMatchObject({ games: 'og-summer-2016', events: 3 });
    expect(cov!.expected?.total).toBe(972);
  });
});

describe('ligação com os torneios da api-sports (#78)', () => {
  it('liga temporadas por data, aponta ligas pendentes e temporadas fora da janela', async () => {
    await db
      .insert(sport)
      .values({ slug: 'football', name: { en: 'Football' } })
      .onConflictDoNothing();
    await db
      .insert(country)
      .values({ code: 'WORLD', name: { en: 'World' } })
      .onConflictDoNothing();
    const [men] = await db
      .insert(competition)
      .values({
        sport: 'football',
        slug: 'olympics-men',
        name: 'Olympics Men',
        countryCode: 'WORLD',
        type: 'cup',
      })
      .returning();
    await db.insert(providerMap).values({
      entityType: 'competition',
      entityId: men!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '480',
    });
    await db.insert(season).values([
      { competitionId: men!.id, label: '2020', year: 2020, startDate: '2021-07-22', endDate: '2021-08-07' },
      { competitionId: men!.id, label: '2024', year: 2024, startDate: '2024-07-24', endDate: '2024-08-09' },
      { competitionId: men!.id, label: '2019', year: 2019, startDate: '2019-01-01', endDate: '2019-03-01' },
    ]);

    const report = await linkGamesCompetitions(db);
    expect(report.linked.map((l) => [l.games, l.season, l.matchedBy])).toEqual([
      ['og-summer-2020', 2020, 'date_overlap'],
      ['og-summer-2024', 2024, 'date_overlap'],
    ]);
    expect(report.unmatchedSeasons).toEqual([{ competition: 'olympics-men', season: 2019 }]);
    expect(report.pending.map((p) => `${p.sport}:${p.providerLeagueId}`)).toContain('basketball:192');

    await linkGamesCompetitions(db);
    const links = await db.select().from(gamesCompetition);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ sport: 'football', gender: 'M', providerLeagueId: '480' });
  });
});
