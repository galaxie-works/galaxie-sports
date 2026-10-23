import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDenylist, normalizeParams, requestHash } from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  closeDb,
  competition,
  competitionProfile,
  country,
  createDb,
  derby,
  derbyTeam,
  event,
  participant,
  providerMap,
  publishChange,
  runMigrations,
  season,
  sport,
  standing,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { normalizeFootballFromRaw, upsertBatch } from '@galaxie/ingestor';
import { normalizeFixtures, type ApiFixture } from '@galaxie/providers';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { rebuildFromCore } from '../src/routes/mirror-rebuild.js';
import { buildServer } from '../src/server.js';

/*
 * Integração das rotas /v1 de eventos, times, pessoas e contexto, e da remontagem do espelho.
 * O core é semeado pelos normalizadores do ingestor a partir de respostas reais recortadas
 * (packages/providers/test/fixtures) e de partidas sintéticas no formato da api-sports v3.
 * Nenhuma chamada ao fornecedor.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;
const ASSETS = 'https://assets.test/galaxie';
const NOW = new Date('2026-10-21T15:00:00Z');
const FIXTURES = new URL('../../../packages/providers/test/fixtures/api-sports/football/', import.meta.url);

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key, ...headers } });

function fixture(name: string): { parameters: Record<string, string>; results?: number } {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as {
    parameters: Record<string, string>;
  };
}

async function insertRaw(endpoint: string, body: unknown, fetchedAt: string) {
  const env = body as { parameters: Record<string, string> | []; results?: number };
  const params = normalizeParams(Array.isArray(env.parameters) ? {} : env.parameters);
  await db.insert(apiResponse).values({
    provider: 'api-sports',
    sport: 'football',
    apiVersion: 'v3',
    endpoint,
    params,
    requestHash: requestHash('api-sports', 'football', endpoint, params),
    statusCode: 200,
    results: env.results ?? null,
    errors: [],
    body,
    bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    fetchedAt: new Date(fetchedAt),
    jobId: 'teste',
  });
}

/** Partida sintética no formato da api-sports v3. */
function fx(o: {
  id: number;
  date: string;
  league: { id: number; name: string; season: number; round: string };
  home: [number, string];
  away: [number, string];
  status: 'NS' | 'FT' | '1H';
  goals?: [number, number];
  referee?: string | null;
}): ApiFixture {
  const ts = Date.parse(o.date) / 1000;
  const [gh, ga] = o.goals ?? [null, null];
  const finished = o.status === 'FT';
  return {
    fixture: {
      id: o.id,
      referee: o.referee ?? null,
      timezone: 'UTC',
      date: o.date,
      timestamp: ts,
      periods: { first: finished ? ts : null, second: finished ? ts + 3600 : null },
      venue: { id: 258, name: 'Estádio 258', city: 'Sao Paulo' },
      status: {
        long: finished ? 'Match Finished' : 'Not Started',
        short: o.status,
        elapsed: finished ? 90 : null,
      },
    },
    league: {
      ...o.league,
      country: o.league.id === 71 ? 'Brazil' : 'World',
      logo: `https://media.api-sports.io/football/leagues/${o.league.id}.png`,
      flag: null,
    },
    teams: {
      home: {
        id: o.home[0],
        name: o.home[1],
        logo: `https://media.api-sports.io/football/teams/${o.home[0]}.png`,
        winner: finished ? gh! > ga! : null,
      },
      away: {
        id: o.away[0],
        name: o.away[1],
        logo: `https://media.api-sports.io/football/teams/${o.away[0]}.png`,
        winner: finished ? ga! > gh! : null,
      },
    },
    goals: { home: gh, away: ga },
    score: {
      halftime: { home: gh === null ? null : 0, away: ga === null ? null : 0 },
      fulltime: { home: gh, away: ga },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

async function participantOf(providerId: number): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.providerId, String(providerId)),
      ),
    );
  return row!.id;
}

async function eventOf(providerId: number): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.entityType, 'event'),
        eq(providerMap.providerId, String(providerId)),
      ),
    );
  return row!.id;
}

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol' } });
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } },
    { code: 'AR', name: { en: 'Argentina', 'pt-BR': 'Argentina' } },
    { code: 'WORLD', name: { en: 'World', 'pt-BR': 'Mundo' } },
  ]);
  const [serieA, liberta] = await db
    .insert(competition)
    .values([
      {
        sport: 'football',
        slug: 'brasileirao-serie-a',
        name: 'Serie A',
        labels: { 'pt-BR': 'Brasileirão Série A' },
        countryCode: 'BR',
        type: 'league',
        tier: 1,
      },
      {
        sport: 'football',
        slug: 'conmebol-libertadores',
        name: 'CONMEBOL Libertadores',
        labels: { 'pt-BR': 'Libertadores', es: 'Libertadores' },
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
      },
    ])
    .returning();
  ids.serieA = serieA!.id;
  ids.liberta = liberta!.id;
  await db.insert(providerMap).values([
    {
      entityType: 'competition',
      entityId: serieA!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '71',
    },
    {
      entityType: 'competition',
      entityId: liberta!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '13',
    },
  ]);
  await db.insert(competitionProfile).values({
    slug: 'libertadores',
    competitionId: liberta!.id,
    labels: { 'pt-BR': 'Libertadores' },
    nicknames: { 'pt-BR': ['Glória Eterna'], es: ['La Gloria Eterna'] },
    sourceFile: 'competitions/football.yaml',
  });
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: serieA!.id, label: '2024', year: 2024 },
      { competitionId: serieA!.id, label: '2026', year: 2026, current: true },
      { competitionId: liberta!.id, label: '2026', year: 2026, current: true },
    ])
    .returning();
  ids.serieA2026 = seasons[1]!.id;

  // raw real recortado → core, pelo normalizador do ingestor
  const real: [string, string, string][] = [
    ['fixtures-league-71-2024.json', '/fixtures', '2026-10-21T14:13:47Z'],
    ['fixtures-headtohead-121-131.json', '/fixtures/headtohead', '2026-10-21T14:14:08Z'],
    ['fixtures-date-2026-10-21.json', '/fixtures', '2026-10-21T14:13:54Z'],
    ['teams-country-brazil.json', '/teams', '2026-10-21T14:15:48Z'],
    ['players-squads-121.json', '/players/squads', '2026-10-21T14:15:33Z'],
    ['coachs-121.json', '/coachs', '2026-10-21T14:16:00Z'],
    ['standings-71-2024.json', '/standings', '2026-10-21T14:16:10Z'],
    ['fixtures-id-1492407.json', '/fixtures', '2026-10-21T14:17:00Z'],
  ];
  for (const [file, endpoint, at] of real) await insertRaw(endpoint, fixture(file), at);
  await normalizeFootballFromRaw(db);

  // partidas sintéticas: as duas semifinais da Libertadores (ida e volta) e a última rodada do Brasileirão 2026
  const liber = { id: 13, name: 'CONMEBOL Libertadores', season: 2026, round: 'Semi-finals' };
  const serie = { id: 71, name: 'Serie A', season: 2026, round: 'Regular Season - 38' };
  const batch = normalizeFixtures(
    [
      fx({
        id: 990001,
        date: '2026-10-14T00:30:00+00:00',
        league: liber,
        home: [124, 'Fluminense'],
        away: [121, 'Palmeiras'],
        status: 'FT',
        goals: [1, 2],
      }),
      fx({
        id: 990002,
        date: '2026-10-22T00:30:00+00:00',
        league: liber,
        home: [121, 'Palmeiras'],
        away: [124, 'Fluminense'],
        status: 'NS',
        referee: 'Wilton Pereira Sampaio, Brazil',
      }),
      // a outra semifinal (o outro lado da chave): ida encerrada, volta em aberto
      fx({
        id: 990003,
        date: '2026-10-16T00:30:00+00:00',
        league: liber,
        home: [450, 'Estudiantes L.P.'],
        away: [127, 'Flamengo'],
        status: 'FT',
        goals: [1, 1],
      }),
      fx({
        id: 990004,
        date: '2026-10-23T00:30:00+00:00',
        league: liber,
        home: [127, 'Flamengo'],
        away: [450, 'Estudiantes L.P.'],
        status: 'NS',
      }),
      fx({
        id: 990010,
        date: '2026-10-25T19:00:00+00:00',
        league: serie,
        home: [9001, 'Líder FC'],
        away: [9002, 'Vice FC'],
        status: 'NS',
      }),
      fx({
        id: 990011,
        date: '2026-10-25T19:00:00+00:00',
        league: serie,
        home: [9003, 'Terceiro FC'],
        away: [9004, 'Quarto FC'],
        status: 'NS',
      }),
    ],
    new Date('2026-10-21T14:00:00Z'),
  );
  await upsertBatch(db, batch);
  ids.leg1 = await eventOf(990001);
  ids.leg2 = await eventOf(990002);
  ids.semiB1 = await eventOf(990003);
  ids.semiB2 = await eventOf(990004);
  ids.estudiantes = await participantOf(450);
  // país dos clubes das semifinais (relevância por mercado)
  for (const [pid, code] of [
    [121, 'BR'],
    [124, 'BR'],
    [127, 'BR'],
    [450, 'AR'],
  ] as const)
    await db
      .update(participant)
      .set({ countryCode: code })
      .where(eq(participant.id, await participantOf(pid)));
  ids.final38 = await eventOf(990010);
  ids.detail = await eventOf(1492407);
  ids.palmeiras = await participantOf(121);
  ids.corinthians = await participantOf(131);

  // tabela do Brasileirão 2026 antes da última rodada (20 clubes, 37 jogos)
  const top = await Promise.all([9001, 9002, 9003, 9004].map(participantOf));
  ids.leader = top[0]!;
  const others = await db
    .insert(participant)
    .values(
      Array.from({ length: 16 }, (_, i) => ({
        sport: 'football',
        kind: 'club' as const,
        name: `Clube ${i + 5}`,
        countryCode: 'BR',
      })),
    )
    .returning({ id: participant.id });
  const table = [...top, ...others.map((o) => o.id)];
  const points = [76, 74, 70, 68, ...Array.from({ length: 16 }, (_, i) => 66 - i * 2)];
  await db.insert(standing).values(
    table.map((participantId, i) => ({
      seasonId: ids.serieA2026!,
      participantId,
      rank: i + 1,
      points: points[i]!,
      played: 37,
      won: Math.floor(points[i]! / 3),
      drawn: points[i]! % 3,
      lost: 37 - Math.floor(points[i]! / 3) - (points[i]! % 3),
      source: 'computed',
    })),
  );

  // clássico e perfis semânticos
  await db.insert(teamProfile).values([
    {
      slug: 'palmeiras',
      participantId: ids.palmeiras,
      countryCode: 'BR',
      names: { official: 'Sociedade Esportiva Palmeiras', short: 'Palmeiras' },
      nicknames: ['Verdão', 'Alviverde'],
      rallyingCries: ['Avanti, Palestra!'],
      copyHints: { 'pt-BR': { cheer: ['Vai, Verdão!', 'Avanti, Palestra!'] } },
      sources: ['https://pt.wikipedia.org/wiki/Sociedade_Esportiva_Palmeiras'],
      sourceFile: 'football/teams/br.yaml',
    },
    {
      slug: 'corinthians',
      participantId: ids.corinthians,
      countryCode: 'BR',
      names: { official: 'Sport Club Corinthians Paulista', short: 'Corinthians' },
      nicknames: ['Timão'],
      sourceFile: 'football/teams/br.yaml',
    },
  ]);
  const [d] = await db
    .insert(derby)
    .values({
      slug: 'derby-paulista',
      name: 'Derby Paulista',
      labels: { 'pt-BR': 'Derby Paulista', es: 'Derbi Paulista' },
      scope: 'state',
      intensity: 5,
      sourceFile: 'football/derbies/br.yaml',
    })
    .returning();
  await db.insert(derbyTeam).values([
    { derbyId: d!.id, teamSlug: 'palmeiras' },
    { derbyId: d!.id, teamSlug: 'corinthians' },
  ]);
  await db.execute(sql`
    update core.event e set derby_id = ${d!.id}::uuid
     where exists (select 1 from core.event_participant a where a.event_id = e.id and a.participant_id = ${ids.palmeiras}::uuid)
       and exists (select 1 from core.event_participant b where b.event_id = e.id and b.participant_id = ${ids.corinthians}::uuid)`);

  // raws extras para o espelho: um fresco (raw-hit) e um mais antigo que o core (rebuilt)
  await insertRaw(
    '/leagues',
    {
      get: 'leagues',
      parameters: { id: '475' },
      errors: [],
      results: 1,
      paging: { current: 1, total: 1 },
      response: [
        {
          league: {
            id: 475,
            name: 'Paulista - A1',
            logo: 'https://media.api-sports.io/football/leagues/475.png',
          },
          country: { name: 'Brazil', flag: 'https://media.api-sports.io/flags/br.svg' },
        },
      ],
    },
    '2026-10-21T14:00:00Z',
  );
  await insertRaw(
    '/fixtures',
    {
      get: 'fixtures',
      parameters: { league: '71', season: '2026' },
      errors: [],
      results: 1,
      paging: { current: 1, total: 1 },
      response: [{ fixture: { id: 1492407 } }],
    },
    '2026-10-21T13:00:00Z',
  );
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  const t = await upsertTenant(db, {
    slug: 'demo',
    name: 'Demo',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'integração' })).key;
  app = buildServer({
    db,
    redis,
    keyPrefix,
    assetsBaseUrl: ASSETS,
    now: () => NOW,
    changeFeed: { pollIntervalMs: 100 },
    mediaDenylist: new MediaDenylist([
      { url: 'https://media.api-sports.io/football/leagues/475.png', reason: 'escudo errado' },
    ]),
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

type Relevance = {
  market: string;
  score: number;
  bonus: number;
  reasons: string[];
  details: { code: string; points: number; text: string; participant: { id: string; name: string } | null }[];
};

type EventBody = {
  id: string;
  status: string;
  starts_at: string;
  importance: number;
  importance_breakdown: {
    tier: number;
    phase: number;
    derby: number;
    decisive: number;
    prestige: number;
    flags: string[];
  } | null;
  relevance: Relevance | null;
  relevance_by_market: Relevance[] | null;
  momentum: string | null;
  stage: { kind: string; leg: number | null; name: string | null } | null;
  participants: {
    side: string;
    id: string;
    name: string;
    nickname: string | null;
    logo: string | null;
    fan_tags: { code: string; priority: number; text: Record<string, string> }[];
    cheer?: { text: string; source_url?: string } | null;
  }[];
  score: { home: number | null; away: number | null; aggregate: { home: number; away: number } | null };
  competition: { slug: string; name: string; nickname: string | null } | null;
  competition_context: string[];
  stakes: { team: string; team_id: string | null; code: string; text: Record<string, string> }[];
  derby: { slug: string; name: string; intensity: number } | null;
  venue: { id: string; name: string; city: string | null } | null;
  referee: { name: string; country: string | null } | null;
  data_freshness: { last_valid_at: string | null; is_stale: boolean };
};

describe('/v1/events — agenda e ao vivo', () => {
  it('agenda do dia: filtra pelo dia civil, pagina por cursor sem repetir e ordena por horário', async () => {
    const seen: EventBody[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/events?date=2026-10-21&limit=4${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: EventBody[]; next_cursor: string | null };
      seen.push(...body.data);
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor);
    expect(seen).toHaveLength(10);
    expect(pages).toBe(3);
    expect(new Set(seen.map((e) => e.id)).size).toBe(10);
    const starts = seen.map((e) => Date.parse(e.starts_at));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(seen.every((e) => e.starts_at.startsWith('2026-10-21T'))).toBe(true);
  });

  it('fuso do cliente muda o dia civil e o formato dos instantes', async () => {
    // 2026-10-21 em São Paulo = 03:00Z do dia 21 até 03:00Z do dia 22 — inclui a volta da semifinal (00:30Z do 22)
    const res = await get('/v1/events?date=2026-10-21&tz=America/Sao_Paulo&limit=50');
    const data = (res.json() as { data: EventBody[] }).data;
    expect(data.map((e) => e.id)).toContain(ids.leg2);
    expect(data.every((e) => /-03:00$/.test(e.starts_at))).toBe(true);
    // os 10 jogos do dia (08:00Z–23:00Z) + a volta da semifinal (00:30Z do dia 22 = 21:30 em São Paulo)
    expect(data).toHaveLength(11);
    const utc = (await get('/v1/events?date=2026-10-21&limit=50')).json().data as EventBody[];
    expect(utc.map((e) => e.id)).not.toContain(ids.leg2);
  });

  it('filtros: competição (slug), status, importância, time e país; ordem por importância', async () => {
    const libs = (await get('/v1/events?competition=conmebol-libertadores&from=2026-10-01')).json();
    expect(libs.data.map((e: EventBody) => e.id)).toEqual([ids.leg1, ids.semiB1, ids.leg2, ids.semiB2]);
    const finished = (await get('/v1/events?date=2026-10-21&status=finished,cancelled')).json();
    expect(finished.data.every((e: EventBody) => ['finished', 'cancelled'].includes(e.status))).toBe(true);
    expect(finished.data).toHaveLength(4);
    const team = (await get(`/v1/events?team=${ids.palmeiras}&from=2026-01-01`)).json();
    expect(team.data.length).toBeGreaterThanOrEqual(4);
    expect(team.data.every((e: EventBody) => e.participants.some((p) => p.id === ids.palmeiras))).toBe(true);
    const br = (await get('/v1/events?country=br&from=2026-10-20&to=2026-10-31')).json();
    expect(br.data.map((e: EventBody) => e.id)).toEqual(expect.arrayContaining([ids.final38]));
    const top = (await get('/v1/events?from=2026-10-01&order=importance&importance_min=40&limit=50')).json();
    const imp = top.data.map((e: EventBody) => e.importance);
    expect(imp.every((n: number) => n >= 40)).toBe(true);
    expect([...imp].sort((a: number, b: number) => b - a)).toEqual(imp);

    expect((await get('/v1/events?status=jogando')).statusCode).toBe(400);
    expect((await get('/v1/events?date=21-10-2026')).statusCode).toBe(400);
    expect((await get('/v1/events?from=2026-10-22&to=2026-10-01')).statusCode).toBe(400);
  });

  it('paginação por importância não repete nem pula', async () => {
    const all = (await get('/v1/events?from=2020-01-01&order=importance&limit=200')).json()
      .data as EventBody[];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/v1/events?from=2020-01-01&order=importance&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await get(url)).json() as { data: EventBody[]; next_cursor: string | null };
      seen.push(...body.data.map((e) => e.id));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.map((e) => e.id));
  });

  it('relevância por mercado: filtro, ordem e paginação (exige mercado)', async () => {
    expect((await get('/v1/events?from=2026-10-01&order=relevance')).statusCode).toBe(400);
    expect((await get('/v1/events?from=2026-10-01&relevance_min=50')).statusCode).toBe(400);
    expect((await get('/v1/events?from=2026-10-01&market=BRA')).statusCode).toBe(400);

    const plain = (await get('/v1/events?from=2026-10-01&limit=50')).json() as { data: EventBody[] };
    expect(plain.data.every((e) => e.relevance === null)).toBe(true);

    const url = '/v1/events?from=2020-01-01&order=relevance&market=br&limit=200';
    const all = (await get(url)).json().data as EventBody[];
    expect(all.length).toBeGreaterThan(3);
    const rel = all.map((e) => e.relevance!.score);
    expect([...rel].sort((a, b) => b - a)).toEqual(rel);
    for (const e of all) {
      expect(e.relevance).toMatchObject({ market: 'BR' });
      expect(e.relevance!.score).toBe(Math.min(100, e.importance + e.relevance!.bonus));
    }
    // a soma em SQL (ordem) e a do lote (resposta) batem: a ordem é a do score devolvido
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: string = `/v1/events?from=2020-01-01&order=relevance&market=BR&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await get(page)).json() as { data: EventBody[]; next_cursor: string | null };
      seen.push(...body.data.map((e) => e.id));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.map((e) => e.id));

    const min = (await get('/v1/events?from=2020-01-01&market=BR&relevance_min=60&limit=200')).json()
      .data as EventBody[];
    expect(min.every((e) => e.relevance!.score >= 60)).toBe(true);
    expect(min.length).toBe(all.filter((e) => e.relevance!.score >= 60).length);
  });

  it('ao vivo: só eventos em andamento, com momentum live e TTL curto', async () => {
    const res = await get('/v1/events/live');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=10');
    const data = (res.json() as { data: EventBody[] }).data;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((e) => ['live', 'break', 'suspended'].includes(e.status))).toBe(true);
    expect(data.every((e) => e.momentum === 'live')).toBe(true);
  });
});

describe('/v1/events/{id}', () => {
  it('volta da semifinal: perna, agregado, apelido da competição e stakes do motor de regras', async () => {
    const res = await get(`/v1/events/${ids.leg2}?tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const e = res.json() as EventBody;
    expect(e).toMatchObject({
      status: 'scheduled',
      momentum: 'today',
      starts_at: '2026-10-21T21:30:00-03:00',
      competition: { slug: 'conmebol-libertadores', name: 'Libertadores', nickname: 'Glória Eterna' },
      stage: { kind: 'semi_final', leg: 2, name: 'Semifinal · Volta' },
      score: { home: null, away: null, aggregate: { home: 2, away: 1 } },
      competition_context: ['semifinal', 'knockout'],
      data_freshness: { last_valid_at: '2026-10-21T11:00:00-03:00', is_stale: false },
    });
    expect(e.participants.map((p) => [p.side, p.name, p.nickname])).toEqual([
      ['home', 'Palmeiras', 'Verdão'],
      ['away', 'Fluminense', null],
    ]);
    expect(e.participants[0]!.logo).toBe(`https://media.api-sports.io/football/teams/121.png`);
    const [home, away] = e.participants;
    expect(e.stakes).toEqual([
      {
        team: 'home',
        team_id: home!.id,
        code: 'advances_with_draw',
        text: { 'pt-BR': 'Avança com empate' },
      },
      {
        team: 'away',
        team_id: away!.id,
        code: 'needs_win_by_2',
        text: { 'pt-BR': 'Precisa vencer por 2 gols para avançar direto' },
      },
      {
        team: 'away',
        team_id: away!.id,
        code: 'win_by_1_goes_to_penalties',
        text: { 'pt-BR': 'Vitória por 1 gol leva a decisão aos pênaltis' },
      },
    ]);
    // tags do torcedor por participante e grito da base semântica (só quem tem perfil)
    expect(home!.fan_tags).toEqual([
      { code: 'advances_with_draw', priority: 34, text: { 'pt-BR': 'Avança com empate' } },
    ]);
    expect(away!.fan_tags).toEqual([
      { code: 'needs_win_by_2', priority: 31, text: { 'pt-BR': 'Precisa vencer por 2 gols' } },
      {
        code: 'win_by_1_goes_to_penalties',
        priority: 36,
        text: { 'pt-BR': 'Vencer por 1 leva aos pênaltis' },
      },
    ]);
    expect(home!.cheer).toEqual({
      text: 'Vai, Verdão!',
      source_url: 'https://pt.wikipedia.org/wiki/Sociedade_Esportiva_Palmeiras',
    });
    expect(away!.cheer).toBeNull();
    // árbitro ("Nome, País" do fornecedor) e local com cidade
    expect(e.referee).toEqual({ name: 'Wilton Pereira Sampaio', country: 'Brazil' });
    expect(e.venue).toMatchObject({ id: expect.any(String), name: expect.any(String) });
  });

  it('localiza fase e stakes (es-AR) e conta momentum no fuso pedido (UTC → D-1)', async () => {
    const e = (await get(`/v1/events/${ids.leg2}`, { 'accept-language': 'es-AR' })).json() as EventBody;
    expect(e.momentum).toBe('D-1');
    expect(e.stage?.name).toBe('Semifinales · Vuelta');
    expect(e.stakes[0]).toEqual({
      team: 'home',
      team_id: e.participants[0]!.id,
      code: 'advances_with_draw',
      text: { 'es-AR': 'Avanza con el empate' },
    });
    expect(e.participants[0]!.fan_tags[0]?.text).toEqual({ 'es-AR': 'Avanza con el empate' });
    // sem dica de copy em espanhol: cai no grito do clube (rallying_cries), nunca no pt-BR
    expect(e.participants[0]!.cheer?.text).toBe('Avanti, Palestra!');
  });

  it('detalhamento da importância e relevância por mercado (docs/06 §3)', async () => {
    const e = (await get(`/v1/events/${ids.leg2}`)).json() as EventBody;
    // volta da semifinal: fase cheia + eliminação; o tier vem do catálogo
    expect(e.importance_breakdown).toMatchObject({
      phase: 22,
      decisive: 8,
      derby: 0,
      flags: ['elimination'],
    });
    const b = e.importance_breakdown!;
    expect(e.importance).toBe(Math.min(100, b.tier + b.phase + b.derby + b.decisive + b.prestige));
    expect(e.relevance).toBeNull();

    const br = (await get(`/v1/events/${ids.leg2}?market=br`)).json() as EventBody;
    // clássico brasileiro na Libertadores: time do país (+10) já bate o teto
    expect(br.relevance).toMatchObject({
      market: 'BR',
      score: Math.min(100, e.importance + 10),
      bonus: 10,
      reasons: ['team_from_market', 'continental_competition', 'decides_final_opponent'],
    });
    expect(br.relevance!.details[0]).toEqual({
      code: 'team_from_market',
      points: 10,
      text: 'Time do país: Palmeiras e Fluminense',
      participant: null,
    });
    // Libertadores sem time argentino: confederação (+5) e o adversário do Estudiantes na final (+5)
    const ar = (await get(`/v1/events/${ids.leg2}?market=AR`)).json() as EventBody;
    expect(ar.relevance).toEqual({
      market: 'AR',
      score: Math.min(100, e.importance + 10),
      bonus: 10,
      reasons: ['continental_competition', 'decides_final_opponent'],
      details: [
        { code: 'continental_competition', points: 5, text: 'Competição da CONMEBOL', participant: null },
        {
          code: 'decides_final_opponent',
          points: 5,
          text: 'Define o adversário de Estudiantes L.P. na final',
          participant: { id: ids.estudiantes, name: 'Estudiantes L.P.' },
        },
      ],
    });
    // outra confederação: sem bônus
    const de = (await get(`/v1/events/${ids.leg2}?market=DE`)).json() as EventBody;
    expect(de.relevance).toEqual({
      market: 'DE',
      score: e.importance,
      bonus: 0,
      reasons: [],
      details: [],
    });

    // todos os mercados ativos de uma vez, da maior nota para a menor
    const all = e.relevance_by_market!;
    expect(all.map((r) => r.market).sort()).toEqual(
      ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'MX', 'PE', 'PY', 'UY', 'VE'].sort(),
    );
    expect(all.map((r) => r.score)).toEqual([...all.map((r) => r.score)].sort((a, b) => b - a));
    expect(all.slice(0, 2).map((r) => r.market)).toEqual(['BR', 'AR']);
    expect(all.find((r) => r.market === 'UY')!.reasons).toEqual(['continental_competition']);
    expect(all.find((r) => r.market === 'MX')!.bonus).toBe(0);
    // espanhol: textos no idioma pedido
    const es = (await get(`/v1/events/${ids.leg2}?locale=es-AR`)).json() as EventBody;
    expect(es.relevance_by_market!.find((r) => r.market === 'AR')!.details[1]!.text).toBe(
      'Define el rival de Estudiantes L.P. en la final',
    );
    // nas listas, só a do mercado pedido
    const list = (await get('/v1/events?from=2026-10-21&to=2026-10-22&market=AR')).json() as {
      data: EventBody[];
    };
    const inList = list.data.find((x) => x.id === ids.leg2)!;
    expect(inList.relevance_by_market).toBeNull();
    expect(inList.relevance!.score).toBe(ar.relevance!.score);
    // ordenação em SQL com a mesma conta
    const ordered = (
      await get('/v1/events?from=2026-10-21&to=2026-10-22&market=AR&order=relevance')
    ).json() as { data: EventBody[] };
    expect(ordered.data[0]!.id).toBe(ids.leg2);
    expect(ordered.data[0]!.relevance!.score).toBe(ar.relevance!.score);

    const ida = (await get(`/v1/events/${ids.leg1}`)).json() as EventBody;
    // ida: fase × 0,75, nada decidido
    expect(ida.importance_breakdown).toMatchObject({ phase: 17, decisive: 0, flags: [] });
  });

  it('ida encerrada: perna 1, sem stakes nem agregado', async () => {
    const e = (await get(`/v1/events/${ids.leg1}`)).json() as EventBody;
    expect(e).toMatchObject({
      status: 'finished',
      momentum: null,
      stage: { leg: 1, name: 'Semifinal · Ida' },
    });
    expect(e.score).toMatchObject({ home: 1, away: 2, aggregate: null });
    expect(e.stakes).toEqual([]);
    expect(e.participants.map((p) => p.fan_tags)).toEqual([[], []]);
    expect(e.referee).toBeNull();
  });

  it('última rodada do Brasileirão: título em jogo, líder e stakes de liga', async () => {
    const e = (await get(`/v1/events/${ids.final38}`)).json() as EventBody;
    expect(e.competition_context).toEqual(expect.arrayContaining(['regular', 'lead', 'title']));
    const codes = e.stakes.map((s) => `${s.team}:${s.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'home:clinches_title_with_draw',
        'away:clinches_title_with_win',
        'home:qualifies_for_libertadores_group_stage',
      ]),
    );
    const [home, away] = e.participants;
    for (const s of e.stakes)
      expect(s.team_id).toBe(s.team === 'home' ? home!.id : s.team === 'away' ? away!.id : null);
    expect(home!.fan_tags[0]).toEqual({
      code: 'clinches_title_with_draw',
      priority: 12,
      text: { 'pt-BR': 'Empate dá o título' },
    });
    expect(away!.fan_tags[0]?.text['pt-BR']).toBe('Vitória dá o título');
    for (const p of e.participants) {
      expect(p.fan_tags.length).toBeLessThanOrEqual(3);
      const prio = p.fan_tags.map((t) => t.priority);
      expect(prio).toEqual([...prio].sort((a, b) => a - b));
    }
  });

  it('clássico e participantes com apelido', async () => {
    const e = (await get(`/v1/events/${ids.detail}`)).json() as EventBody;
    expect(e.derby).toEqual({ slug: 'derby-paulista', name: 'Derby Paulista', intensity: 5 });
    expect(e.competition_context).toEqual(expect.arrayContaining(['derby', 'regular']));
    expect(e.score).toMatchObject({ home: 4, away: 1 });
  });

  it('404 para evento inexistente, 400 para ID inválido, ETag/304', async () => {
    expect((await get('/v1/events/01a15f83-0f07-78a6-9de5-191d031f73d3')).statusCode).toBe(404);
    expect((await get('/v1/events/xyz')).statusCode).toBe(400);
    const first = await get(`/v1/events/${ids.leg1}`);
    expect(first.headers['surrogate-key']).toContain(`event:${ids.leg1}`);
    const again = await get(`/v1/events/${ids.leg1}`, { 'if-none-match': first.headers.etag as string });
    expect(again.statusCode).toBe(304);
  });

  it('esporte fora do plano do tenant → 403 (também com cache quente)', async () => {
    const t = await upsertTenant(db, {
      slug: 'so-basquete',
      name: 'B',
      plan: 'core_data',
      sports: ['basketball'],
    });
    const k = (await createApiKey(db, t.id)).key;
    await get(`/v1/events/${ids.leg1}`); // aquece o cache com outro tenant
    const res = await app.inject({ url: `/v1/events/${ids.leg1}`, headers: { 'x-galaxie-key': k } });
    expect(res.statusCode).toBe(403);
    const list = await app.inject({ url: '/v1/events?date=2026-10-21', headers: { 'x-galaxie-key': k } });
    expect(list.json().data).toEqual([]);
    const other = await app.inject({ url: '/v1/events?sport=football', headers: { 'x-galaxie-key': k } });
    expect(other.statusCode).toBe(403);
  });
});

describe('/v1/events/{id} — timeline, escalações, estatísticas, h2h e .ics', () => {
  it('timeline a partir de core.event_incident', async () => {
    const body = (await get(`/v1/events/${ids.detail}/timeline`)).json();
    expect(body.event_id).toBe(ids.detail);
    expect(body.incidents.length).toBeGreaterThanOrEqual(3);
    const [goal, card, own] = body.incidents;
    expect(goal).toMatchObject({
      sequence: 0,
      minute: 12,
      type: 'goal',
      detail: 'Normal Goal',
      team: { id: ids.palmeiras, name: 'Palmeiras', side: 'home' },
      player: { name: 'Atacante A' },
      assist: { name: 'Meia A' },
    });
    expect(goal.player.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(card).toMatchObject({
      type: 'card',
      detail: 'Yellow Card',
      comments: 'Foul',
      team: { side: 'away' },
    });
    expect(own).toMatchObject({ type: 'own_goal', minute: 45, extra: 2 });

    // minuto a minuto (docs/05 §3.2.1): tipo canônico, relógio, peso, placar parcial e marcos
    expect(goal).toMatchObject({
      kind: 'goal',
      clock: { period: 'first_half', minute: 12, extra_minute: null, display: "12'" },
      weight: expect.any(Number),
      key_moment: true,
      score_after: { home: 1, away: 0 },
    });
    expect(goal.flags).toContain('opener');
    expect(card).toMatchObject({ kind: 'yellow_card', weight: 30, key_moment: false, score_after: null });
    expect(own).toMatchObject({
      kind: 'own_goal',
      clock: { period: 'first_half', minute: 45, extra_minute: 2, display: "45+2'" },
    });
    expect(body).toMatchObject({
      live: false,
      venue_timezone: 'America/Sao_Paulo',
      generated_at: '2026-10-21T15:00:00Z',
    });
    expect(body.markers.map((m: { kind: string }) => m.kind).slice(0, 3)).toEqual([
      'kickoff',
      'halftime',
      'second_half',
    ]);
    // instantes sempre em UTC (sufixo Z), mesmo pedindo outro fuso
    const tz = (await get(`/v1/events/${ids.detail}/timeline?tz=America/Sao_Paulo`)).json();
    for (const at of [
      tz.generated_at,
      ...tz.incidents.map((i: { occurred_at: string | null }) => i.occurred_at),
      ...tz.markers.map((m: { occurred_at: string | null }) => m.occurred_at),
    ].filter(Boolean))
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('escalações do detalhe da partida, com pessoas do core', async () => {
    const body = (await get(`/v1/events/${ids.detail}/lineups`)).json();
    expect(body.available).toBe(true);
    const home = body.lineups[0];
    expect(home).toMatchObject({ team: { id: ids.palmeiras, side: 'home' }, formation: '4-2-3-1' });
    expect(home.coach.name).toBeTruthy();
    expect(home.start_xi[0]).toMatchObject({
      number: 9,
      position: 'F',
      grid: '5:1',
      person: { name: 'Atacante A' },
    });
    expect(home.start_xi[0].person.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(home.substitutes).toHaveLength(1);
    const none = (await get(`/v1/events/${ids.leg2}/lineups`)).json();
    expect(none).toEqual({ event_id: ids.leg2, available: false, lineups: [] });
  });

  it('estatísticas por time e por jogador', async () => {
    const body = (await get(`/v1/events/${ids.detail}/stats`)).json();
    expect(body.available).toBe(true);
    expect(body.teams[0]).toMatchObject({
      team: { side: 'home' },
      statistics: expect.arrayContaining([
        expect.objectContaining({ type: 'Shots on Goal', value: 8 }),
        {
          type: 'Ball Possession',
          value: '58%',
          code: 'possession_pct',
          label: 'Posse de bola',
          numeric: 58,
          source: 'provider',
        },
      ]),
    });
    expect(body.teams[0].statistics).toContainEqual(
      expect.objectContaining({ code: 'shots_on_goal', label: 'Chutes no gol', numeric: 8 }),
    );
    // rótulos no locale pedido; type e value continuam crus
    const es = (await get(`/v1/events/${ids.detail}/stats?locale=es-AR`)).json();
    expect(es.teams[0].statistics).toContainEqual(
      expect.objectContaining({ type: 'Ball Possession', code: 'possession_pct', label: 'Posesión' }),
    );
    expect(body.players[0].players[0]).toMatchObject({
      person: { name: 'Atacante A' },
      statistics: { goals: { total: 2 } },
    });
  });

  it('h2h do core, sem chamar o fornecedor (o jogo da página entra quando já terminou)', async () => {
    const body = (await get(`/v1/events/${ids.detail}/h2h`)).json();
    expect(body.participants.map((p: { name: string }) => p.name)).toEqual(['Palmeiras', 'Corinthians']);
    // o próprio jogo (4 x 1, encerrado) conta: a barra não pode contradizer o placar da página
    expect(body.summary).toEqual({
      played: 3,
      draws: 1,
      teams: [
        { id: ids.palmeiras, wins: 2, goals: 5 },
        { id: ids.corinthians, wins: 0, goals: 1 },
      ],
    });
    expect(body.events[0].id).toBe(ids.detail);
    expect(body.events.slice(1).map((e: EventBody) => e.starts_at)).toEqual([
      '2026-04-12T21:30:00Z',
      '2026-02-08T23:30:00Z',
    ]);
    const limited = (await get(`/v1/events/${ids.detail}/h2h?limit=1`)).json();
    expect(limited.events).toHaveLength(1);
    expect(limited.summary.played).toBe(3);
  });

  it('.ics (RFC 5545) em UTC, com CRLF e texto escapado', async () => {
    const res = await get(`/v1/events/${ids.leg2}.ics`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${ids.leg2}.ics"`);
    const ics = res.body;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain(`UID:${ids.leg2}@galaxie.sports\r\n`);
    expect(ics).toContain('DTSTART:20261022T003000Z\r\n');
    expect(ics).toMatch(/DTEND:20261022T\d{6}Z/);
    expect(ics).toContain('SUMMARY:Palmeiras × Fluminense · Libertadores');
    expect(ics).toContain('LOCATION:Estádio 258\\, São Paulo');
    expect(ics).toContain('STATUS:CONFIRMED');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    const again = await get(`/v1/events/${ids.leg2}.ics`, { 'if-none-match': res.headers.etag as string });
    expect(again.statusCode).toBe(304);
  });
});

describe('/v1/teams e /v1/people', () => {
  it('busca por nome e apelido, filtra por competição e pagina', async () => {
    const byName = (await get('/v1/teams?q=palmei')).json();
    expect(byName.data.map((t: { name: string }) => t.name)).toEqual(['Palmeiras']);
    expect(byName.data[0]).toMatchObject({ kind: 'club', nicknames: ['Verdão', 'Alviverde'], code: 'PAL' });
    const byNick = (await get('/v1/teams?q=tim%C3%A3o')).json();
    expect(byNick.data.map((t: { name: string }) => t.name)).toEqual(['Corinthians']);
    const liber = (await get('/v1/teams?competition=conmebol-libertadores')).json();
    expect(liber.data.map((t: { name: string }) => t.name).sort()).toEqual([
      'Estudiantes L.P.',
      'Flamengo',
      'Fluminense',
      'Palmeiras',
    ]);
    const p1 = (await get('/v1/teams?country=BR&limit=1')).json();
    const p2 = (await get(`/v1/teams?country=BR&limit=1&cursor=${p1.next_cursor}`)).json();
    expect(p1.data[0].id).not.toBe(p2.data[0].id);
  });

  it('detalhe do time com estádio, IDs externos e cores do escudo', async () => {
    // paleta como o espelho de mídia grava (core.asset.palette do escudo)
    const [palmeiras] = await db
      .select({ logo: participant.logoAssetId })
      .from(participant)
      .where(eq(participant.id, ids.palmeiras!));
    await db
      .update(asset)
      .set({ palette: { version: 1, dominant: '#006937', secondary: null, monochrome: false } })
      .where(eq(asset.id, palmeiras!.logo!));

    // nomes anteriores derivados dos jogos: variação de caixa do nome atual não conta
    await db
      .update(participant)
      .set({
        providerFormerNames: [
          { name: 'PALMEIRAS', from: '2012-01-01', until: '2013-12-31' },
          { name: 'Palestra Itália', from: '1914-08-26', until: '1942-09-14' },
        ],
      })
      .where(eq(participant.id, ids.palmeiras!));
    const t = (await get(`/v1/teams/${ids.palmeiras}`)).json();
    expect(t).toMatchObject({
      name: 'Palmeiras',
      country_ref: { code: 'BR', name: 'Brasil' },
      external_ids: { 'api-sports': '121' },
      venue: { name: 'Estádio 258' },
      former_names: [
        {
          name: 'Palestra Itália',
          from: '1914-08-26',
          until: '1942-09-14',
          origin: 'provider',
          confidence: 'low',
        },
      ],
      colors: {
        primary: '#006937',
        secondary: null,
        monochrome: false,
        gradient: 'linear-gradient(9deg, #000 0%, #006937 100%)',
      },
    });
    // sem paleta (escudo ainda não espelhado) → colors null
    expect((await get(`/v1/teams/${ids.corinthians}`)).json().colors).toBeNull();
    expect((await get('/v1/teams/01a15f83-0f07-78a6-9de5-191d031f73d3')).statusCode).toBe(404);
  });

  it('overview: posição, forma (últimos 5), últimos jogos e próximo jogo em uma chamada', async () => {
    const res = await get(`/v1/teams/${ids.palmeiras}/overview?tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.team.name).toBe('Palmeiras');
    expect(o.team.colors).toMatchObject({ primary: '#006937', gradient: expect.stringContaining('#006937') });
    expect(o.standings[0]).toMatchObject({
      competition: { slug: 'brasileirao-serie-a', name: 'Brasileirão Série A' },
      season: { year: 2024 },
      rank: 1,
      points: 73,
    });
    expect(o.form.map((f: { result: string; score: string }) => `${f.result} ${f.score}`)).toEqual([
      'W 2-1',
      'W 4-1',
      'D 0-0',
      'W 1-0',
      'W 1-0',
    ]);
    // campanha: em disputa primeiro; copa sem tabela entra com o confronto em andamento
    expect(o.competitions[0]).toMatchObject({
      competition: { slug: 'conmebol-libertadores' },
      season: { year: 2026 },
      campaign: {
        status: 'in_progress',
        stage_kind: 'semi_final',
        label: { 'pt-BR': 'Nas semifinais' },
        detail: { 'pt-BR': 'Contra Fluminense (ida: 2–1)' },
        opponent: { name: 'Fluminense' },
        decided_by_event_id: null,
        ongoing: true,
      },
    });
    expect(o.competitions[1]).toMatchObject({
      competition: { slug: 'brasileirao-serie-a' },
      season: { year: 2026 },
      campaign: { status: 'league', ongoing: true },
    });
    expect(o.competitions.filter((c: { campaign: { ongoing: boolean } }) => !c.campaign.ongoing)).toEqual(
      o.competitions.slice(2),
    );
    const es = (await get(`/v1/teams/${ids.palmeiras}/overview?locale=es-AR`)).json();
    expect(es.competitions[0].campaign).toMatchObject({
      label: { 'es-AR': 'En semifinales' },
      detail: { 'es-AR': 'Contra Fluminense (ida: 2–1)' },
    });
    expect(o.last_events).toHaveLength(5);
    expect(o.last_events[0].id).toBe(ids.leg1);
    expect(o.live_event).toBeNull();
    expect(o.next_event).toMatchObject({ id: ids.leg2, momentum: 'today', stakes: expect.any(Array) });
  });

  it('overview por temporada: campanha, tabela e jogos do ano; próximo jogo só na corrente', async () => {
    const atual = (await get(`/v1/teams/${ids.palmeiras}/overview`)).json();
    expect(atual.season).toBeNull();
    expect(atual.seasons.map((s: { year: number; current: boolean }) => [s.year, s.current])).toEqual([
      [2026, true],
      [2024, false],
    ]);
    expect(atual.seasons[1]).toMatchObject({ labels: ['2024'], events: expect.any(Number) });

    const res = await get(`/v1/teams/${ids.palmeiras}/overview?season=2024&tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.season).toBe(2024);
    expect(o.seasons).toEqual(atual.seasons);
    expect(o.standings.map((s: { season: { year: number } }) => s.season.year)).toEqual([2024]);
    expect(o.competitions).toHaveLength(1);
    expect(o.competitions[0]).toMatchObject({
      competition: { slug: 'brasileirao-serie-a' },
      season: { year: 2024 },
      campaign: { ongoing: false },
    });
    // jogos e forma só do Brasileirão 2024 (fixture real recortado), nada de 2026
    expect(o.last_events.length).toBe(Math.min(5, atual.seasons[1].events));
    expect(o.last_events.every((e: EventBody) => e.starts_at.startsWith('2024-'))).toBe(true);
    expect(o.form).toHaveLength(o.last_events.length);
    expect(o.live_event).toBeNull();
    expect(o.next_event).toBeNull();

    // temporada corrente explícita: só as competições daquele ano, com o próximo jogo
    const corrente = (await get(`/v1/teams/${ids.palmeiras}/overview?season=2026`)).json();
    expect(corrente.competitions.every((c: { season: { year: number } }) => c.season.year === 2026)).toBe(
      true,
    );
    expect(corrente.next_event).toMatchObject({ id: ids.leg2 });

    // ano sem jogos: listas vazias; ano inválido: 400
    const vazio = (await get(`/v1/teams/${ids.palmeiras}/overview?season=1999`)).json();
    expect(vazio).toMatchObject({ season: 1999, standings: [], competitions: [], form: [], last_events: [] });
    expect((await get(`/v1/teams/${ids.palmeiras}/overview?season=dois-mil`)).statusCode).toBe(400);
  });

  it('jogos do time com janela e cursor', async () => {
    const body = (await get(`/v1/teams/${ids.palmeiras}/events?from=2026-10-01&to=2026-10-31`)).json();
    expect(body.data.map((e: EventBody) => e.id)).toEqual([ids.detail, ids.leg1, ids.leg2]);
    const page = (await get(`/v1/teams/${ids.palmeiras}/events?limit=2`)).json();
    expect(page.data).toHaveLength(2);
    expect(page.next_cursor).toBeTruthy();
  });

  it('elenco atual (jogadores e técnico) e pessoa com seus times', async () => {
    const squad = (await get(`/v1/teams/${ids.palmeiras}/squad`)).json();
    expect(squad.season).toBeNull();
    expect(squad.players).toHaveLength(4);
    expect(squad.players.every((p: { position: string }) => p.position === 'Goalkeeper')).toBe(true);
    expect(squad.coaches.map((c: { person: { name: string } }) => c.person.name)).toHaveLength(1);
    const personId = squad.players[0].person.id as string;
    const person = (await get(`/v1/people/${personId}`)).json();
    expect(person.teams[0]).toMatchObject({ team: { id: ids.palmeiras }, role: 'player', season: null });
    expect(person.external_ids['api-sports']).toBeTruthy();
    expect((await get('/v1/people/01a15f83-0f07-78a6-9de5-191d031f73d3')).statusCode).toBe(404);
    const past = (await get(`/v1/teams/${ids.palmeiras}/squad?season=1999`)).json();
    expect(past.players).toEqual([]);
  });

  it('elenco da temporada: inscritos + quem entrou em campo, com jogos e gols das partidas', async () => {
    type Member = { person: { id: string; name: string }; position: string | null; stats: unknown };
    const squad = (await get(`/v1/teams/${ids.palmeiras}/squad?season=2026`)).json();
    expect(squad.season).toBe(2026);
    // 2026 é a temporada corrente: o elenco atual (4 goleiros) entra, com zero jogos
    const keepers = squad.players.filter((p: Member) => p.position === 'Goalkeeper');
    expect(keepers).toHaveLength(4);
    expect(keepers[0].stats).toEqual({ appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0 });
    // o atacante do clássico de 2026 não está no elenco atual, mas jogou: entra pelas estatísticas da partida
    const striker = squad.players.find((p: Member) => p.person.name === 'Atacante A');
    expect(striker).toMatchObject({
      stats: { appearances: 1, starts: 0, minutes: 90, goals: 2, assists: 0 },
      person: { nationality_ref: null },
    });
    // sem `season`, o elenco atual sem números
    const now = (await get(`/v1/teams/${ids.palmeiras}/squad`)).json();
    expect(now.players.every((p: Member) => p.stats === null)).toBe(true);
  });

  it('perfil do jogador: números por competição, carreira e últimos jogos', async () => {
    const squad = (await get(`/v1/teams/${ids.palmeiras}/squad?season=2026`)).json();
    const striker = squad.players.find(
      (p: { person: { name: string } }) => p.person.name === 'Atacante A',
    ) as { person: { id: string } };
    const res = await get(`/v1/people/${striker.person.id}/overview`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      person: { id: striker.person.id, name: 'Atacante A' },
      role: 'player',
      current_team: { id: ids.palmeiras },
      season: 2026,
      seasons: [{ year: 2026, appearances: 1, goals: 2 }],
      totals: { appearances: 1, minutes: 90, goals: 2, rating: 8.4 },
      career: [
        { team: { id: ids.palmeiras }, from: 2026, to: 2026, appearances: 1, goals: 2, current: false },
      ],
      transfers: [],
    });
    // foto ainda não espelhada: a URL de origem, marcada como tal
    expect(body.media).toEqual([{ kind: 'photo', url: expect.stringContaining('900001'), mirrored: false }]);
    expect(body.stats).toHaveLength(1);
    expect(body.stats[0]).toMatchObject({
      competition: { id: ids.serieA },
      season: { year: 2026 },
      goals: 2,
    });
    expect(body.recent_matches).toHaveLength(1);
    expect(body.recent_matches[0]).toMatchObject({ event: { id: ids.detail }, minutes: 90, goals: 2 });
    // ano sem jogos: a temporada pedida, sem números
    const empty = (await get(`/v1/people/${striker.person.id}/overview?season=2019`)).json();
    expect(empty).toMatchObject({ season: 2019, totals: null, stats: [], recent_matches: [] });
    expect((await get('/v1/people/01a15f83-0f07-78a6-9de5-191d031f73d3/overview')).statusCode).toBe(404);
  });
});

describe('/v1/competitions/{id}/context', () => {
  it('mata-mata: chaveamento com ida e volta, agregado parcial e jogos decisivos', async () => {
    const c = (await get('/v1/competitions/conmebol-libertadores/context')).json();
    expect(c).toMatchObject({
      competition: { slug: 'conmebol-libertadores', nickname: 'Glória Eterna', type: 'cup' },
      season: { year: 2026 },
      format: 'groups_and_knockout',
    });
    expect(c.bracket).toHaveLength(1);
    expect(c.bracket[0].ties).toHaveLength(2);
    const tie = c.bracket[0].ties.find((t: { participants: { id: string }[] }) =>
      t.participants.some((p) => p.id === ids.palmeiras),
    );
    expect(c.bracket[0].stage).toEqual({ kind: 'semi_final', name: 'Semifinal' });
    expect(tie.legs.map((l: { leg: number; status: string }) => [l.leg, l.status])).toEqual([
      [1, 'finished'],
      [2, 'scheduled'],
    ]);
    expect(tie.status).toBe('in_progress');
    expect(tie.winner_id).toBeNull();
    expect(tie.aggregate).toEqual(
      expect.arrayContaining([
        { participant_id: ids.palmeiras, goals: 2 },
        { participant_id: expect.any(String), goals: 1 },
      ]),
    );
    expect(c.decisive_events.map((e: EventBody) => e.id)).toEqual([ids.leg2, ids.semiB2]);
  });

  it('pontos corridos: líder, zonas do regulamento e decisão do título', async () => {
    const res = await get('/v1/competitions/brasileirao-serie-a/context');
    expect(res.statusCode).toBe(200);
    const c = res.json();
    expect(c.format).toBe('league');
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0].leader).toMatchObject({ rank: 1, points: 76, participant: { id: ids.leader } });
    const zones = Object.fromEntries(
      c.groups[0].zones.map((z: { id: string; teams: unknown[]; label: string }) => [z.id, z]),
    );
    expect(zones.libertadores_group_stage.teams).toHaveLength(4);
    expect(zones.relegation).toMatchObject({ kind: 'relegation', from: 17, to: 20 });
    expect(zones.relegation.teams).toHaveLength(4);
    expect(zones.sudamericana.label).toBeTruthy();
    expect(c.decisive_events.map((e: EventBody) => e.id)).toContain(ids.final38);
    expect((await get('/v1/competitions/brasileirao-serie-a/context?season=1990')).statusCode).toBe(404);
  });

  it('sem regulamento próprio: zonas pela descrição do fornecedor', async () => {
    const c = (await get('/v1/competitions/brasileirao-serie-a/context?season=2024')).json();
    expect(c.season).toEqual({ year: 2024, label: '2024' });
    expect(c.groups[0].leader.participant.name).toBe('Palmeiras');
  });
});

describe('/mirror — remontagem, last-known-good e mídia', () => {
  it('raw-hit fresco com URLs de mídia reescritas e a lista de bloqueio aplicada', async () => {
    const res = await get('/mirror/football/leagues?id=475');
    expect(res.headers['x-galaxie-source']).toBe('raw-hit');
    const item = res.json().response[0];
    expect(item.league.logo).toBeNull();
    expect(item.country.flag).toBe(`${ASSETS}/api-sports/flags/br.svg`);
  });

  it('rebuilt: partida inexistente no raw, remontada do core com o detalhe', async () => {
    const res = await get('/mirror/football/fixtures?id=990002');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-galaxie-source']).toBe('rebuilt');
    expect(res.headers['x-galaxie-fetched-at']).toBe('2026-10-21T14:00:00.000Z');
    const body = res.json();
    expect(Object.keys(body)).toEqual(['get', 'parameters', 'errors', 'results', 'paging', 'response']);
    expect(body).toMatchObject({ get: 'fixtures', parameters: { id: '990002' }, results: 1 });
    const f = body.response[0];
    expect(Object.keys(f)).toEqual([
      'fixture',
      'league',
      'teams',
      'goals',
      'score',
      'events',
      'lineups',
      'statistics',
      'players',
    ]);
    expect(f.fixture.id).toBe(990002);
    expect(f.teams.home).toMatchObject({ id: 121, logo: `${ASSETS}/api-sports/football/teams/121.png` });
    expect(f).toMatchObject({ events: [], lineups: [], statistics: [], players: [] });
  });

  it('rebuilt quando o core é mais novo que o raw; stale quando não é', async () => {
    const season = await get('/mirror/football/fixtures?league=71&season=2026');
    expect(season.headers['x-galaxie-source']).toBe('rebuilt');
    const fixtures = season.json().response.map((f: { fixture: { id: number } }) => f.fixture.id);
    expect(fixtures).toEqual(expect.arrayContaining([1492407, 990010, 990011]));
    const round = await get(
      '/mirror/football/fixtures?league=71&season=2026&round=Regular%20Season%20-%2038',
    );
    expect(round.json().results).toBe(2);

    const day = await get('/mirror/football/fixtures?date=2026-10-21');
    expect(day.headers['x-galaxie-source']).toBe('stale');
    expect(day.headers['x-galaxie-fetched-at']).toBe('2026-10-21T14:13:54.000Z');
    expect(day.headers['cache-control']).toContain('s-maxage=60');
    expect(day.json().results).toBe(10);
  });

  it('h2h remontado do core e fuso da api-sports', async () => {
    const res = await get(
      '/mirror/football/fixtures/headtohead?h2h=131-121&last=2&timezone=America/Sao_Paulo',
    );
    expect(res.headers['x-galaxie-source']).toBe('rebuilt');
    const body = res.json();
    expect(body.results).toBe(2);
    expect(
      body.response.map((f: { fixture: { id: number; date: string; timezone: string } }) => f.fixture),
    ).toEqual([
      expect.objectContaining({
        id: 1492212,
        timezone: 'America/Sao_Paulo',
        date: '2026-04-12T18:30:00-03:00',
      }),
      expect.objectContaining({ id: 1492407, date: '2026-10-11T17:30:00-03:00' }),
    ]);
  });

  it('combinações não remontáveis continuam miss', async () => {
    const res = await get('/mirror/football/fixtures?venue=258');
    expect(res.headers['x-galaxie-source']).toBe('miss');
    expect(res.json().results).toBe(0);
  });

  it('contrato: a remontagem reproduz as amostras reais do fornecedor', async () => {
    type Envelope = {
      get: string;
      parameters: unknown;
      results: number;
      response: { fixture: { id: number } }[];
    };
    const sample = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as Envelope;
    const byId = (r: Envelope['response']) => [...r].sort((a, b) => a.fixture.id - b.fixture.id);

    const detail = sample('fixtures-id-1492407.json');
    const rebuiltDetail = await rebuildFromCore(db, 'football', '/fixtures', { id: '1492407' });
    expect(rebuiltDetail!.body).toMatchObject({ get: detail.get, parameters: detail.parameters, results: 1 });
    expect(rebuiltDetail!.body.response).toEqual(detail.response);

    const h2h = sample('fixtures-headtohead-121-131.json');
    const rebuiltH2h = await rebuildFromCore(db, 'football', '/fixtures/headtohead', { h2h: '121-131' });
    expect(rebuiltH2h!.body.results).toBe(h2h.results);
    // o detalhe (mais novo) acrescenta events/lineups/... ao 1492407; o resumo é o mesmo da amostra
    const strip = (r: Envelope['response']) =>
      byId(r).map((f) => {
        const { fixture, league, teams, goals, score } = f as unknown as Record<string, unknown>;
        return { fixture, league, teams, goals, score };
      });
    // vale a observação mais nova de cada partida: o 1492407 vem do detalhe (coletado depois do h2h)
    const expected = h2h.response.map((f) => (f.fixture.id === 1492407 ? detail.response[0]! : f));
    expect(strip(rebuiltH2h!.body.response as Envelope['response'])).toEqual(strip(expected));

    const season = sample('fixtures-league-71-2024.json');
    const rebuiltSeason = await rebuildFromCore(db, 'football', '/fixtures', {
      league: '71',
      season: '2024',
    });
    expect(byId(rebuiltSeason!.body.response as Envelope['response'])).toEqual(byId(season.response));
  });
});

describe('desempenho', () => {
  it('p95 ≤ 150 ms com cache quente', async () => {
    const urls = [
      '/v1/events?date=2026-10-21',
      `/v1/events/${ids.leg2}`,
      `/v1/teams/${ids.palmeiras}/overview`,
      '/v1/competitions/conmebol-libertadores/context',
    ];
    for (const u of urls) await get(u);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (const u of urls) {
        const t0 = performance.now();
        const res = await get(u);
        times.push(performance.now() - t0);
        expect(res.headers['x-galaxie-cache']).toBe('HIT');
      }
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(150);
  });
});

describe('purge pelo change feed', () => {
  it('mudança do evento derruba o cache do detalhe', async () => {
    const url = `/v1/events/${ids.leg1}`;
    await get(url);
    expect((await get(url)).headers['x-galaxie-cache']).toBe('HIT');
    await db.update(event).set({ importance: 99 }).where(eq(event.id, ids.leg1!));
    expect((await get(url)).json().importance).not.toBe(99);
    await publishChange(db, { topic: 'event', entityType: 'event', entityId: ids.leg1! });
    await expect
      .poll(async () => (await get(url)).json().importance, { timeout: 5_000, interval: 50 })
      .toBe(99);
  });
});

describe('/v1/events/live — ao vivo de verdade', () => {
  it('descarta o "ao vivo" sem dado fresco depois do fim previsto (relógio dos eventos atrasado)', async () => {
    // jogo que o relógio pôs em live pelo horário e nunca recebeu dado do fornecedor
    await db
      .update(event)
      .set({
        status: 'live',
        statusDetail: 'NS',
        statusSource: 'temporal',
        isStale: true,
        lastValidAt: new Date('2026-10-20T10:00:00Z'),
        endsAtExpected: new Date('2026-10-21T14:00:00Z'),
      })
      .where(eq(event.id, ids.final38!));
    const overdue = (await get(`/v1/events/live?competition=${ids.serieA}`)).json().data as EventBody[];
    expect(overdue.map((e) => e.id)).not.toContain(ids.final38);

    // ainda dentro da janela prevista: continua ao vivo (placar vazio, `is_stale`)
    await db
      .update(event)
      .set({ endsAtExpected: new Date('2026-10-21T16:00:00Z') })
      .where(eq(event.id, ids.final38!));
    const inWindow = (await get(`/v1/events/live?competition=brasileirao-serie-a&sport=football`)).json()
      .data as EventBody[];
    const e = inWindow.find((x) => x.id === ids.final38);
    expect(e).toMatchObject({ status: 'live', data_freshness: { is_stale: true } });
  });
});
