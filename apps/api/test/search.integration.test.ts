import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchResponse } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  competitionProfile,
  country,
  createDb,
  event,
  eventParticipant,
  participant,
  person,
  roster,
  runMigrations,
  sport,
  teamProfile,
  venue,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

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
let app: FastifyInstance;
let key: string;
let basketKey: string;
const ids: Record<string, string> = {};

const search = async (qs: string, k = key) => {
  const res = await app.inject({ method: 'GET', url: `/v1/search?${qs}`, headers: { 'x-galaxie-key': k } });
  return { res, body: res.json<SearchResponse>() };
};

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete' } },
  ]);
  await db.insert(country).values([
    {
      code: 'BR',
      name: { en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' },
      iocCode: 'BRA',
      confederation: 'CONMEBOL',
    },
    { code: 'AR', name: { en: 'Argentina', 'pt-BR': 'Argentina' }, confederation: 'CONMEBOL' },
    { code: 'WORLD', name: { en: 'World' } },
  ]);
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras', code: 'PAL', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Goias', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Sao Paulo', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Boca Juniors', countryCode: 'AR' },
      { sport: 'basketball', kind: 'club', name: 'Flamengo Basquete', countryCode: 'BR' },
    ])
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  await db.insert(teamProfile).values([
    {
      slug: 'palmeiras',
      participantId: ids.Palmeiras,
      countryCode: 'BR',
      names: { official: 'Sociedade Esportiva Palmeiras', short: 'Palmeiras' },
      nicknames: ['Verdão', 'Alviverde'],
      sourceFile: 'teams/br.yaml',
    },
    {
      slug: 'goias',
      participantId: ids.Goias,
      countryCode: 'BR',
      names: { official: 'Goiás Esporte Clube', short: 'Goiás' },
      nicknames: ['Verdão'],
      sourceFile: 'teams/br.yaml',
    },
  ]);
  const [lib, serieA] = await db
    .insert(competition)
    .values([
      {
        sport: 'football',
        slug: 'conmebol-libertadores',
        name: 'CONMEBOL Libertadores',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
        labels: { 'pt-BR': 'Copa Libertadores' },
      },
      {
        sport: 'football',
        slug: 'brasileirao-serie-a',
        name: 'Serie A',
        countryCode: 'BR',
        type: 'league',
        tier: 1,
        labels: { 'pt-BR': 'Brasileirão Série A' },
      },
    ])
    .returning();
  await db.insert(competitionProfile).values({
    slug: 'libertadores',
    competitionId: lib!.id,
    nicknames: { 'pt-BR': ['Glória Eterna'] },
    sourceFile: 'competitions/football.yaml',
  });
  const game = (competitionId: string, h: number, status: 'scheduled' | 'live' | 'finished') => ({
    sport: 'football',
    competitionId,
    startsAt: hours(h),
    endsAtExpected: hours(h + 2),
    status,
  });
  // Palmeiras joga mais (e na Libertadores): no empate de "verdao" vem antes do Goiás.
  const games = await db
    .insert(event)
    .values([
      game(serieA!.id, 48, 'scheduled'),
      { ...game(lib!.id, -1, 'live'), lastValidAt: NOW },
      game(serieA!.id, -200, 'finished'),
      game(serieA!.id, 24 * 30, 'scheduled'),
    ])
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: games[0]!.id, participantId: ids.Palmeiras!, side: 'home' },
    { eventId: games[0]!.id, participantId: ids['Sao Paulo']!, side: 'away' },
    { eventId: games[1]!.id, participantId: ids['Boca Juniors']!, side: 'home' },
    { eventId: games[1]!.id, participantId: ids.Palmeiras!, side: 'away' },
    { eventId: games[2]!.id, participantId: ids.Palmeiras!, side: 'home' },
    { eventId: games[2]!.id, participantId: ids.Goias!, side: 'away' },
    { eventId: games[3]!.id, participantId: ids.Palmeiras!, side: 'home' },
    { eventId: games[3]!.id, participantId: ids.Goias!, side: 'away' },
  ]);
  ids.live = games[1]!.id;
  ids.next = games[0]!.id;
  const [veiga] = await db
    .insert(person)
    .values([
      { name: 'R. Veiga', firstName: 'Raphael Cláudio', lastName: 'Veiga' },
      { name: 'J. Veigas', lastName: 'Veigas' },
      { name: 'Boca' },
    ])
    .returning();
  await db.insert(roster).values({ participantId: ids.Palmeiras!, personId: veiga!.id, role: 'player' });
  await db.insert(venue).values({
    name: 'Allianz Parque',
    city: 'São Paulo',
    countryCode: 'BR',
    curated: {
      name: 'Nubank Parque',
      city: 'São Paulo',
      nicknames: [],
      former_names: [{ name: 'Allianz Parque', until: '2026-01-31' }],
      team_slugs: ['palmeiras'],
      matched_by: 'name',
    },
  });
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();

  const t = await upsertTenant(db, {
    slug: 'busca',
    name: 'Busca',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'busca' })).key;
  const b = await upsertTenant(db, {
    slug: 'busca-basquete',
    name: 'Busca basquete',
    plan: 'core_data',
    sports: ['basketball'],
    rateLimitPerMinute: 1000,
  });
  basketKey = (await createApiKey(db, b.id, { env: 'test', label: 'basquete' })).key;

  app = buildServer({ db, redis, keyPrefix, cdnPurger: new RecordingCdnPurger(), now: () => NOW });
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

describe('GET /v1/search', () => {
  it('acha pelo apelido da base semântica, sem acento, e diz qual apelido casou', async () => {
    const { res, body } = await search('q=verdao&types=team&locale=pt-BR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('pt-BR');
    expect(body.q).toBe('verdao');
    // empate no apelido exato: o time com mais jogos no último ano vem antes. O perfil do Goiás está em
    // rascunho (abaixo do piso approved): o nome vem do fornecedor ("Goias") com o corretor de acentos
    expect(body.data.map((r) => [r.name, r.matched, r.match])).toEqual([
      ['Palmeiras', 'Verdão', 'exact'],
      ['Goiás', 'Verdão', 'exact'],
    ]);
    expect(body.data[0]).toMatchObject({ type: 'team', id: ids.Palmeiras, country: 'BR', detail: 'Brasil' });
  });

  it('jogos dos times encontrados: ao vivo primeiro, depois os próximos 14 dias', async () => {
    const { body } = await search('q=palmeiras&types=event&locale=pt-BR');
    expect(body.data.map((r) => r.id)).toEqual([ids.live, ids.next]);
    expect(body.data[0]).toMatchObject({
      type: 'event',
      name: 'Boca Juniors x Palmeiras',
      detail: 'Copa Libertadores',
      event: { live: true, status: 'live', competition: 'Copa Libertadores' },
    });
    expect(body.data[0]!.event!.participants.map((p) => p.name)).toEqual(['Boca Juniors', 'Palmeiras']);
    expect(body.data[1]!.event).toMatchObject({ live: false, starts_at: hours(48).toISOString() });
  });

  it('lista única: casamento exato antes do começo de palavra, de qualquer tipo', async () => {
    // a pessoa "Boca" casa por inteiro e passa na frente do time e do jogo (começo de palavra)
    const { body } = await search('q=boca&locale=pt-BR');
    expect(body.data.map((r) => [r.type, r.name, r.match])).toEqual([
      ['person', 'Boca', 'exact'],
      ['team', 'Boca Juniors', 'prefix'],
      ['event', 'Boca Juniors x Palmeiras', 'prefix'],
    ]);
    const exact = await search('q=sao%20paulo&locale=pt-BR');
    // nome exibido com acento (corretor); o do fornecedor, sem acento, segue casando por inteiro
    expect(exact.body.data[0]).toMatchObject({ type: 'team', name: 'São Paulo', match: 'exact' });
    // a cidade do estádio não conta como nome
    expect(exact.body.data.some((r) => r.type === 'venue')).toBe(false);
  });

  it('competições pelo nome localizado e pelo apelido; estádio pelo nome anterior', async () => {
    const lib = await search('q=gloria%20eterna&locale=pt-BR');
    expect(lib.body.data[0]).toMatchObject({
      type: 'competition',
      name: 'Copa Libertadores',
      slug: 'conmebol-libertadores',
      matched: 'Glória Eterna',
      detail: null,
    });
    const allianz = await search('q=allianz&types=venue');
    expect(allianz.body.data[0]).toMatchObject({ name: 'Nubank Parque', matched: 'Allianz Parque' });
  });

  it('pessoas pelo nome completo, com o time atual; países pelo código inteiro', async () => {
    const veiga = await search('q=raphael&types=person');
    expect(veiga.body.data).toHaveLength(1);
    expect(veiga.body.data[0]).toMatchObject({
      name: 'R. Veiga',
      matched: 'Raphael Cláudio Veiga',
      detail: 'Palmeiras',
      sport: 'football',
    });
    const br = await search('q=bra&types=country&locale=pt-BR');
    expect(br.body.data[0]).toMatchObject({ type: 'country', id: 'BR', name: 'Brasil', matched: 'BRA' });
  });

  it('respeita os esportes do plano e o limite por tipo', async () => {
    const { body } = await search('q=flamengo', basketKey);
    expect(body.data.map((r) => r.name)).toEqual(['Flamengo Basquete']);
    const none = await search('q=palmeiras&types=team,event', basketKey);
    expect(none.body.data).toEqual([]);
    const limited = await search('q=verdao&types=team&limit=1');
    expect(limited.body.data).toHaveLength(1);
  });

  it('chaves do JSON de apelidos (`en`, `city`) não casam nem ocupam a vaga dos candidatos', async () => {
    // mais perfis e estádios com a chave do que cabe na pré-seleção (40 por tipo), nenhum com o termo no nome
    const junk = await db
      .insert(participant)
      .values(Array.from({ length: 45 }, (_, i) => ({ sport: 'football', kind: 'club', name: `Clube ${i}` })))
      .returning({ id: participant.id });
    await db.insert(teamProfile).values(
      junk.map((p, i) => ({
        slug: `clube-${i}`,
        participantId: p.id,
        countryCode: 'BR',
        names: { official: `Clube ${i}` },
        labels: { en: `Club ${i}` },
        nicknames: [],
        sourceFile: 'teams/br.yaml',
      })),
    );
    await db.insert(venue).values(
      Array.from({ length: 45 }, (_, i) => ({
        name: `Arena ${i}`,
        capacity: 90_000 - i,
        curated: {
          name: `Arena ${i}`,
          city: `Cidade ${i}`,
          nicknames: [],
          former_names: [],
          team_slugs: [],
          matched_by: 'name' as const,
        },
      })),
    );
    await db.insert(participant).values({ sport: 'football', kind: 'club', name: 'Enfield Town' });
    await db.insert(venue).values({ name: 'City Ground', capacity: 30_000 });
    const en = await search('q=en&types=team');
    expect(en.body.data.map((r) => [r.name, r.match])).toEqual([['Enfield Town', 'prefix']]);
    const city = await search('q=city&types=venue');
    expect(city.body.data.map((r) => [r.name, r.match])).toEqual([['City Ground', 'prefix']]);
  });

  it('valida o termo e os tipos', async () => {
    expect((await search('q=a')).res.statusCode).toBe(400);
    expect((await search('q=palmeiras&types=clube')).res.statusCode).toBe(400);
  });
});
