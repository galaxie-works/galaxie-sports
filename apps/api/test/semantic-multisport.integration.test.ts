import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  country,
  createDb,
  derby,
  event,
  headToHead,
  eventParticipant,
  games,
  medal,
  msEvent,
  msParticipant,
  msPerson,
  participant,
  phase,
  providerMap,
  result,
  runMigrations,
  season,
  sport,
  teamMember,
  unit,
  type Database,
  type EventScore,
} from '@galaxie/db';
import { linkGamesCompetitions, seedMultisport } from '@galaxie/ingestor';
import { loadKnowledge, seedSemantic } from '@galaxie/knowledge';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';

/*
 * Rotas semânticas (#45, #43) e multiesportivas (#75, #78) contra um Postgres descartável, com a base
 * semântica real (seed de data/knowledge) e o seed multiesportivo (CONs, edições, esportes). Zero chamadas
 * a provedores externos.
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
/** Mesmo banco, piso editorial padrão de produção (approved). */
let prodApp: FastifyInstance;
let key: string;
let coreOnlyKey: string;
const ids: Record<string, string> = {};

const get = (url: string, headers: Record<string, string> = {}, server = app) =>
  server.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key, ...headers } });

const DAY = 86_400_000;

async function addClub(name: string, apiId: number) {
  const [p] = await db
    .insert(participant)
    .values({ sport: 'football', kind: 'club', name, countryCode: 'BR' })
    .returning();
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: p!.id,
    provider: 'api-sports',
    sport: 'football',
    providerId: String(apiId),
  });
  return p!.id;
}

async function addMatch(
  homeId: string,
  awayId: string,
  startsAt: Date,
  score: EventScore | null,
  status: 'finished' | 'scheduled' = 'finished',
) {
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: ids.serieA!,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 115 * 60_000),
      status,
      score,
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: homeId, side: 'home' },
    { eventId: ev!.id, participantId: awayId, side: 'away' },
  ]);
  return ev!.id;
}

async function seedCore() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol', en: 'Football' } });
  await db.insert(country).values({ code: 'BR', name: { 'pt-BR': 'Brasil', en: 'Brazil' } });
  const [c] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'brasileirao-serie-a',
      name: 'Serie A',
      labels: { 'pt-BR': 'Brasileirão Série A' },
      countryCode: 'BR',
      type: 'league',
      tier: 1,
    })
    .returning();
  ids.serieA = c!.id;
  // futebol olímpico masculino (liga 480 da api-sports), temporada de Paris 2024 — ligado pelo multisport:seed
  const [olympics] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'olympics-men', name: 'Olympics Men', type: 'cup', tier: 2 })
    .returning();
  ids.olympicsMen = olympics!.id;
  await db.insert(providerMap).values({
    entityType: 'competition',
    entityId: olympics!.id,
    provider: 'api-sports',
    sport: 'football',
    providerId: '480',
  });
  await db.insert(season).values({
    competitionId: olympics!.id,
    label: '2024',
    year: 2024,
    startDate: '2024-07-24',
    endDate: '2024-08-10',
  });
  ids.palmeiras = await addClub('Palmeiras', 121);
  ids.corinthians = await addClub('Corinthians', 131);
  ids.saoPaulo = await addClub('Sao Paulo', 126);
  ids.fluminense = await addClub('Fluminense', 124);
  // Palmeiras × Fluminense não é clássico: o histórico geral vem da lista curada (head-to-head)
  ids.palmeirasFluminense = await addMatch(
    ids.palmeiras!,
    ids.fluminense!,
    new Date('2025-03-01T22:00:00Z'),
    {
      home: 2,
      away: 1,
    },
  );

  // Derby Paulista: Palmeiras 2 × 1 Corinthians (2024), Corinthians 0 × 4 Palmeiras (2023),
  // 1 × 1 (2022), Corinthians 2 × 0 Palmeiras (2021), 1 × 1 com pênaltis 4 × 3 (2020)
  const p = ids.palmeiras!;
  const c2 = ids.corinthians!;
  ids.m2024 = await addMatch(p, c2, new Date('2024-05-10T22:00:00Z'), { home: 2, away: 1 });
  ids.m2023 = await addMatch(c2, p, new Date('2023-08-20T19:00:00Z'), { home: 0, away: 4 });
  ids.m2022 = await addMatch(p, c2, new Date('2022-03-01T22:00:00Z'), { home: 1, away: 1 });
  ids.m2021 = await addMatch(c2, p, new Date('2021-07-01T22:00:00Z'), { home: 2, away: 0 });
  ids.m2020 = await addMatch(p, c2, new Date('2020-08-08T22:00:00Z'), {
    home: 1,
    away: 1,
    penalty: { home: 4, away: 3 },
  });
  // sem placar (não entra no retrospecto) e o próximo clássico, daqui a 3 dias
  await addMatch(p, c2, new Date('2019-01-01T22:00:00Z'), null);
  ids.next = await addMatch(c2, p, new Date(Date.now() + 3 * DAY), null, 'scheduled');
  // Choque-Rei daqui a 10 dias: fora da janela padrão de 7 dias
  ids.choque = await addMatch(ids.saoPaulo!, p, new Date(Date.now() + 10 * DAY), null, 'scheduled');
}

async function seedMultisportData() {
  await seedMultisport(db, '2026-10-21');
  await linkGamesCompetitions(db);
  await db
    .update(games)
    .set({ medalDataQuality: 'partial', medalCoverage: '0.8314' })
    .where(eq(games.slug, 'og-summer-2024'));
  await db
    .update(games)
    .set({ medalDataQuality: 'insufficient', medalCoverage: '0.0290' })
    .where(eq(games.slug, 'pan-2023'));
  const [og] = await db.select().from(games).where(eq(games.slug, 'og-summer-2024'));
  const [pan] = await db.select().from(games).where(eq(games.slug, 'pan-2023'));
  ids.og2024 = og!.id;

  const [judo, volley, swim, panJudo] = await db
    .insert(msEvent)
    .values([
      {
        gamesId: og!.id,
        disciplineCode: 'JUD',
        gender: 'W',
        name: { 'pt-BR': 'Judô +78 kg feminino', en: "Women's +78 kg" },
      },
      {
        gamesId: og!.id,
        disciplineCode: 'VBV',
        gender: 'W',
        isTeam: true,
        name: { 'pt-BR': 'Vôlei de praia feminino', en: "Women's beach volleyball" },
      },
      {
        gamesId: og!.id,
        disciplineCode: 'SWM',
        gender: 'M',
        name: { 'pt-BR': '100 m livre masculino', en: "Men's 100 m freestyle" },
      },
      {
        gamesId: pan!.id,
        disciplineCode: 'JUD',
        gender: 'M',
        name: { 'pt-BR': 'Judô -73 kg masculino', en: "Men's -73 kg" },
      },
    ])
    .returning();
  ids.judo = judo!.id;
  ids.swim = swim!.id;

  const people = await db
    .insert(msPerson)
    .values([
      { fullName: 'Atleta Judô BRA', gender: 'F' },
      { fullName: 'Atleta Praia 1', gender: 'F' },
      { fullName: 'Atleta Praia 2', gender: 'F' },
      { fullName: 'Atleta Natação ARG', gender: 'M' },
      { fullName: 'Atleta Judô FRA', gender: 'F' },
      { fullName: 'Atleta Pan BRA', gender: 'M' },
    ])
    .returning();
  const person = (name: string) => people.find((p) => p.fullName === name)!.id;
  const parts = await db
    .insert(msParticipant)
    .values([
      { kind: 'athlete', nocCode: 'BRA', personId: person('Atleta Judô BRA'), externalKey: 't:judo:bra' },
      { kind: 'team', nocCode: 'BRA', teamName: 'Brasil', externalKey: 't:bvo:bra' },
      { kind: 'athlete', nocCode: 'ARG', personId: person('Atleta Natação ARG'), externalKey: 't:swm:arg' },
      { kind: 'athlete', nocCode: 'FRA', personId: person('Atleta Judô FRA'), externalKey: 't:judo:fra' },
      { kind: 'athlete', nocCode: 'BRA', personId: person('Atleta Pan BRA'), externalKey: 't:pan:bra' },
    ])
    .returning();
  const part = (k: string) => parts.find((p) => p.externalKey === k)!.id;
  await db.insert(teamMember).values([
    { teamParticipantId: part('t:bvo:bra'), personId: person('Atleta Praia 1') },
    { teamParticipantId: part('t:bvo:bra'), personId: person('Atleta Praia 2') },
  ]);
  await db.insert(medal).values([
    {
      eventId: judo!.id,
      participantId: part('t:judo:bra'),
      nocCode: 'BRA',
      medal: 'G',
      awardedAt: '2024-08-02',
      source: 'wikidata',
      sourceKey: 't:1',
    },
    {
      eventId: judo!.id,
      participantId: part('t:judo:fra'),
      nocCode: 'FRA',
      medal: 'S',
      awardedAt: '2024-08-02',
      source: 'wikidata',
      sourceKey: 't:2',
    },
    {
      eventId: volley!.id,
      participantId: part('t:bvo:bra'),
      nocCode: 'BRA',
      medal: 'G',
      awardedAt: '2024-08-09',
      source: 'wikidata',
      sourceKey: 't:3',
    },
    {
      eventId: swim!.id,
      participantId: part('t:swm:arg'),
      nocCode: 'ARG',
      medal: 'B',
      awardedAt: '2024-07-31',
      source: 'wikidata',
      sourceKey: 't:4',
    },
    // revogada: não conta no quadro
    {
      eventId: swim!.id,
      participantId: part('t:judo:fra'),
      nocCode: 'FRA',
      medal: 'G',
      awardedAt: '2024-07-31',
      source: 'wikidata',
      sourceKey: 't:5',
      revokedAt: new Date('2025-01-01'),
    },
    {
      eventId: panJudo!.id,
      participantId: part('t:pan:bra'),
      nocCode: 'BRA',
      medal: 'G',
      awardedAt: '2023-10-25',
      source: 'wikidata',
      sourceKey: 't:6',
    },
  ]);

  // agenda: final do judô (medalha) às 16h e semifinal às 10h de Paris, 02/08; natação em 31/07
  const [final, semi] = await db
    .insert(phase)
    .values([
      { eventId: judo!.id, code: 'FNL', name: { 'pt-BR': 'Final', en: 'Final' }, order: 2 },
      { eventId: judo!.id, code: 'SFNL', name: { 'pt-BR': 'Semifinal', en: 'Semifinal' }, order: 1 },
    ])
    .returning();
  const [swimFinal] = await db
    .insert(phase)
    .values({ eventId: swim!.id, code: 'FNL', name: { 'pt-BR': 'Final', en: 'Final' } })
    .returning();
  const units = await db
    .insert(unit)
    .values([
      {
        phaseId: final!.id,
        odfRsc: 'T-JUD-FNL',
        startUtc: new Date('2024-08-02T14:00:00Z'),
        status: 'finished',
        isMedalUnit: true,
        venue: 'Champ-de-Mars Arena',
      },
      {
        phaseId: semi!.id,
        odfRsc: 'T-JUD-SFNL',
        startUtc: new Date('2024-08-02T08:00:00Z'),
        status: 'finished',
      },
      {
        phaseId: swimFinal!.id,
        odfRsc: 'T-SWM-FNL',
        startUtc: new Date('2024-07-31T18:30:00Z'),
        status: 'finished',
        isMedalUnit: true,
      },
    ])
    .returning();
  const u = (rsc: string) => units.find((x) => x.odfRsc === rsc)!.id;
  ids.judoFinalUnit = u('T-JUD-FNL');
  await db.insert(result).values([
    { unitId: u('T-JUD-FNL'), participantId: part('t:judo:bra'), rank: 1 },
    { unitId: u('T-JUD-FNL'), participantId: part('t:judo:fra'), rank: 2 },
    { unitId: u('T-JUD-SFNL'), participantId: part('t:judo:bra'), rank: 1 },
    {
      unitId: u('T-SWM-FNL'),
      participantId: part('t:swm:arg'),
      rank: 3,
      resultValue: '47.80',
      resultType: 'time',
    },
  ]);
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seedCore();
  // seed semântico depois dos eventos: liga perfis a participantes e preenche core.event.derby_id
  await seedSemantic(db, await loadKnowledge());
  // histórico geral fixo (não depende do que a base curada tiver no momento)
  await db
    .update(derby)
    .set({
      allTime: {
        matches: 100,
        draws: 30,
        teams: [
          { team: 'palmeiras', wins: 40, goals: 150 },
          { team: 'corinthians', wins: 30, goals: 120 },
        ],
        basis: 'all',
        as_of: '2025-11-01',
        sources: ['https://example.org/derby'],
        review_status: 'draft',
      },
    })
    .where(eq(derby.slug, 'derby-paulista'));
  await db
    .update(headToHead)
    .set({
      allTime: {
        matches: 12,
        draws: 2,
        teams: [
          { team: 'palmeiras', wins: 6, goals: 20 },
          { team: 'fluminense', wins: 4, goals: 15 },
        ],
        basis: 'all',
        as_of: '2025-11-01',
        sources: ['https://example.org/pal-flu'],
        review_status: 'draft',
      },
    })
    .where(eq(headToHead.slug, 'palmeiras-fluminense'));
  await seedMultisportData();

  const t = await upsertTenant(db, {
    slug: 'demo',
    name: 'Demo',
    plan: 'enterprise',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  const core = await upsertTenant(db, { slug: 'core', name: 'Core', plan: 'core_data' });
  coreOnlyKey = (await createApiKey(db, core.id, { env: 'test' })).key;

  // desenvolvimento local serve também o que ainda é draft (copy e glossário)
  app = buildServer({ db, redis, keyPrefix, semantic: { minReviewStatus: 'draft' } });
  prodApp = buildServer({ db, redis, keyPrefix: `${keyPrefix}prod:` });
  await app.ready();
  await prodApp.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prodApp?.close();
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

describe('módulos e piso editorial', () => {
  it('rotas semânticas exigem o módulo semantic; multiesporte, multisport', async () => {
    for (const url of ['/v1/derbies', '/v1/glossary', '/v1/copy?intent=inform', '/v1/multisport/games']) {
      const res = await get(url, { 'x-galaxie-key': coreOnlyKey });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ code: 'MODULE_NOT_IN_PLAN' });
    }
  });

  it('padrão de produção (approved) não serve conteúdo draft; o cliente só endurece o piso', async () => {
    // perfis e clássicos revisados chegam à produção
    const derbies = (await get('/v1/derbies', {}, prodApp)).json().data;
    expect(derbies.length).toBeGreaterThan(50);
    expect(new Set(derbies.map((d: { review_status: string }) => d.review_status))).toEqual(
      new Set(['approved']),
    );
    const team = await get('/v1/teams/palmeiras/semantic', {}, prodApp);
    expect(team.statusCode).toBe(200);
    expect(team.json().review_status).toBe('approved');
    // o glossário ainda é draft: fica fora da produção
    expect((await get('/v1/glossary?locale=pt-BR', {}, prodApp)).json().data).toEqual([]);
    // pedir draft num servidor approved não afrouxa
    expect((await get('/v1/glossary?locale=pt-BR&min_review_status=draft', {}, prodApp)).json().data).toEqual(
      [],
    );
    // pedir approved num servidor draft endurece
    expect((await get('/v1/glossary?locale=pt-BR&min_review_status=approved')).json().data).toEqual([]);
    expect((await get('/v1/glossary?locale=pt-BR')).json().data.length).toBeGreaterThan(0);
  });
});

describe('/v1/derbies', () => {
  it('filtra por país e por time (slug ou UUID)', async () => {
    const br = (await get('/v1/derbies?country=br')).json().data as {
      slug: string;
      teams: { slug: string }[];
    }[];
    expect(br.map((d) => d.slug)).toEqual(
      expect.arrayContaining(['derby-paulista', 'choque-rei', 'fla-flu']),
    );
    expect(br.every((d) => d.teams.length === 2)).toBe(true);
    const bySlug = (await get('/v1/derbies?team=palmeiras')).json().data as { slug: string }[];
    const byId = (await get(`/v1/derbies?team=${ids.palmeiras}`)).json().data as { slug: string }[];
    expect(byId).toEqual(bySlug);
    expect(bySlug.map((d) => d.slug)).toEqual(expect.arrayContaining(['derby-paulista', 'choque-rei']));
    expect((await get('/v1/derbies?team=time-inexistente')).statusCode).toBe(404);
  });

  it('localiza o nome, envia Content-Language e cacheia 24 h com ETag/304', async () => {
    const res = await get('/v1/derbies?country=AR&locale=es-AR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('es-AR');
    expect(res.headers['cache-control']).toContain('s-maxage=86400');
    const again = await get('/v1/derbies?country=AR&locale=es-AR', {
      'if-none-match': String(res.headers.etag),
    });
    expect(again.statusCode).toBe(304);
  });

  it('/upcoming: clássicos dos próximos 7 dias a partir de core.event.derby_id', async () => {
    const week = (await get('/v1/derbies/upcoming')).json().data as {
      event_id: string;
      derby: { slug: string };
    }[];
    expect(week.map((e) => e.event_id)).toEqual([ids.next]);
    expect(week[0]!.derby.slug).toBe('derby-paulista');
    const month = (await get('/v1/derbies/upcoming?days=30&tz=America/Sao_Paulo')).json().data as {
      event_id: string;
      starts_at: string;
      participants: { slug: string | null }[];
    }[];
    expect(month.map((e) => e.event_id)).toEqual([ids.next, ids.choque]);
    expect(month[0]!.starts_at).toMatch(/-03:00$/);
    expect(month[1]!.participants.map((p) => p.slug)).toEqual(['sao-paulo', 'palmeiras']);
    expect((await get('/v1/derbies/upcoming?country=AR')).json().data).toEqual([]);
  });

  it('/{slug}: retrospecto calculado só do core (V/E/D, gols, goleadas, últimos 5)', async () => {
    const res = await get('/v1/derbies/derby-paulista?tz=America/Sao_Paulo');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teams.map((t: { slug: string }) => t.slug).sort()).toEqual(['corinthians', 'palmeiras']);
    expect(body.next_event).toMatchObject({ event_id: ids.next, status: 'scheduled' });
    const r = body.retrospect;
    expect(r).toMatchObject({ available: true, source: 'core', matches: 5, draws: 2 });
    const team = (slug: string) => r.teams.find((t: { slug: string }) => t.slug === slug);
    expect(team('palmeiras')).toEqual({ slug: 'palmeiras', wins: 2, goals: 8 });
    expect(team('corinthians')).toEqual({ slug: 'corinthians', wins: 1, goals: 5 });
    expect(r.biggest_wins.map((m: { event_id: string }) => m.event_id)).toEqual([
      ids.m2023,
      ids.m2021,
      ids.m2024,
    ]);
    expect(r.last_5.map((m: { event_id: string }) => m.event_id)).toEqual([
      ids.m2024,
      ids.m2023,
      ids.m2022,
      ids.m2021,
      ids.m2020,
    ]);
    // pênaltis registrados, mas o jogo conta como empate
    expect(r.last_5[4]).toMatchObject({ winner: null, penalties: { home: 4, away: 3 } });
    expect(r.last_5[1]).toMatchObject({
      home: { slug: 'corinthians', score: 0 },
      away: { slug: 'palmeiras', score: 4 },
      winner: 'palmeiras',
    });
    expect(r.last_match_at).toBe('2024-05-10T19:00:00-03:00');
    expect(r.first_match_at).toBe('2020-08-08T19:00:00-03:00');
  });

  it('/{slug}: recorte da base com o ano e histórico geral curado à parte', async () => {
    const body = (await get('/v1/derbies/derby-paulista?tz=UTC')).json();
    expect(body.retrospect).toMatchObject({ scope: 'database', since: 2020, matches: 5 });
    expect(body.all_time).toEqual({
      matches: 100,
      draws: 30,
      teams: [
        { slug: 'palmeiras', wins: 40, goals: 150 },
        { slug: 'corinthians', wins: 30, goals: 120 },
      ],
      basis: 'all',
      as_of: '2025-11-01',
      sources: ['https://example.org/derby'],
      review_status: 'draft',
    });
    // piso de produção (approved): rascunho do histórico não sai
    expect((await get('/v1/derbies/derby-paulista?tz=UTC', {}, prodApp)).json().all_time).toBeNull();
  });

  it('h2h do jogo: recorte com o ano e o histórico geral do clássico por participante', async () => {
    const body = (await get(`/v1/events/${ids.m2024}/h2h`)).json();
    expect(body.summary).toMatchObject({ scope: 'database', since: 2020, played: 5 });
    expect(body.all_time).toMatchObject({
      derby: { slug: 'derby-paulista' },
      matches: 100,
      draws: 30,
      teams: [
        { id: ids.palmeiras, wins: 40, goals: 150 },
        { id: ids.corinthians, wins: 30, goals: 120 },
      ],
    });
    // par que não é clássico: histórico geral da lista curada, sem clássico de origem
    const pf = (await get(`/v1/events/${ids.palmeirasFluminense}/h2h`)).json();
    expect(pf.summary).toMatchObject({ since: 2025, played: 1 });
    expect(pf.all_time).toMatchObject({
      derby: null,
      matches: 12,
      teams: [
        { id: ids.palmeiras, wins: 6, goals: 20 },
        { id: ids.fluminense, wins: 4, goals: 15 },
      ],
    });
    // Choque-Rei ainda sem jogo encerrado na base: recorte vazio, sem ano
    const none = (await get(`/v1/events/${ids.choque}/h2h`)).json();
    expect(none.summary).toMatchObject({ played: 0, since: null });
    expect((await get(`/v1/events/${ids.m2024}/h2h`, {}, prodApp)).json().all_time).toBeNull();
  });

  it('/{slug}: clássico sem participantes ligados tem retrospecto indisponível; inexistente → 404', async () => {
    const res = (await get('/v1/derbies/fla-flu')).json();
    expect(res.retrospect).toMatchObject({ available: false, matches: 0, last_5: [] });
    expect((await get('/v1/derbies/nao-existe')).statusCode).toBe(404);
    expect((await get('/v1/derbies/Slug%20Ruim')).statusCode).toBe(400);
  });
});

describe('/v1/teams/{id}/semantic e /rivals', () => {
  it('cartão de identidade por slug ou UUID, com dicas de copy do mercado', async () => {
    const bySlug = await get('/v1/teams/palmeiras/semantic?locale=pt-BR');
    expect(bySlug.statusCode).toBe(200);
    const body = bySlug.json();
    expect(body).toMatchObject({
      slug: 'palmeiras',
      participant_id: ids.palmeiras,
      kind: 'club',
      country: 'BR',
      fans: { demonym: 'palmeirense' },
      rallying_cries: expect.arrayContaining(['Avanti, Palestra!']),
      review_status: 'approved',
    });
    expect(body.nicknames).toEqual(expect.arrayContaining(['Verdão']));
    expect(body.copy_hints.locale).toBe('pt-BR');
    expect(body.copy_hints.cheer.length).toBeGreaterThan(0);
    expect(body.rivals.map((r: { team: { slug: string } }) => r.team.slug)).toEqual(
      expect.arrayContaining(['corinthians', 'sao-paulo']),
    );
    const byId = await get(`/v1/teams/${ids.palmeiras}/semantic?locale=pt-BR`);
    expect(byId.json()).toEqual(body);
    expect((await get('/v1/teams/nao-existe/semantic')).statusCode).toBe(404);
  });

  it('textos livres no idioma do mercado: variante do país, es neutro e original (docs/06 §3.3)', async () => {
    const ar = (await get('/v1/teams/palmeiras/semantic?locale=es-AR')).json();
    expect(ar).toMatchObject({
      text_locale: 'es-AR',
      mascot: 'Porco (chancho)',
      colors: ['verde', 'blanco'],
    });
    expect(ar.identity[1]).toContain('hinchada');
    expect(ar.copy_hints).toMatchObject({
      locale: 'es-AR',
      cheer: expect.arrayContaining(['¡Aguante Palmeiras!']),
    });
    const mx = (await get('/v1/teams/palmeiras/semantic?locale=es-MX')).json();
    expect(mx).toMatchObject({ text_locale: 'es-MX', mascot: 'Porco (puerco)' });
    expect(mx.identity[1]).toContain('afición');
    // sem variante própria: cai no es neutro, campo a campo
    const corinthians = (await get('/v1/teams/corinthians/semantic?locale=es-CL')).json();
    expect(corinthians).toMatchObject({ text_locale: 'es', mascot: 'Mosqueteiro (mosquetero)' });
    const br = (await get('/v1/teams/palmeiras/semantic?locale=pt-BR')).json();
    expect(br).toMatchObject({ text_locale: 'pt-BR', mascot: 'Porco' });
    // original em espanhol: pt-BR usa a tradução, es-XX fica no original
    const boca = (await get('/v1/teams/boca-juniors/semantic?locale=pt-BR')).json();
    expect(boca.text_locale).toBe('pt-BR');
    expect(boca.identity[0]).toMatch(/La Boca/);
    // clube hispânico na voz do país em todo mercado de espanhol, com os gritos da torcida
    const bocaMx = (await get('/v1/teams/boca-juniors/semantic?locale=es-MX')).json();
    expect(bocaMx).toMatchObject({ text_locale: 'es-AR', copy_hints: { locale: 'es-AR' } });
    expect(bocaMx.identity[1]).toContain('cancha');
    expect(bocaMx.copy_hints.cheer).toContain('¡Dale, Bo!');
    const derby = (await get('/v1/derbies/classico-do-povo?locale=es-PE')).json();
    expect(derby).toMatchObject({
      text_locale: 'es-PE',
      origin: 'Reúne a las dos hinchadas más grandes de Brasil.',
    });
  });

  it('rivais ordenados por intensidade, com clássico e reciprocidade', async () => {
    const res = (await get('/v1/teams/palmeiras/rivals')).json();
    expect(res.team.slug).toBe('palmeiras');
    const first = res.data[0];
    expect(first).toMatchObject({
      team: { slug: 'corinthians', participant_id: ids.corinthians },
      derby: { slug: 'derby-paulista', intensity: 5 },
      intensity: 5,
      mutual: true,
    });
    const intensities = res.data.map((r: { intensity: number | null }) => r.intensity ?? 0);
    expect([...intensities].sort((a, b) => b - a)).toEqual(intensities);
  });
});

describe('/v1/glossary', () => {
  it('termos do mercado, com restrição de uso e filtro por categoria', async () => {
    const ar = (await get('/v1/glossary?locale=es-AR')).json();
    expect(ar).toMatchObject({ locale: 'es-AR', source_locale: 'es-AR' });
    expect(ar.data.map((t: { key: string }) => t.key)).toEqual(
      expect.arrayContaining(['hinchar-por', 'alentar']),
    );
    const br = (await get('/v1/glossary', { 'accept-language': 'pt-BR' })).json();
    const secar = br.data.find((t: { key: string }) => t.key === 'secar');
    expect(secar).toMatchObject({ category: 'rivalry', requires: 'declared_rival' });
    expect(secar.sources.length).toBeGreaterThan(0);
    const mx = (await get('/v1/glossary?locale=es-MX&category=support')).json();
    expect(mx.data.map((t: { key: string }) => t.key)).toEqual(['irle-a']);
    const co = (await get('/v1/glossary?locale=es-CO')).json();
    expect(co.data.map((t: { key: string }) => t.key)).toContain('hacer-fuerza');
    expect((await get('/v1/glossary?category=insulto')).statusCode).toBe(400);
  });
});

describe('/v1/copy (copy_permission)', () => {
  const copy = async (qs: string) => (await get(`/v1/copy?${qs}`)).json();

  it('rival inferido nunca recebe copy de rivalidade', async () => {
    const res = await copy(
      'intent=rivalry&tone=4&affinity_type=rival&affinity_source=inferred&team=palmeiras&rival=corinthians',
    );
    expect(res.permission).toMatchObject({ allowed_intents: ['inform'], max_tone: 1 });
    expect(res.selection).toMatchObject({ intent: 'inform', tone: 1, downgraded: true });
    expect(res.selection.text).not.toMatch(/secar/i);
  });

  it('rival declarado recebe rivalidade lúdica com o nome do rival preenchido', async () => {
    const res = await copy(
      'intent=rivalry&tone=3&affinity_type=rival&affinity_source=explicit&rival=corinthians',
    );
    expect(res.selection).toMatchObject({ intent: 'rivalry', downgraded: false, review_status: 'draft' });
    expect(res.selection.text).toContain('Corinthians');
  });

  it('time do coração declarado: identidade forte com apelido do mercado; sem fallback entre locales', async () => {
    const res = await copy(
      'intent=cheer&tone=4&affinity_type=heart&affinity_source=explicit&team=palmeiras&locale=pt-BR',
    );
    expect(res.selection).toMatchObject({ intent: 'cheer', tone: 4 });
    expect(res.selection.text).not.toContain('{');
    const ar = await copy('intent=cheer&tone=2&affinity_type=heart&affinity_source=explicit&locale=es-AR');
    expect(ar.locale).toBe('es-AR');
    expect(ar.selection.key.startsWith('es-AR.')).toBe(true);
    expect(ar.selection.text).toBeNull();
  });

  it('valida a intenção e responde 404 para time desconhecido', async () => {
    expect((await get('/v1/copy?intent=xingar')).statusCode).toBe(400);
    expect((await get('/v1/copy')).statusCode).toBe(400);
    expect((await get('/v1/copy?intent=inform&team=nao-existe')).statusCode).toBe(404);
  });
});

describe('/v1/multisport', () => {
  it('edições por tipo e ano, com o selo de qualidade', async () => {
    const res = (await get('/v1/multisport/games?type=og&year=2024')).json();
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      slug: 'og-summer-2024',
      type: 'OG',
      tz: 'Europe/Paris',
      medal_data_quality: { level: 'partial', coverage: 0.8314, publishable: true },
    });
    const pans = (await get('/v1/multisport/games?type=PAN')).json().data as { type: string }[];
    expect(pans.length).toBeGreaterThan(10);
    expect(pans.every((g) => g.type === 'PAN')).toBe(true);
    expect((await get('/v1/multisport/games?type=XYZ')).statusCode).toBe(400);
    const detail = (await get('/v1/multisport/games/og-summer-2024')).json();
    expect(detail.slug).toBe('og-summer-2024');
    // #78: o futebol olímpico do core aparece ligado à edição
    expect(detail.competitions).toEqual([
      expect.objectContaining({
        id: ids.olympicsMen,
        sport: 'football',
        gender: 'M',
        season: { year: 2024, label: '2024' },
        provider_league_id: '480',
      }),
    ]);
    expect((await get('/v1/multisport/games/nao-existe')).statusCode).toBe(404);
  });

  it('quadro de medalhas publicável: derivado, sem revogadas, por ouro ou total, com aviso e fonte', async () => {
    const res = await get('/v1/multisport/games/og-summer-2024/medals?locale=es-AR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=86400');
    const body = res.json();
    expect(body.data_quality).toMatchObject({ publishable: true, level: 'partial' });
    expect(body.data_quality.notice).toMatch(/Cuadro parcial/);
    expect(body.sources).toEqual([expect.objectContaining({ source: 'wikidata', license: 'CC0-1.0' })]);
    expect(body.data.map((r: { noc: { code: string } }) => r.noc.code)).toEqual(['BRA', 'FRA', 'ARG']);
    expect(body.data[0]).toMatchObject({ rank: 1, gold: 2, total: 2, noc: { name: 'Brasil', iso2: 'BR' } });
    expect(body.data[1]).toMatchObject({ noc: { code: 'FRA' }, gold: 0, silver: 1 });
    const latam = (await get('/v1/multisport/games/og-summer-2024/medals?region=latam&sort=total')).json();
    expect(latam.data.map((r: { noc: { code: string } }) => r.noc.code)).toEqual(['BRA', 'ARG']);
    expect(latam.data[1]).toMatchObject({ rank: 3, rank_by_total: 3 });
  });

  it('qualidade insuficiente: 200 sinalizado, sem linhas (nunca publica o quadro)', async () => {
    const body = (await get('/v1/multisport/games/pan-2023/medals')).json();
    expect(body.data_quality).toMatchObject({ level: 'insufficient', publishable: false });
    expect(body.data_quality.notice).toMatch(/insuficientes/);
    expect(body.data).toEqual([]);
    const future = (await get('/v1/multisport/games/pan-2027/medals')).json();
    expect(future.data_quality).toMatchObject({
      publishable: false,
      notice: 'Os Jogos ainda não começaram.',
    });
  });

  it('agenda: dia local no fuso da sede (ou no tz), esporte, CON, só medalha e cursor', async () => {
    const day = (await get('/v1/multisport/games/og-summer-2024/schedule?date=2024-08-02')).json();
    expect(day.data.map((u: { phase: { code: string } }) => u.phase.code)).toEqual(['SFNL', 'FNL']);
    expect(day.data[1]).toMatchObject({
      is_medal_unit: true,
      venue: 'Champ-de-Mars Arena',
      event: { id: ids.judo, discipline: { code: 'JUD', sport: { code: 'JUD' } } },
    });
    const paris = (
      await get('/v1/multisport/games/og-summer-2024/schedule?date=2024-08-02&tz=Europe/Paris')
    ).json();
    expect(paris.data[1].starts_at).toBe('2024-08-02T16:00:00+02:00');
    const medalOnly = (await get('/v1/multisport/games/og-summer-2024/schedule?medal_only=true')).json();
    expect(medalOnly.data).toHaveLength(2);
    const arg = (await get('/v1/multisport/games/og-summer-2024/schedule?noc=arg')).json();
    expect(arg.data.map((u: { event: { id: string } }) => u.event.id)).toEqual([ids.swim]);
    const swm = (await get('/v1/multisport/games/og-summer-2024/schedule?sport=AQU')).json();
    expect(swm.data).toHaveLength(1);

    const p1 = (await get('/v1/multisport/games/og-summer-2024/schedule?limit=2')).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.next_cursor).toBeTruthy();
    const p2 = (
      await get(`/v1/multisport/games/og-summer-2024/schedule?limit=2&cursor=${p1.next_cursor}`)
    ).json();
    expect(p2.data).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();
    const all = [...p1.data, ...p2.data].map((u: { id: string }) => u.id);
    expect(new Set(all).size).toBe(3);
    expect((await get('/v1/multisport/games/pan-2027/schedule')).json()).toEqual({
      data: [],
      next_cursor: null,
    });
  });

  it('prova: fases, unidades, resultados e medalhas (com revogadas marcadas)', async () => {
    const res = await get(`/v1/multisport/games/og-summer-2024/events/${ids.swim}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: ids.swim,
      games: { slug: 'og-summer-2024' },
      discipline: { code: 'SWM' },
    });
    expect(body.phases[0].units[0].results[0]).toMatchObject({
      rank: 3,
      value: '47.80',
      participant: { noc: 'ARG' },
    });
    expect(body.medals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ medal: 'G', revoked: true }),
        expect.objectContaining({
          medal: 'B',
          revoked: false,
          noc: expect.objectContaining({ code: 'ARG' }),
        }),
      ]),
    );
    expect((await get(`/v1/multisport/games/pan-2023/events/${ids.swim}`)).statusCode).toBe(404);
  });

  it('delegação: atletas com medalhas individuais e por equipe', async () => {
    const res = (await get('/v1/multisport/games/og-summer-2024/nocs/bra/athletes')).json();
    expect(res.noc).toMatchObject({ code: 'BRA' });
    expect(res.data.map((a: { name: string }) => a.name)).toEqual([
      'Atleta Judô BRA',
      'Atleta Praia 1',
      'Atleta Praia 2',
    ]);
    expect(res.data[0].medals).toEqual({ gold: 1, silver: 0, bronze: 0, total: 1 });
    expect((await get('/v1/multisport/games/og-summer-2024/nocs/XXX/athletes')).statusCode).toBe(404);
  });

  it('"Brasil hoje": unidades e medalhas do dia', async () => {
    const res = (await get('/v1/multisport/games/og-summer-2024/today/BRA?date=2024-08-02')).json();
    expect(res).toMatchObject({
      date: '2024-08-02',
      tz: 'Europe/Paris',
      medal_chances: null,
      where_to_watch: null,
    });
    expect(res.units.map((u: { phase: { code: string } }) => u.phase.code)).toEqual(['SFNL', 'FNL']);
    expect(res.medals).toEqual([
      expect.objectContaining({ medal: 'G', event: expect.objectContaining({ id: ids.judo }) }),
    ]);
    const pan = (await get('/v1/multisport/games/pan-2023/today/BRA?date=2023-10-25')).json();
    expect(pan.medals).toEqual([]);
    expect(pan.medal_data_quality.publishable).toBe(false);
  });

  it('histórico por país: só edições publicáveis, totais e edições retidas', async () => {
    const res = (await get('/v1/multisport/history/medals?noc=BRA&type=OG,PAN')).json();
    expect(res.nocs).toEqual([{ code: 'BRA', name: 'Brasil', iso2: 'BR' }]);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ games: { slug: 'og-summer-2024' }, gold: 2, total: 2 });
    expect(res.totals).toEqual([{ noc: 'BRA', gold: 2, silver: 0, bronze: 0, total: 2 }]);
    expect(res.withheld).toEqual([
      expect.objectContaining({
        slug: 'pan-2023',
        data_quality: expect.objectContaining({ publishable: false }),
      }),
    ]);
    const og = (await get('/v1/multisport/history/medals?noc=BRA&type=OG')).json();
    expect(og.withheld).toEqual([]);
    expect((await get('/v1/multisport/history/medals')).statusCode).toBe(400);
    expect((await get('/v1/multisport/history/medals?noc=ZZZ')).statusCode).toBe(404);
  });
});
