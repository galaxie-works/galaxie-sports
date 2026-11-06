import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Champions, Leaders } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  competitionTitle,
  competitionTitleCoverage,
  createDb,
  event,
  eventParticipant,
  participant,
  person,
  personSeasonStat,
  runMigrations,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Rotas dos widgets do campeonato (#828, #831): artilharia somando as estatísticas de jogador da temporada (um
 * jogador que trocou de time conta uma vez, com o time em que mais jogou) e a galeria de campeões com o vice
 * (o outro finalista nas copas, o 2º da tabela nas ligas) e o ranking só com a lista completa.
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

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = async <T>(url: string, status = 200) => {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
};

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const comps = await db
    .insert(competition)
    .values([
      { sport: 'football', slug: 'liga-teste', name: 'Liga Teste', type: 'league' },
      { sport: 'football', slug: 'copa-teste', name: 'Copa Teste', type: 'cup' },
      { sport: 'football', slug: 'liga-lacunas', name: 'Liga Lacunas', type: 'league' },
      { sport: 'football', slug: 'liga-dois-torneios', name: 'Liga Dois Torneios', type: 'league' },
    ])
    .returning();
  for (const c of comps) ids[c.slug] = c.id;
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: ids['liga-teste']!, label: '2026', year: 2026, current: true },
      { competitionId: ids['liga-teste']!, label: '2025', year: 2025 },
      { competitionId: ids['copa-teste']!, label: '2025', year: 2025, current: true },
    ])
    .returning();
  ids.liga2026 = seasons[0]!.id;
  ids.liga2025 = seasons[1]!.id;
  ids.copa2025 = seasons[2]!.id;
  const teams = await db
    .insert(participant)
    .values(['Alfa', 'Beta', 'Gama'].map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  const people = await db
    .insert(person)
    .values(['Artilheiro', 'Vice Artilheiro', 'Empatado', 'Sem Gol'].map((name) => ({ name })))
    .returning();
  for (const p of people) ids[p.name] = p.id;

  const stat = (who: string, team: string, s: string, n: Partial<typeof personSeasonStat.$inferInsert>) => ({
    personId: ids[who]!,
    participantId: ids[team]!,
    seasonId: s,
    stats: {},
    ...n,
  });
  await db.insert(personSeasonStat).values([
    // trocou de Alfa para Beta no meio da temporada: 6 + 4 = 10 gols, time = Beta (mais jogos)
    stat('Artilheiro', 'Alfa', ids.liga2026!, { goals: 6, appearances: 8, minutes: 700, yellowCards: 1 }),
    stat('Artilheiro', 'Beta', ids.liga2026!, { goals: 4, appearances: 12, minutes: 1000 }),
    stat('Vice Artilheiro', 'Gama', ids.liga2026!, {
      goals: 7,
      assists: 5,
      appearances: 20,
      minutes: 1500,
      redCards: 1,
    }),
    // 7 gols em menos minutos: vem antes do Vice Artilheiro, na mesma posição
    stat('Empatado', 'Alfa', ids.liga2026!, { goals: 7, appearances: 15, minutes: 1200, yellowCards: 4 }),
    stat('Sem Gol', 'Beta', ids.liga2026!, {
      goals: 0,
      assists: 2,
      appearances: 20,
      minutes: 1800,
      yellowCards: 3,
    }),
  ]);

  // liga: campeão Alfa em 2025 (vice pela tabela: Gama), Beta em 2024 (temporada fora da base: sem vice)
  await db.insert(standing).values([
    { seasonId: ids.liga2025!, participantId: ids.Alfa!, rank: 1, points: 80, played: 38 },
    { seasonId: ids.liga2025!, participantId: ids.Gama!, rank: 2, points: 75, played: 38 },
    { seasonId: ids.liga2025!, participantId: ids.Beta!, rank: 3, points: 60, played: 38 },
  ]);
  const title = (comp: string, team: string | null, year: number, qid: string) => ({
    competitionId: ids[comp]!,
    participantId: team ? ids[team]! : null,
    seasonYear: year,
    seasonLabel: String(year),
    decidedOn: `${year}-12-01`,
    editionQid: qid,
    winnerQid: `Q${qid}w`,
    competitionQid: `Q${comp}`,
  });
  await db.insert(competitionTitle).values([
    title('liga-teste', 'Alfa', 2025, 'Q2025'),
    title('liga-teste', 'Beta', 2024, 'Q2024'),
    title('liga-teste', 'Alfa', 2023, 'Q2023'),
    // a fonte listou dois vencedores na mesma edição: sai uma vez, pelo ligado
    title('liga-teste', null, 2023, 'Q2023'),
    title('copa-teste', 'Gama', 2025, 'QC2025'),
    title('liga-lacunas', null, 2025, 'QL2025'),
    title('liga-lacunas', 'Beta', 2022, 'QL2022'),
    // Apertura e Clausura no mesmo ano: duas edições, cada uma uma vez
    title('liga-dois-torneios', 'Alfa', 2024, 'QA2024'),
    title('liga-dois-torneios', 'Beta', 2024, 'QC2024'),
  ]);
  await db.insert(competitionTitleCoverage).values([
    {
      competitionId: ids['liga-teste']!,
      competitionQid: 'Qliga',
      firstYear: 2023,
      latestYear: 2025,
      completeThrough: 2025,
    },
    {
      competitionId: ids['liga-lacunas']!,
      competitionQid: 'Qlac',
      firstYear: 2022,
      latestYear: 2025,
      completeThrough: 2022,
    },
  ]);

  // copa: final 2025 Gama × Beta (o vice é Beta)
  const [final] = await db
    .insert(stage)
    .values({ seasonId: ids.copa2025!, kind: 'final', name: { 'pt-BR': 'Final' }, providerLabel: 'Final' })
    .returning();
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: ids['copa-teste']!,
      seasonId: ids.copa2025!,
      stageId: final!.id,
      startsAt: new Date('2025-11-29T20:00:00Z'),
      endsAtExpected: new Date('2025-11-29T22:00:00Z'),
      status: 'finished',
      score: { home: 2, away: 1 },
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: ids.Gama!, side: 'home' },
    { eventId: ev!.id, participantId: ids.Beta!, side: 'away' },
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
    slug: 'campeonato',
    name: 'Campeonato',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'campeonato' })).key;
  app = buildServer({ db, redis, keyPrefix, cdnPurger: new RecordingCdnPurger() });
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

describe('GET /v1/competitions/{id}/seasons/{season}/leaders', () => {
  it('artilharia: soma os times da temporada, divide a posição no empate e deixa de fora quem não marcou', async () => {
    const body = await get<Leaders>('/v1/competitions/liga-teste/seasons/current/leaders');
    expect(body.season).toEqual({ year: 2026, label: '2026' });
    expect(body.category).toBe('goals');
    expect(body.data.map((r) => [r.rank, r.person.name, r.goals, r.team?.name, r.teams])).toEqual([
      [1, 'Artilheiro', 10, 'Beta', 2],
      [2, 'Empatado', 7, 'Alfa', 1],
      [2, 'Vice Artilheiro', 7, 'Gama', 1],
    ]);
    expect(body.updated_at).not.toBeNull();
  });

  it('limite com empate no fim, assistências e cartões (vermelhos desempatam)', async () => {
    const top = await get<Leaders>('/v1/competitions/liga-teste/seasons/2026/leaders?limit=2');
    expect(top.data.map((r) => r.person.name)).toEqual(['Artilheiro', 'Empatado']);
    const assists = await get<Leaders>(
      '/v1/competitions/liga-teste/seasons/current/leaders?category=assists',
    );
    expect(assists.data.map((r) => [r.person.name, r.assists])).toEqual([
      ['Vice Artilheiro', 5],
      ['Sem Gol', 2],
    ]);
    const cards = await get<Leaders>('/v1/competitions/liga-teste/seasons/current/leaders?category=cards');
    expect(cards.data.map((r) => [r.rank, r.person.name])).toEqual([
      [1, 'Empatado'],
      [2, 'Sem Gol'],
      // 1 cartão cada: o vermelho do Vice Artilheiro desempata
      [3, 'Vice Artilheiro'],
      [4, 'Artilheiro'],
    ]);
  });

  it('temporada sem estatística: lista vazia; temporada ou competição inexistente: 404', async () => {
    const empty = await get<Leaders>('/v1/competitions/liga-teste/seasons/2025/leaders');
    expect(empty.data).toEqual([]);
    expect(empty.updated_at).toBeNull();
    await get('/v1/competitions/liga-teste/seasons/1990/leaders', 404);
    await get('/v1/competitions/nao-existe/seasons/current/leaders', 404);
    await get('/v1/competitions/liga-teste/seasons/current/leaders?category=faltas', 400);
  });
});

describe('GET /v1/competitions/{id}/champions', () => {
  it('liga: edições da mais recente para trás, vice pela tabela e ranking com a lista completa', async () => {
    const body = await get<Champions>('/v1/competitions/liga-teste/champions');
    expect(
      body.data.map((e) => [e.season_label, e.champion?.name ?? null, e.runner_up?.name ?? null]),
    ).toEqual([
      ['2025', 'Alfa', 'Gama'],
      ['2024', 'Beta', null],
      ['2023', 'Alfa', null],
    ]);
    expect(body.editions).toBe(3);
    expect(body.ranking?.map((r) => [r.team.name, r.titles, r.last])).toEqual([
      ['Alfa', 2, '2025'],
      ['Beta', 1, '2024'],
    ]);
    expect(body.coverage).toEqual({ first_year: 2023, complete_through: 2025, unidentified: 0 });
    const one = await get<Champions>('/v1/competitions/liga-teste/champions?limit=1');
    expect(one.data).toHaveLength(1);
    expect(one.editions).toBe(3);
  });

  it('copa: o vice é o outro finalista', async () => {
    const body = await get<Champions>(`/v1/competitions/${ids['copa-teste']}/champions`);
    expect(body.data[0]).toMatchObject({
      season_label: '2025',
      champion: { name: 'Gama' },
      runner_up: { name: 'Beta' },
    });
    // sem cobertura gravada: sem ranking
    expect(body.ranking).toBeNull();
  });

  it('lista com lacuna: sem ranking e a edição não ligada com o campeão nulo', async () => {
    const body = await get<Champions>('/v1/competitions/liga-lacunas/champions');
    expect(body.ranking).toBeNull();
    expect(body.data.map((e) => e.champion?.name ?? null)).toEqual([null, 'Beta']);
    expect(body.coverage?.unidentified).toBe(1);
  });

  it('duas edições no mesmo ano (Apertura e Clausura) saem uma vez cada', async () => {
    const body = await get<Champions>('/v1/competitions/liga-dois-torneios/champions');
    expect(body.editions).toBe(2);
    expect(body.data.map((e) => e.champion?.name).sort()).toEqual(['Alfa', 'Beta']);
  });
});
