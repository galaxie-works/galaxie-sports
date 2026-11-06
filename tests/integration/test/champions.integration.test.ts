import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompetitionChampions } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  competitionTitle,
  competitionTitleCoverage,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { buildServer, createApiKey, RecordingCdnPurger, upsertTenant } from '@galaxie/api';

// Galeria de campeões `/v1/competitions/{id}/champions` (#831): edições, ranking e vice (final e tabela única)

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

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

async function seed() {
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } });
  const comps = await db
    .insert(competition)
    .values([
      { sport: 'football', slug: 'copa-exemplo', name: 'Copa Exemplo', type: 'cup' },
      { sport: 'football', slug: 'liga-exemplo', name: 'Liga Exemplo', type: 'league' },
      { sport: 'football', slug: 'sem-titulos', name: 'Sem Títulos', type: 'league' },
    ])
    .returning();
  for (const c of comps) ids[c.slug] = c.id;
  const teams = await db
    .insert(participant)
    .values(
      ['Aurora', 'Brisa', 'Cometa'].map((name) => ({
        sport: 'football',
        kind: 'club' as const,
        name: `Clube ${name}`,
        shortName: name,
      })),
    )
    .returning();
  for (const t of teams) ids[t.shortName!] = t.id;

  const title = (comp: string, year: number, team: string | null) => ({
    competitionId: ids[comp]!,
    participantId: team ? ids[team]! : null,
    seasonYear: year,
    seasonLabel: String(year),
    decidedOn: `${year}-11-30`,
    editionQid: `Q${comp}${year}`,
    winnerQid: `QW${team ?? 'x'}`,
    competitionQid: `Q${comp}`,
  });
  await db
    .insert(competitionTitle)
    .values([
      title('copa-exemplo', 2021, 'Aurora'),
      title('copa-exemplo', 2022, 'Brisa'),
      title('copa-exemplo', 2023, 'Aurora'),
      title('copa-exemplo', 2024, 'Cometa'),
      title('liga-exemplo', 2023, 'Brisa'),
      title('liga-exemplo', 2024, 'Aurora'),
    ]);
  await db.insert(competitionTitleCoverage).values([
    { competitionId: ids['copa-exemplo']!, competitionQid: 'Qcopa', firstYear: 2021, completeThrough: 2024 },
    // a liga tem lacuna depois de 2023: a contagem de títulos não é confiável
    { competitionId: ids['liga-exemplo']!, competitionQid: 'Qliga', firstYear: 2023, completeThrough: 2023 },
  ]);

  // Copa 2024: final em ida e volta Cometa × Aurora (vice: Aurora). Copa 2023: final com outro time (sem vice)
  const [s24, s23] = await db
    .insert(season)
    .values([
      { competitionId: ids['copa-exemplo']!, label: '2024', year: 2024 },
      { competitionId: ids['copa-exemplo']!, label: '2023', year: 2023 },
    ])
    .returning();
  const [f24, f23] = await db
    .insert(stage)
    .values([
      { seasonId: s24!.id, kind: 'final', name: { 'pt-BR': 'Final' }, providerLabel: 'Final' },
      { seasonId: s23!.id, kind: 'final', name: { 'pt-BR': 'Final' }, providerLabel: 'Final' },
    ])
    .returning();
  const game = async (seasonId: string, stageId: string, home: string, away: string, day: number) => {
    const at = new Date(Date.UTC(2024, 10, day, 21));
    const [e] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: ids['copa-exemplo']!,
        seasonId,
        stageId,
        status: 'finished',
        startsAt: at,
        endsAtExpected: new Date(at.getTime() + 2 * 3600_000),
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: e!.id, participantId: ids[home]!, side: 'home' },
      { eventId: e!.id, participantId: ids[away]!, side: 'away' },
    ]);
  };
  await game(s24!.id, f24!.id, 'Cometa', 'Aurora', 20);
  await game(s24!.id, f24!.id, 'Aurora', 'Cometa', 27);
  await game(s23!.id, f23!.id, 'Brisa', 'Cometa', 20);

  // Liga 2024: tabela única com Aurora em 1º e Brisa em 2º
  const [l24] = await db
    .insert(season)
    .values({ competitionId: ids['liga-exemplo']!, label: '2024', year: 2024 })
    .returning();
  await db.insert(standing).values([
    { seasonId: l24!.id, participantId: ids.Aurora!, rank: 1, points: 80 },
    { seasonId: l24!.id, participantId: ids.Brisa!, rank: 2, points: 75 },
    { seasonId: l24!.id, participantId: ids.Cometa!, rank: 3, points: 60 },
  ]);
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  const t = await upsertTenant(db, {
    slug: 'camp',
    name: 'Camp',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'campeões' })).key;
  app = buildServer({
    db,
    redis,
    keyPrefix,
    assetsBaseUrl: 'https://assets.test/galaxie',
    cdnPurger: new RecordingCdnPurger(),
    changeFeed: { pollIntervalMs: 250 },
  });
  await app.ready();
}, 60_000);

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

describe('GET /v1/competitions/{id}/champions', () => {
  it('lista as edições da mais recente para trás, com o ranking de títulos e o cache do catálogo', async () => {
    const res = await get('/v1/competitions/copa-exemplo/champions?locale=pt-BR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=86400');
    const body = res.json<CompetitionChampions>();
    expect(body.competition).toMatchObject({ slug: 'copa-exemplo', sport: 'football', name: 'Copa Exemplo' });
    expect(body.editions.map((e) => [e.season_label, e.champion?.short_name])).toEqual([
      ['2024', 'Cometa'],
      ['2023', 'Aurora'],
      ['2022', 'Brisa'],
      ['2021', 'Aurora'],
    ]);
    expect(body.editions.every((e) => e.runner_up === null)).toBe(true);
    expect(body.total_editions).toBe(4);
    expect(body.ranking_complete).toBe(true);
    expect(body.ranking.map((r) => [r.rank, r.participant.short_name, r.titles, r.seasons])).toEqual([
      [1, 'Aurora', 2, ['2023', '2021']],
      [2, 'Cometa', 1, ['2024']],
      [3, 'Brisa', 1, ['2022']],
    ]);
    expect(body.coverage).toEqual({ first_year: 2021, complete_through: 2024 });
  });

  it('com runner_up, o vice sai da final (ida e volta) e não é inventado quando a final não bate', async () => {
    const res = await get(`/v1/competitions/${ids['copa-exemplo']}/champions?runner_up=true&limit=2`);
    expect(res.statusCode).toBe(200);
    const body = res.json<CompetitionChampions>();
    expect(body.editions).toHaveLength(2);
    expect(body.total_editions).toBe(4);
    expect(body.editions[0]!.runner_up?.short_name).toBe('Aurora');
    expect(body.editions[1]!.runner_up).toBeNull();
    // o ranking conta todas as edições, não só as do limit
    expect(body.ranking[0]!.titles).toBe(2);
  });

  it('na liga, o vice é o 2º da tabela; com lacuna na lista, o ranking não sai', async () => {
    const body = (
      await get('/v1/competitions/liga-exemplo/champions?runner_up=true')
    ).json<CompetitionChampions>();
    expect(body.editions[0]).toMatchObject({ season_label: '2024', champion: { short_name: 'Aurora' } });
    expect(body.editions[0]!.runner_up?.short_name).toBe('Brisa');
    expect(body.editions[1]!.runner_up).toBeNull();
    expect(body.ranking_complete).toBe(false);
    expect(body.ranking).toEqual([]);
  });

  it('competição sem lista de campeões devolve listas vazias; inexistente é 404; limit inválido é 400', async () => {
    const empty = (await get('/v1/competitions/sem-titulos/champions')).json<CompetitionChampions>();
    expect(empty).toMatchObject({ editions: [], ranking: [], total_editions: 0, coverage: null });
    expect((await get('/v1/competitions/nao-existe/champions')).statusCode).toBe(404);
    expect((await get('/v1/competitions/copa-exemplo/champions?limit=0')).statusCode).toBe(400);
  });
});
