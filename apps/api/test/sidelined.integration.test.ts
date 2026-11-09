import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { EventSidelined, TeamSidelined } from '@galaxie/contracts';
import {
  apiResponse,
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventParticipant,
  footballFixture,
  participant,
  person,
  personSidelined,
  providerMap,
  roster,
  runMigrations,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Desfalques (issue #830): `/v1/events/{id}/sidelined` junta a lista `injuries` do fornecedor (só no raw) com o
 * histórico `core.person_sidelined` dos elencos; `/v1/teams/{id}/sidelined` mostra os afastamentos de hoje e a
 * lista do próximo jogo. Nenhuma chamada ao fornecedor.
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
const NOW = new Date('2026-11-06T15:00:00Z');
const KICKOFF = new Date('2026-11-08T19:00:00Z');
const FIXTURE = 9001;

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

async function insertRaw(
  params: Record<string, string>,
  response: unknown[],
  fetchedAt: Date,
  endpoint = '/injuries',
) {
  const body = { get: endpoint.slice(1), parameters: params, errors: [], results: response.length, response };
  await db.insert(apiResponse).values({
    provider: 'api-sports',
    sport: 'football',
    apiVersion: 'v3',
    endpoint,
    params,
    requestHash: createHash('sha256')
      .update(`${endpoint}${JSON.stringify(params)}`)
      .digest('hex'),
    statusCode: 200,
    results: response.length,
    errors: [],
    body,
    bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    fetchedAt,
    jobId: 'teste',
  });
}

const injury = (playerId: number, name: string, teamId: number, type: string, reason: string) => ({
  player: { id: playerId, name, photo: `https://media.test/players/${playerId}.png`, type, reason },
  team: { id: teamId, name: teamId === 1 ? 'Aurora' : 'Boreal', logo: null },
  fixture: { id: FIXTURE, timezone: 'UTC', date: KICKOFF.toISOString(), timestamp: KICKOFF.getTime() / 1000 },
  league: { id: 71, season: 2026, name: 'Serie A' },
});

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values({ code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga', name: 'Liga', countryCode: 'BR', type: 'league', tier: 1 })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026, current: true })
    .returning();
  const [aurora, boreal] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Aurora', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Boreal', countryCode: 'BR' },
    ])
    .returning();
  ids.aurora = aurora!.id;
  ids.boreal = boreal!.id;
  const people = await db
    .insert(person)
    .values([
      { name: 'Ana Atacante' },
      { name: 'Bruno Zagueiro' },
      { name: 'Caio Meia' },
      { name: 'Davi Goleiro' },
    ])
    .returning();
  const [ana, bruno, caio, davi] = people;
  ids.ana = ana!.id;
  ids.bruno = bruno!.id;
  ids.caio = caio!.id;
  ids.davi = davi!.id;
  await db.insert(providerMap).values([
    {
      entityType: 'participant',
      entityId: aurora!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '1',
    },
    {
      entityType: 'participant',
      entityId: boreal!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '2',
    },
    { entityType: 'person', entityId: ana!.id, provider: 'api-sports', sport: 'football', providerId: '101' },
    {
      entityType: 'person',
      entityId: bruno!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '102',
    },
    {
      entityType: 'person',
      entityId: caio!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '103',
    },
    {
      entityType: 'person',
      entityId: davi!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '201',
    },
  ]);
  await db.insert(roster).values([
    { participantId: aurora!.id, personId: ana!.id, role: 'player', number: 9, position: 'Attacker' },
    { participantId: aurora!.id, personId: bruno!.id, role: 'player', number: 4, position: 'Defender' },
    { participantId: aurora!.id, personId: caio!.id, role: 'player', number: 10, position: 'Midfielder' },
    { participantId: boreal!.id, personId: davi!.id, role: 'player', number: 1, position: 'Goalkeeper' },
  ]);
  await db.insert(personSidelined).values([
    // Ana: lesão em aberto, com previsão de volta (também na lista do jogo: herda as datas)
    { personId: ana!.id, type: 'Hamstring Injury', startDate: '2026-10-25', endDate: '2026-11-20' },
    // Caio: suspensão que já acabou (não entra)
    { personId: caio!.id, type: 'Red Card', startDate: '2026-10-01', endDate: '2026-10-08' },
    // Bruno: lesão aberta, sem fim, recente (só no histórico)
    { personId: bruno!.id, type: 'Knee Injury', startDate: '2026-10-30', endDate: null },
  ]);
  // o histórico foi consultado ao fornecedor há 2 dias (fresco)
  await insertRaw({ players: '101-102-103' }, [], new Date('2026-11-04T03:00:00Z'), '/sidelined');
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      seasonId: s!.id,
      startsAt: KICKOFF,
      endsAtExpected: new Date(KICKOFF.getTime() + 2 * 3_600_000),
      status: 'scheduled',
    })
    .returning();
  ids.event = ev!.id;
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: aurora!.id, side: 'home' },
    { eventId: ev!.id, participantId: boreal!.id, side: 'away' },
  ]);
  await db.insert(footballFixture).values({
    eventId: ev!.id,
    providerFixtureId: FIXTURE,
    summary: { fixture: { id: FIXTURE }, league: { id: 71, season: 2026 } },
  });
  const [cometa] = await db
    .insert(participant)
    .values({ sport: 'football', kind: 'club', name: 'Cometa', countryCode: 'BR' })
    .returning();
  const [ev2] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      seasonId: s!.id,
      startsAt: new Date('2026-11-20T19:00:00Z'),
      endsAtExpected: new Date('2026-11-20T21:00:00Z'),
      status: 'scheduled',
    })
    .returning();
  ids.event2 = ev2!.id;
  await db.insert(eventParticipant).values([
    { eventId: ev2!.id, participantId: boreal!.id, side: 'home' },
    { eventId: ev2!.id, participantId: cometa!.id, side: 'away' },
  ]);
  await db
    .insert(footballFixture)
    .values({ eventId: ev2!.id, providerFixtureId: 9002, summary: { fixture: { id: 9002 } } });
  // o terceiro jogo não tem lista: a da liga dele saiu depois, mas só com outro jogo
  const [ev3] = await db
    .insert(event)
    .values({
      sport: 'football',
      startsAt: new Date('2026-11-21T19:00:00Z'),
      endsAtExpected: new Date('2026-11-21T21:00:00Z'),
      status: 'scheduled',
    })
    .returning();
  ids.event3 = ev3!.id;
  await db.insert(eventParticipant).values([
    { eventId: ev3!.id, participantId: boreal!.id, side: 'home' },
    { eventId: ev3!.id, participantId: cometa!.id, side: 'away' },
  ]);
  await db.insert(footballFixture).values({
    eventId: ev3!.id,
    providerFixtureId: 9003,
    summary: { fixture: { id: 9003 }, league: { id: 72, season: 2026 } },
  });
  await insertRaw(
    { league: '72', season: '2026' },
    [{ ...injury(998, 'Outra Liga', 2, 'Missing Fixture', 'Knock'), fixture: { id: 4321 } }],
    new Date('2026-11-06T12:00:00Z'),
  );
  // e a lista do dia dele saiu sem ele (liga sem cobertura de lesões): também não conta como vazia
  await insertRaw(
    { date: '2026-11-21' },
    [{ ...injury(997, 'Outro Dia', 2, 'Missing Fixture', 'Knock'), fixture: { id: 5432 } }],
    new Date('2026-11-06T13:00:00Z'),
  );
  // lista do jogo 9002 publicada e vazia
  await insertRaw({ fixture: '9002' }, [], new Date('2026-11-06T06:00:00Z'));
  // a lista da temporada (mais antiga) e a do dia (mais nova, sem o Davi como dúvida → agora fora)
  await insertRaw(
    { league: '71', season: '2026' },
    [
      injury(101, 'A. Atacante', 1, 'Missing Fixture', 'Hamstring Injury'),
      injury(201, 'D. Goleiro', 2, 'Questionable', 'Knock'),
      // Caio estava na lista antiga e saiu da nova: voltou, não pode aparecer
      injury(103, 'C. Meia', 1, 'Missing Fixture', 'Thigh Injury'),
      { ...injury(999, 'Outro Jogo', 2, 'Missing Fixture', 'Illness'), fixture: { id: 1234 } },
    ],
    new Date('2026-11-01T06:00:00Z'),
  );
  await insertRaw(
    { date: '2026-11-08' },
    [
      injury(101, 'A. Atacante', 1, 'Missing Fixture', 'Hamstring Injury'),
      injury(201, 'D. Goleiro', 2, 'Missing Fixture', 'Yellow Cards'),
      injury(301, 'Sem Cadastro', 2, 'Questionable', 'Illness'),
    ],
    new Date('2026-11-06T06:00:00Z'),
  );

  // Cobertura: Eclipse só tem histórico encerrado, Galáxia tem afastamento em aberto, Farol não tem dado nenhum.
  const [eclipse, farol, galaxia] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Eclipse', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Farol', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Galáxia', countryCode: 'BR' },
    ])
    .returning();
  ids.eclipse = eclipse!.id;
  ids.farol = farol!.id;
  ids.galaxia = galaxia!.id;
  const [elias, gil] = await db
    .insert(person)
    .values([{ name: 'Elias Lateral' }, { name: 'Gil Volante' }])
    .returning();
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: eclipse!.id,
    provider: 'api-sports',
    sport: 'football',
    providerId: '11',
  });
  await db.insert(roster).values([
    { participantId: eclipse!.id, personId: elias!.id, role: 'player', number: 2, position: 'Defender' },
    { participantId: galaxia!.id, personId: gil!.id, role: 'player', number: 5, position: 'Midfielder' },
  ]);
  await db.insert(personSidelined).values([
    { personId: elias!.id, type: 'Knee Injury', startDate: '2025-02-01', endDate: '2025-03-01' },
    { personId: gil!.id, type: 'Ankle Injury', startDate: '2026-11-01', endDate: '2026-12-01' },
  ]);
  const game = async (
    name: string,
    fixture: number,
    startsAt: string,
    home: string,
    away: string,
    league?: { id: number; season: number },
  ) => {
    const starts = new Date(startsAt);
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'football',
        startsAt: starts,
        endsAtExpected: new Date(starts.getTime() + 2 * 3_600_000),
        status: 'scheduled',
      })
      .returning();
    ids[name] = ev!.id;
    await db.insert(eventParticipant).values([
      { eventId: ev!.id, participantId: home, side: 'home' },
      { eventId: ev!.id, participantId: away, side: 'away' },
    ]);
    await db.insert(footballFixture).values({
      eventId: ev!.id,
      providerFixtureId: fixture,
      summary: { fixture: { id: fixture }, ...(league ? { league } : {}) },
    });
  };
  await game('semCobertura', 9004, '2026-11-10T19:00:00Z', eclipse!.id, farol!.id);
  await game('soUmLado', 9005, '2026-11-11T19:00:00Z', galaxia!.id, farol!.id);
  await game('listaVencida', 9006, '2026-11-12T19:00:00Z', eclipse!.id, farol!.id, {
    id: 73,
    season: 2026,
  });
  await game('jaIniciado', 9010, '2026-11-05T19:00:00Z', eclipse!.id, farol!.id, { id: 74, season: 2026 });
  // jogo já iniciado: a da liga (mais antiga) traz o jogo; a do dia (mais nova) não traz mais
  await insertRaw(
    { league: '74', season: '2026' },
    [{ ...injury(403, 'E. Volante', 11, 'Missing Fixture', 'Knock'), fixture: { id: 9010 } }],
    new Date('2026-11-02T06:00:00Z'),
  );
  await insertRaw(
    { date: '2026-11-05' },
    [{ ...injury(995, 'Outro Jogo', 2, 'Missing Fixture', 'Knock'), fixture: { id: 7654 } }],
    new Date('2026-11-06T06:00:00Z'),
  );
  await game('listaDeUmTime', 9007, '2026-11-13T19:00:00Z', eclipse!.id, farol!.id);
  await game('listaVazia', 9008, '2026-11-14T19:00:00Z', eclipse!.id, farol!.id);
  await game('respostaComErro', 9009, '2026-11-15T19:00:00Z', eclipse!.id, farol!.id);
  // a da liga (mais antiga) traz o jogo; a do dia (mais nova) não traz mais: a lista antiga deixou de valer
  await insertRaw(
    { league: '73', season: '2026' },
    [{ ...injury(401, 'E. Lateral', 11, 'Missing Fixture', 'Knock'), fixture: { id: 9006 } }],
    new Date('2026-11-02T06:00:00Z'),
  );
  await insertRaw(
    { date: '2026-11-12' },
    [{ ...injury(996, 'Outro Jogo', 2, 'Missing Fixture', 'Knock'), fixture: { id: 6543 } }],
    new Date('2026-11-06T06:00:00Z'),
  );
  // lista do dia com o jogo, mas só com jogador de um dos times
  await insertRaw(
    { date: '2026-11-13' },
    [{ ...injury(402, 'E. Ponta', 11, 'Missing Fixture', 'Knock'), fixture: { id: 9007 } }],
    new Date('2026-11-06T06:00:00Z'),
  );
  await insertRaw({ fixture: '9008' }, [], new Date('2026-11-06T06:00:00Z'));
  // o fornecedor respondeu 200 com erro e lista vazia: não é "lista publicada"
  await insertRaw({ fixture: '9009' }, [], new Date('2026-11-06T06:00:00Z'));
  await db.execute(
    sql`update raw.api_response set errors = '{"rateLimit":"limite"}'::jsonb where params->>'fixture' = '9009'`,
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
    slug: 'desfalques',
    name: 'Desfalques',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'desfalques' })).key;
  app = buildServer({ db, redis, cdnPurger: new RecordingCdnPurger(), now: () => NOW, keyPrefix });
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

describe('GET /v1/events/{id}/sidelined', () => {
  it('junta a lista do jogo (a mais recente) com o histórico dos elencos, por time', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.event}/sidelined?locale=pt-BR`);
    expect(body.available).toBe(true);
    expect(body.teams.map((t) => [t.team.id, t.team.side])).toEqual([
      [ids.aurora, 'home'],
      [ids.boreal, 'away'],
    ]);
    const [home, away] = body.teams;
    // Ana (jogo + histórico, com datas), Bruno (só histórico, sem previsão); Caio já voltou
    expect(home!.players.map((p) => p.person.name)).toEqual(['Bruno Zagueiro', 'Ana Atacante']);
    expect(home!.players[1]).toMatchObject({
      person: { id: ids.ana },
      number: 9,
      position: 'Attacker',
      status: 'out',
      category: 'injury',
      reason: 'Hamstring Injury',
      reason_label: 'Lesão na coxa (posterior)',
      since: '2026-10-25',
      until: '2026-11-20',
      source: 'match',
    });
    expect(home!.players[0]).toMatchObject({
      source: 'history',
      until: null,
      reason_label: 'Lesão no joelho',
    });
    // Davi: a lista do dia (suspenso) vence a da temporada (dúvida); quem não está no core vem com o nome do fornecedor
    expect(away!.players).toMatchObject([
      { person: { id: ids.davi, name: 'Davi Goleiro' }, status: 'out', category: 'suspension' },
      {
        person: { id: null, name: 'Sem Cadastro' },
        status: 'doubtful',
        category: 'illness',
        reason_label: 'Doença',
      },
    ]);
  });

  it('o motivo sai no idioma pedido', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.event}/sidelined?locale=es-AR`);
    expect(body.teams[1]!.players[0]!.reason_label).toBe('Tarjetas amarillas');
  });
});

describe('disponibilidade', () => {
  it('lista publicada e vazia: disponível, sem ninguém (times sem histórico)', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.event2}/sidelined`);
    expect(body.available).toBe(true);
    expect(body.teams.flatMap((t) => t.players)).toEqual([]);
  });

  it('sem lista e sem histórico: indisponível (as listas da liga e do dia sem o jogo não contam como vazias)', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.event3}/sidelined`);
    expect(body.available).toBe(false);
  });

  it('histórico encerrado de um time não é cobertura: o jogo e o adversário sem dado ficam indisponíveis', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.semCobertura}/sidelined`);
    expect(body.available).toBe(false);
    expect(body.teams.map((t) => [t.team.id, t.available, t.players])).toEqual([
      [ids.eclipse, false, []],
      [ids.farol, false, []],
    ]);
  });

  it('sem lista, com afastamento em aberto só de um time: ele aparece e o adversário fica desconhecido', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.soUmLado}/sidelined`);
    expect(body.available).toBe(true);
    const [home, away] = body.teams;
    expect(home).toMatchObject({ available: true, players: [{ person: { name: 'Gil Volante' } }] });
    expect(away).toMatchObject({ team: { id: ids.farol }, available: false, players: [] });
  });

  it('cobertura real e lista vazia: "nenhum desfalque", mesmo com histórico encerrado', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.listaVazia}/sidelined`);
    expect(body.available).toBe(true);
    expect(body.teams.map((t) => [t.available, t.players])).toEqual([
      [true, []],
      [true, []],
    ]);
  });

  it('lista do jogo com jogador de um time só: vale para os dois', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.listaDeUmTime}/sidelined`);
    expect(body.available).toBe(true);
    const [home, away] = body.teams;
    expect(home).toMatchObject({ available: true, players: [{ person: { name: 'E. Ponta' } }] });
    expect(away).toMatchObject({ team: { id: ids.farol }, available: true, players: [] });
  });

  it('jogo futuro: a resposta mais recente sem o jogo derruba a mais antiga com ele e fica desconhecido', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.listaVencida}/sidelined`);
    expect(body.available).toBe(false);
    expect(body.teams.flatMap((t) => t.players)).toEqual([]);
  });

  it('jogo já iniciado: a resposta mais recente sem o jogo não apaga a última foto dele', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.jaIniciado}/sidelined`);
    expect(body.available).toBe(true);
    const [home, away] = body.teams;
    expect(home).toMatchObject({ available: true, players: [{ person: { name: 'E. Volante' } }] });
    expect(away).toMatchObject({ team: { id: ids.farol }, available: true, players: [] });
  });

  it('resposta do fornecedor com erro não conta como lista publicada', async () => {
    const body = await get<EventSidelined>(`/v1/events/${ids.respostaComErro}/sidelined`);
    expect(body.available).toBe(false);
  });
});

describe('GET /v1/teams/{id}/sidelined', () => {
  it('afastamentos de hoje e a lista do próximo jogo do time', async () => {
    const body = await get<TeamSidelined>(`/v1/teams/${ids.aurora}/sidelined`);
    expect(body).toMatchObject({
      team: { id: ids.aurora, name: 'Aurora' },
      as_of: '2026-11-06',
      next_event_id: ids.event,
    });
    expect(body.players.map((p) => [p.person.name, p.source])).toEqual([
      ['Bruno Zagueiro', 'history'],
      ['Ana Atacante', 'match'],
    ]);
  });

  it('com histórico ou lista: disponível', async () => {
    const body = await get<TeamSidelined>(`/v1/teams/${ids.aurora}/sidelined`);
    expect(body.available).toBe(true);
  });

  it('só histórico encerrado e sem lista do próximo jogo: indisponível', async () => {
    const body = await get<TeamSidelined>(`/v1/teams/${ids.eclipse}/sidelined`);
    expect(body).toMatchObject({ next_event_id: ids.semCobertura, available: false, players: [] });
  });

  it('afastamento em aberto, sem lista do próximo jogo: disponível, com o jogador', async () => {
    const body = await get<TeamSidelined>(`/v1/teams/${ids.galaxia}/sidelined`);
    expect(body).toMatchObject({ available: true, players: [{ person: { name: 'Gil Volante' } }] });
  });

  it('só a lista do próprio time entra', async () => {
    const body = await get<TeamSidelined>(`/v1/teams/${ids.boreal}/sidelined`);
    expect(body.players.map((p) => p.person.name)).toEqual(['Davi Goleiro', 'Sem Cadastro']);
  });

  it('histórico parado (sem consulta ao fornecedor há mais de 14 dias): fica de fora, vale só a lista do jogo', async () => {
    await db.execute(
      sql`update raw.api_response set fetched_at = '2026-09-17T03:00:00Z', last_seen_at = null where endpoint = '/sidelined'`,
    );
    try {
      const body = await get<TeamSidelined>(`/v1/teams/${ids.aurora}/sidelined?locale=en`);
      expect(body.available).toBe(true);
      expect(body.players.map((p) => [p.person.name, p.source])).toEqual([['Ana Atacante', 'match']]);
    } finally {
      await db.execute(
        sql`update raw.api_response set fetched_at = '2026-11-04T03:00:00Z' where endpoint = '/sidelined'`,
      );
    }
  });

  it('time inexistente: 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/teams/0199a5c0-0000-7000-8000-00000000ffff/sidelined',
      headers: { 'x-galaxie-key': key },
    });
    expect(res.statusCode).toBe(404);
  });
});
