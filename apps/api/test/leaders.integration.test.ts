import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompetitionLeaders } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  createDb,
  participant,
  person,
  personSeasonStat,
  runMigrations,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Artilharia e líderes (#828) contra o banco: a ordem e a posição saem só do SQL (`rank()` + `order by`), então
 * o teste confere a soma de quem trocou de clube, o corte com empatados, os desempates e o time do jogador.
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
const people: Record<string, string> = {};
const teams: Record<string, string> = {};

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<CompetitionLeaders>();
};

type Stat = {
  team: string;
  appearances?: number;
  minutes?: number;
  goals?: number;
  assists?: number;
  yellow?: number;
  red?: number;
};

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-lideres', name: 'Liga Líderes', type: 'league' })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026, current: true })
    .returning();
  const clubs = await db
    .insert(participant)
    .values(['Azul', 'Verde', 'Branco'].map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const c of clubs) teams[c.name] = c.id;

  const rows: Record<string, Stat[]> = {
    // transferido: 2 gols no Azul + 3 no Verde = 5, à frente de quem tem 4 num time só
    Transferido: [
      { team: 'Azul', appearances: 10, minutes: 800, goals: 2 },
      { team: 'Verde', appearances: 12, minutes: 1000, goals: 3 },
    ],
    Quatro: [{ team: 'Branco', appearances: 20, minutes: 1700, goals: 4 }],
    // empatados em 3 gols: o de menos jogos vem antes, e depois o de menos minutos
    TresPoucosJogos: [{ team: 'Azul', appearances: 5, minutes: 450, goals: 3 }],
    TresMuitosJogos: [{ team: 'Azul', appearances: 15, minutes: 450, goals: 3 }],
    TresMenosMinutos: [{ team: 'Branco', appearances: 15, minutes: 300, goals: 3 }],
    Zero: [{ team: 'Branco', appearances: 30, minutes: 2700, goals: 0, yellow: 9 }],
    // cartões: 3 + 1 (4) passa 4 + 0 (4) pelos vermelhos, mesmo com mais jogos
    Vermelho: [{ team: 'Verde', appearances: 20, minutes: 1800, yellow: 3, red: 1 }],
    Amarelo: [{ team: 'Verde', appearances: 10, minutes: 900, yellow: 4, red: 0 }],
  };
  // assistências: 3 com 2 e 55 com 1. Com limit=10 a 4ª posição (55) não cabe inteira no teto de 50
  for (let i = 1; i <= 3; i++) rows[`Assist2_${i}`] = [{ team: 'Verde', appearances: 10, assists: 2 }];
  for (let i = 1; i <= 55; i++) rows[`Assist1_${i}`] = [{ team: 'Verde', appearances: 10, assists: 1 }];
  // 12 empatados com 1 gol: com limit=10 a posição de corte é 6, e todos os 12 entram
  for (let i = 1; i <= 12; i++) {
    rows[`Um${String(i).padStart(2, '0')}`] = [{ team: 'Branco', appearances: i, minutes: 90 * i, goals: 1 }];
  }
  const inserted = await db
    .insert(person)
    .values(Object.keys(rows).map((name) => ({ name })))
    .returning();
  for (const p of inserted) people[p.name] = p.id;
  await db.insert(personSeasonStat).values(
    Object.entries(rows).flatMap(([name, stats]) =>
      stats.map((st) => ({
        personId: people[name]!,
        participantId: teams[st.team]!,
        seasonId: s!.id,
        appearances: st.appearances ?? null,
        minutes: st.minutes ?? null,
        goals: st.goals ?? null,
        assists: st.assists ?? null,
        yellowCards: st.yellow ?? null,
        redCards: st.red ?? null,
        stats: {},
      })),
    ),
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
    slug: 'lideres',
    name: 'Líderes',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'lideres' })).key;
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

const names = (b: CompetitionLeaders) => b.data.map((r) => r.person.name);

describe('GET /v1/competitions/{id}/seasons/{season}/leaders', () => {
  it('soma quem trocou de clube, divide a posição no empate e desempata por jogos e minutos', async () => {
    const body = await get('/v1/competitions/liga-lideres/seasons/current/leaders?limit=5');
    expect(body.season).toEqual({ year: 2026, label: '2026' });
    expect(body.data.map((r) => [r.person.name, r.rank, r.value])).toEqual([
      ['Transferido', 1, 5],
      ['Quatro', 2, 4],
      ['TresPoucosJogos', 3, 3],
      ['TresMenosMinutos', 3, 3],
      ['TresMuitosJogos', 3, 3],
    ]);
    const t = body.data[0]!;
    expect(t).toMatchObject({ appearances: 22, minutes: 1800, goals: 5 });
    // o time é o de mais jogos na temporada
    expect(t.team?.id).toBe(teams.Verde);
  });

  it('quem empata com o último colocado entra junto, mesmo passando do limit', async () => {
    const body = await get('/v1/competitions/liga-lideres/seasons/2026/leaders?limit=10');
    // 5 acima + 12 empatados na 6ª posição: o corte é pela posição, não pela linha
    expect(body.data).toHaveLength(17);
    const tied = body.data.slice(5);
    expect(new Set(tied.map((r) => r.rank))).toEqual(new Set([6]));
    // dentro da posição, menos jogos primeiro
    expect(tied.map((r) => r.person.name)).toEqual(
      Array.from({ length: 12 }, (_, i) => `Um${String(i + 1).padStart(2, '0')}`),
    );
    expect(names(body)).not.toContain('Zero');
  });

  it('cartões: soma amarelos e vermelhos, e os vermelhos desempatam antes dos jogos', async () => {
    const body = await get('/v1/competitions/liga-lideres/seasons/current/leaders?category=cards&limit=3');
    expect(body.category).toBe('cards');
    expect(body.data.map((r) => [r.person.name, r.rank, r.value, r.yellow_cards, r.red_cards])).toEqual([
      ['Zero', 1, 9, 9, 0],
      ['Vermelho', 2, 4, 3, 1],
      ['Amarelo', 2, 4, 4, 0],
    ]);
  });

  it('o teto de 50 não parte uma posição: a que não cabe inteira fica de fora', async () => {
    const body = await get('/v1/competitions/liga-lideres/seasons/current/leaders?category=assists&limit=10');
    expect(body.data.map((r) => [r.rank, r.value])).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    // a data é a da temporada inteira
    expect(body.updated_at).not.toBeNull();
  });
});
