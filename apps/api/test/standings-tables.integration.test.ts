import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Standings, TeamOverview } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  createDb,
  participant,
  runMigrations,
  season,
  sport,
  standing,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Tabelas da temporada pelo regulamento (config/rules, `tables:`): na Argentina 2026, as zonas do Apertura e
 * do Clausura (nomes de grupo vistos na API), a tabela anual e os promedios no mesmo `/standings`, com papel,
 * nome no idioma pedido e a fase em andamento; o overview do time mostra a posição na fase em andamento.
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

const get = async <T>(url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [arg] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'argentina-liga-profesional',
      name: 'Liga Profesional Argentina',
      type: 'league',
    })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: arg!.id, label: '2026', year: 2026, current: true })
    .returning();
  const teams = await db
    .insert(participant)
    .values(
      ['Boca Juniors', 'River Plate', 'Racing Club', 'Independiente'].map((name) => ({
        sport: 'football',
        kind: 'club' as const,
        name,
      })),
    )
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  const row = (group: string, team: string, rank: number, played: number, source = 'provider') => ({
    seasonId: s!.id,
    group,
    participantId: ids[team]!,
    rank,
    points: played * 2,
    played,
    source,
  });
  await db.insert(standing).values([
    row('Apertura - Group A', 'Boca Juniors', 1, 16),
    row('Apertura - Group A', 'Racing Club', 2, 16),
    row('Apertura - Group B', 'River Plate', 1, 16),
    row('Apertura - Group B', 'Independiente', 2, 16),
    row('Clausura - Group A', 'Boca Juniors', 2, 9, 'computed'),
    row('Clausura - Group A', 'Racing Club', 1, 9, 'computed'),
    row('Clausura - Group B', 'River Plate', 1, 9, 'computed'),
    row('Clausura - Group B', 'Independiente', 2, 9, 'computed'),
    row('Tabla Anual', 'Boca Juniors', 1, 25, 'computed'),
    row('Tabla Anual', 'River Plate', 2, 25, 'computed'),
    row('Tabla Anual', 'Racing Club', 3, 25, 'computed'),
    row('Tabla Anual', 'Independiente', 4, 25, 'computed'),
    row('Promedios', 'River Plate', 1, 78),
    row('Promedios', 'Boca Juniors', 2, 78),
    // grupo que o regulamento não reconhece: exposto como veio, sem papel
    row('', 'Boca Juniors', 1, 30),
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
    slug: 'tabelas',
    name: 'Tabelas',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'tabelas' })).key;
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

describe('GET /v1/competitions/{id}/seasons/{season}/standings com tabelas do regulamento', () => {
  it('fases na ordem do regulamento, anual e promedios com papel, nome no idioma e a fase em andamento', async () => {
    const body = await get<Standings>(
      '/v1/competitions/argentina-liga-profesional/seasons/2026/standings?locale=es-AR',
    );
    expect(
      body.groups.map((g) => [g.name, g.display_name, g.table, g.table_key, g.current, g.source]),
    ).toEqual([
      ['Apertura - Group A', 'Apertura · Zona A', 'phase', 'apertura', false, 'provider'],
      ['Apertura - Group B', 'Apertura · Zona B', 'phase', 'apertura', false, 'provider'],
      ['Clausura - Group A', 'Clausura · Zona A', 'phase', 'clausura', true, 'computed'],
      ['Clausura - Group B', 'Clausura · Zona B', 'phase', 'clausura', true, 'computed'],
      ['Tabla Anual', 'Tabla anual', 'annual', 'annual', false, 'computed'],
      ['Promedios', 'Promedios', 'relegation_average', 'promedios', false, 'provider'],
      [null, null, null, null, false, 'provider'],
    ]);
    const pt = await get<Standings>(
      '/v1/competitions/argentina-liga-profesional/seasons/2026/standings?locale=pt-BR',
    );
    expect(pt.groups[2]!.display_name).toBe('Clausura · Grupo A');
  });

  it('overview do time: a posição é a da fase em andamento, não a anual nem os promedios', async () => {
    const body = await get<TeamOverview>(`/v1/teams/${ids['Boca Juniors']}/overview?locale=es-AR`);
    const arg = body.standings.find((s) => s.competition.slug === 'argentina-liga-profesional');
    expect(arg).toMatchObject({
      group: 'Clausura - Group A',
      group_display_name: 'Clausura · Zona A',
      rank: 2,
      played: 9,
    });
  });
});
