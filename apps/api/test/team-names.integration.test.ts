import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Event, SearchResponse, Standings, TeamSummary } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  season,
  sport,
  standing,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Nome de exibição dos times (teams/display-name.ts): o rótulo da base semântica no piso editorial ou, sem
 * ele, o nome do fornecedor com o corretor de acentos; o nome original em `provider_name`.
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
const NOW = new Date('2026-10-22T18:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
/** Piso da produção (SEMANTIC_MIN_REVIEW_STATUS=draft). */
let app: FastifyInstance;
/** Piso padrão (approved): perfis em rascunho não valem. */
let strict: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = async <T>(url: string, server = app) => {
  const res = await server.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete' } },
  ]);
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' } },
    { code: 'MX', name: { en: 'Mexico', 'pt-BR': 'México', es: 'México' } },
  ]);
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Mirassol', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Sao Paulo', code: 'SAO', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Gremio', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Leon', countryCode: 'MX' },
      { sport: 'football', kind: 'club', name: 'Atletico Paranaense', countryCode: 'BR' },
      // sem país: o corretor não sabe o idioma e não mexe
      { sport: 'basketball', kind: 'club', name: 'Sao Paulo Basquete' },
    ])
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  await db.insert(teamProfile).values([
    {
      slug: 'sao-paulo',
      participantId: ids['Sao Paulo'],
      countryCode: 'BR',
      names: { official: 'São Paulo Futebol Clube', short: 'São Paulo', abbreviation: 'SAO' },
      nicknames: ['Tricolor'],
      rallyingCries: ['Vamos, São Paulo!'],
      sourceFile: 'football/teams/br.yaml',
      reviewStatus: 'approved',
    },
    {
      // perfil em rascunho: vale com o piso draft (produção), não com o approved
      slug: 'athletico-pr',
      participantId: ids['Atletico Paranaense'],
      countryCode: 'BR',
      names: { official: 'Club Athletico Paranaense', short: 'Athletico-PR' },
      sourceFile: 'football/teams/br.yaml',
      reviewStatus: 'draft',
    },
  ]);
  const [serieA] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'brasileirao-serie-a',
      name: 'Serie A',
      countryCode: 'BR',
      type: 'league',
      tier: 1,
      labels: { 'pt-BR': 'Brasileirão Série A' },
    })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: serieA!.id, label: '2026', year: 2026, current: true })
    .returning();
  ids.season = s!.id;
  const game = (h: number) => ({
    sport: 'football',
    competitionId: serieA!.id,
    startsAt: hours(h),
    endsAtExpected: hours(h + 2),
    status: 'scheduled' as const,
  });
  const games = await db
    .insert(event)
    .values([game(48), game(72)])
    .returning();
  ids.mirassolSaoPaulo = games[0]!.id;
  ids.gremioLeon = games[1]!.id;
  await db.insert(eventParticipant).values([
    { eventId: games[0]!.id, participantId: ids.Mirassol!, side: 'home' },
    { eventId: games[0]!.id, participantId: ids['Sao Paulo']!, side: 'away' },
    { eventId: games[1]!.id, participantId: ids.Gremio!, side: 'home' },
    { eventId: games[1]!.id, participantId: ids.Leon!, side: 'away' },
  ]);
  await db.insert(standing).values(
    [ids['Sao Paulo']!, ids.Mirassol!, ids['Atletico Paranaense']!].map((participantId, i) => ({
      seasonId: ids.season!,
      participantId,
      rank: i + 1,
      points: 30 - i * 3,
      played: 15,
      won: 9 - i,
      drawn: 3,
      lost: 3 + i,
      source: 'computed' as const,
    })),
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
    slug: 'nomes',
    name: 'Nomes',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'nomes' })).key;
  const base = { db, redis, cdnPurger: new RecordingCdnPurger(), now: () => NOW };
  app = buildServer({ ...base, keyPrefix, semantic: { minReviewStatus: 'draft' } });
  strict = buildServer({ ...base, keyPrefix: `${keyPrefix}strict:` });
  await Promise.all([app.ready(), strict.ready()]);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await strict?.close();
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

const names = (e: Event) => e.participants.map((p) => p.name);

describe('nome de exibição dos times', () => {
  it.each(['pt-BR', 'es-AR'])(
    'Mirassol × São Paulo em %s: o nome curado, com o do fornecedor à parte',
    async (locale) => {
      const e = await get<Event>(`/v1/events/${ids.mirassolSaoPaulo}?locale=${locale}`);
      expect(names(e)).toEqual(['Mirassol', 'São Paulo']);
      const sp = e.participants.find((p) => p.id === ids['Sao Paulo'])!;
      expect(sp.provider_name).toBe('Sao Paulo');
      expect(sp.cheer?.text).toBe('Vamos, São Paulo!'); // o nome e o grito agora concordam
    },
  );

  it('o piso padrão (approved) também mostra São Paulo: perfil aprovado', async () => {
    const e = await get<Event>(`/v1/events/${ids.mirassolSaoPaulo}?locale=pt-BR`, strict);
    expect(names(e)).toEqual(['Mirassol', 'São Paulo']);
  });

  it('sem perfil: o corretor de acentos pelo idioma do país (Grêmio, León)', async () => {
    const pt = await get<Event>(`/v1/events/${ids.gremioLeon}?locale=pt-BR`);
    expect(names(pt)).toEqual(['Grêmio', 'León']);
    expect(pt.participants.map((p) => p.provider_name)).toEqual(['Gremio', 'Leon']);
    const es = await get<Event>(`/v1/events/${ids.gremioLeon}?locale=es-MX`);
    expect(names(es)).toEqual(['Grêmio', 'León']);
  });

  it('lista de eventos e classificação usam o mesmo nome', async () => {
    const list = await get<{ data: Event[] }>(
      `/v1/events?from=2026-10-22&to=2026-10-30&locale=es-AR&competition=brasileirao-serie-a`,
    );
    expect(list.data.map(names)).toEqual([
      ['Mirassol', 'São Paulo'],
      ['Grêmio', 'León'],
    ]);
    const table = await get<Standings>(
      `/v1/competitions/${encodeURIComponent('brasileirao-serie-a')}/seasons/2026/standings?locale=pt-BR`,
    );
    expect(table.groups[0]!.rows.map((r) => r.participant.name)).toEqual([
      'São Paulo',
      'Mirassol',
      'Athletico-PR',
    ]);
  });

  it('perfil em rascunho só vale com o piso draft; abaixo do piso, o corretor', async () => {
    const draft = await get<TeamSummary>(`/v1/teams/${ids['Atletico Paranaense']}`);
    expect(draft.name).toBe('Athletico-PR');
    const approved = await get<TeamSummary>(`/v1/teams/${ids['Atletico Paranaense']}`, strict);
    expect(approved.name).toBe('Atlético Paranaense');
    expect(approved.provider_name).toBe('Atletico Paranaense');
  });

  it('time sem país fica como o fornecedor manda', async () => {
    const t = await get<TeamSummary>(`/v1/teams/${ids['Sao Paulo Basquete']}`);
    expect(t.name).toBe('Sao Paulo Basquete');
  });
});

describe('busca com e sem acento', () => {
  it.each(['sao paulo', 'são paulo', 'SÃO PAULO'])('/v1/search acha São Paulo por "%s"', async (q) => {
    const body = await get<SearchResponse>(`/v1/search?q=${encodeURIComponent(q)}&types=team&sport=football`);
    expect(body.data.map((r) => r.name)).toContain('São Paulo');
  });

  it.each(['gremio', 'grêmio'])('/v1/teams?q=%s acha o Grêmio (nome do fornecedor sem acento)', async (q) => {
    const body = await get<{ data: TeamSummary[] }>(`/v1/teams?q=${encodeURIComponent(q)}`);
    expect(body.data.map((t) => t.name)).toEqual(['Grêmio']);
  });

  it.each(['São Paulo', 'sao paulo'])('/v1/teams?q=%s acha o São Paulo', async (q) => {
    const body = await get<{ data: TeamSummary[] }>(`/v1/teams?q=${encodeURIComponent(q)}&sport=football`);
    expect(body.data.map((t) => t.name)).toEqual(['São Paulo']);
  });

  it('o jogo achado pela busca leva o nome de exibição', async () => {
    const body = await get<SearchResponse>(`/v1/search?q=mirassol&types=event`);
    expect(body.data[0]?.name).toBe('Mirassol x São Paulo');
  });
});
