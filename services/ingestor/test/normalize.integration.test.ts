import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, asc, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiSportsClient,
  defaultPolicy,
  normalizeParams,
  PgQuotaGovernor,
  PgRawStore,
  RateLimiter,
  requestHash,
} from '@galaxie/apisports-client';
import {
  apiResponse,
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventIncident,
  eventParticipant,
  eventStateLog,
  footballFixture,
  jobRun,
  participant,
  person,
  providerMap,
  roster,
  runMigrations,
  season,
  sport,
  stage,
  standing,
  venue,
  type Database,
} from '@galaxie/db';
import {
  ApiSportsProvider,
  emptyBatch,
  expectedEnd,
  FakeProvider,
  normalizeFixtures,
  normalizeTeams,
  type ApiFixture,
  type ApiTeamItem,
  type NormalizedBatch,
} from '@galaxie/providers';
import { advanceEventClock, applyProviderFailure } from '../src/normalize/event-state.js';
import { deriveProviderNames } from '../src/normalize/name-history.js';
import { ingestProviderResult } from '../src/normalize/ingest.js';
import { normalizeFootballFromRaw, runNormalizeFootballJob } from '../src/normalize/raw-runner.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const FIXTURES = new URL('../../../packages/providers/test/fixtures/api-sports/football/', import.meta.url);
function fixture<T = { get: string; parameters: Record<string, string>; response: unknown[] }>(
  name: string,
): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
}

let admin: postgres.Sql;
let db: Database;

async function insertRaw(
  name: string,
  endpoint: string,
  fetchedAt: string,
  overrides: { errors?: unknown; statusCode?: number; body?: unknown } = {},
) {
  const body = overrides.body ?? fixture(name);
  const env = body as { parameters: Record<string, string>; results?: number };
  const params = normalizeParams(env.parameters ?? {});
  const text = JSON.stringify(body);
  await db.insert(apiResponse).values({
    provider: 'api-sports',
    sport: 'football',
    apiVersion: 'v3',
    endpoint,
    params,
    requestHash: requestHash('api-sports', 'football', endpoint, params),
    statusCode: overrides.statusCode ?? 200,
    results: env.results ?? null,
    errors: overrides.errors ?? [],
    body,
    bodyHash: createHash('sha256').update(text).digest('hex'),
    fetchedAt: new Date(fetchedAt),
    jobId: 'teste',
  });
}

/** Retrato determinístico das tabelas do core (inclui updated_at: reprocessar não pode tocar nada). */
async function snapshot() {
  const ordered = async <T>(q: Promise<T[]>) => JSON.stringify(await q);
  return {
    competition: await ordered(db.select().from(competition).orderBy(asc(competition.id))),
    season: await ordered(db.select().from(season).orderBy(asc(season.id))),
    stage: await ordered(db.select().from(stage).orderBy(asc(stage.id))),
    venue: await ordered(db.select().from(venue).orderBy(asc(venue.id))),
    participant: await ordered(db.select().from(participant).orderBy(asc(participant.id))),
    person: await ordered(db.select().from(person).orderBy(asc(person.id))),
    event: await ordered(db.select().from(event).orderBy(asc(event.id))),
    eventParticipant: await ordered(
      db
        .select()
        .from(eventParticipant)
        .orderBy(asc(eventParticipant.eventId), asc(eventParticipant.participantId)),
    ),
    eventIncident: await ordered(db.select().from(eventIncident).orderBy(asc(eventIncident.id))),
    eventStateLog: await ordered(db.select().from(eventStateLog).orderBy(asc(eventStateLog.id))),
    footballFixture: await ordered(db.select().from(footballFixture).orderBy(asc(footballFixture.eventId))),
    roster: await ordered(
      db.select().from(roster).orderBy(asc(roster.participantId), asc(roster.personId), asc(roster.role)),
    ),
    standing: await ordered(db.select().from(standing).orderBy(asc(standing.participantId))),
    providerMap: await ordered(
      db.select().from(providerMap).orderBy(asc(providerMap.entityType), asc(providerMap.providerId)),
    ),
  };
}

async function eventIdOf(providerId: string, provider = 'api-sports'): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, provider),
        eq(providerMap.entityType, 'event'),
        eq(providerMap.providerId, providerId),
      ),
    );
  return row!.id;
}

async function eventRow(providerId: string) {
  const [row] = await db
    .select()
    .from(event)
    .where(eq(event.id, await eventIdOf(providerId)));
  return row!;
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });

  // catálogo mínimo: Série A no tier 1 (como o bootstrap do catálogo deixaria)
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } },
    { code: 'WORLD', name: { en: 'World' } },
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
    })
    .returning();
  await db.insert(season).values({ competitionId: serieA!.id, label: '2024', year: 2024 });
  await db.insert(providerMap).values({
    entityType: 'competition',
    entityId: serieA!.id,
    provider: 'api-sports',
    sport: 'football',
    providerId: '71',
  });

  // raw: respostas reais recortadas + sintéticas no formato v3, em ordem de coleta
  await insertRaw('fixtures-league-71-2024.json', '/fixtures', '2026-10-21T14:13:47Z');
  await insertRaw('fixtures-headtohead-121-131.json', '/fixtures/headtohead', '2026-10-21T14:14:08Z');
  await insertRaw('fixtures-date-2026-10-21.json', '/fixtures', '2026-10-21T14:13:54Z');
  await insertRaw('teams-country-brazil.json', '/teams', '2026-10-21T14:15:48Z');
  await insertRaw('players-squads-121.json', '/players/squads', '2026-10-21T14:15:33Z');
  await insertRaw('coachs-121.json', '/coachs', '2026-10-21T14:16:00Z');
  await insertRaw('standings-71-2024.json', '/standings', '2026-10-21T14:16:10Z');
  await insertRaw('players-team-121-2024.json', '/players', '2026-10-21T14:16:20Z');
  await insertRaw('fixtures-id-1492407.json', '/fixtures', '2026-10-21T14:17:00Z');
  // falha mais recente para a mesma requisição do detalhe: não pode apagar o último válido
  await insertRaw('fixtures-id-1492407.json', '/fixtures', '2026-10-21T15:00:00Z', {
    errors: { requests: 'You have reached the request limit for the day' },
    body: {
      get: 'fixtures',
      parameters: { id: '1492407' },
      errors: { requests: 'limite' },
      results: 0,
      response: [],
    },
  });
  // resposta 5xx de outro endpoint: ignorada
  await insertRaw('fixtures-date-2026-10-21.json', '/fixtures', '2026-10-21T15:01:00Z', {
    statusCode: 503,
    body: { get: 'fixtures', parameters: { date: '2026-10-22' }, errors: [], results: 0, response: [] },
  });
  // endpoint sem normalização: ignorado sem erro
  await insertRaw('players-squads-121.json', '/transfers', '2026-10-21T14:15:40Z', {
    body: { get: 'transfers', parameters: { team: '121' }, errors: [], results: 0, response: [] },
  });
}, 120_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('normalização raw → core (futebol)', () => {
  let first: Awaited<ReturnType<typeof snapshot>>;

  it('processa a última resposta bem-sucedida de cada requisição', async () => {
    const result = await normalizeFootballFromRaw(db);
    expect(result.rows.map((r) => [r.endpoint, r.outcome])).toEqual([
      ['/fixtures', 'ok'], // temporada (14:13:47)
      ['/fixtures', 'ok'], // dia (14:13:54)
      ['/fixtures/headtohead', 'ok'],
      ['/players/squads', 'ok'],
      ['/teams', 'ok'],
      ['/coachs', 'ok'],
      ['/standings', 'ok'],
      ['/players', 'ok'],
      ['/fixtures', 'ok'], // detalhe (14:17); a falha das 15:00 não conta
    ]);
    expect(result.stats.events.inserted).toBe(4 + 10 + 3);
    expect(result.stats.competitionsCreated).toBeGreaterThan(5); // ligas do dia que não estão no catálogo mínimo
    first = await snapshot();
  });

  it('evento canônico com estado, placar, fase, estádio e participantes', async () => {
    const e = await eventRow('1180355');
    expect(e).toMatchObject({
      sport: 'football',
      status: 'finished',
      statusDetail: 'FT',
      statusSource: 'provider',
      sourceProvider: 'api-sports',
      isStale: false,
      score: { home: 2, away: 1, halftime: { home: 0, away: 0 }, extratime: null, penalty: null },
      importance: 44, // tier 1 (40) + rodada de pontos corridos (4)
    });
    expect(e.lastValidAt?.toISOString()).toBe('2026-10-21T14:13:47.000Z');
    const [st] = await db.select().from(stage).where(eq(stage.id, e.stageId!));
    expect(st).toMatchObject({ kind: 'regular', providerLabel: 'Regular Season - 1', order: 2001 });
    expect(st!.name).toMatchObject({ 'pt-BR': 'Rodada 1' });
    const [v] = await db.select().from(venue).where(eq(venue.id, e.venueId!));
    expect(v?.name).toBe('Estádio 244');
    const parts = await db.select().from(eventParticipant).where(eq(eventParticipant.eventId, e.id));
    expect(parts.map((p) => p.side).sort()).toEqual(['away', 'home']);
    const [log] = await db.select().from(eventStateLog).where(eq(eventStateLog.eventId, e.id));
    expect(log).toMatchObject({ fromStatus: null, toStatus: 'finished', reason: 'provider' });
  });

  it('temporada nova é criada quando o raw a referencia (2026 da Série A)', async () => {
    const e = await eventRow('1492407');
    const [s] = await db.select().from(season).where(eq(season.id, e.seasonId!));
    expect(s).toMatchObject({ year: 2026, label: '2026' });
  });

  it('status do dia viram estados canônicos (pré-jogo avaliado no instante da coleta)', async () => {
    const statuses = await db.execute<{ detail: string; status: string }>(sql`
      select e.status_detail as detail, e.status::text as status
      from core.event e join core.provider_map pm on pm.entity_id = e.id and pm.entity_type = 'event'
      where e.starts_at::date = '2026-10-21' order by 1`);
    expect(Object.fromEntries(statuses.map((r) => [r.detail, r.status]))).toEqual({
      '1H': 'live',
      '2H': 'live',
      AET: 'finished',
      CANC: 'cancelled',
      FT: 'finished',
      INT: 'suspended',
      NS: 'scheduled',
      PEN: 'finished',
      PST: 'postponed',
      SUSP: 'suspended',
    });
  });

  it('detalhe: timeline com sequência estável, pessoas e espelho com escalações', async () => {
    const id = await eventIdOf('1492407');
    const incidents = await db
      .select()
      .from(eventIncident)
      .where(eq(eventIncident.eventId, id))
      .orderBy(asc(eventIncident.sequence));
    expect(incidents.map((i) => [i.sequence, i.type])).toEqual([
      [0, 'goal'],
      [1, 'card'],
      [2, 'own_goal'],
      [3, 'penalty_missed'],
      [4, 'subst'],
      [5, 'var'],
      [6, 'goal'],
      [7, 'goal'],
      [8, 'goal'],
    ]);
    expect(incidents[0]!.personId).not.toBeNull();
    expect(incidents[0]!.assistPersonId).not.toBeNull();
    const [ff] = await db.select().from(footballFixture).where(eq(footballFixture.eventId, id));
    expect(Object.keys(ff!.detail as object).sort()).toEqual(['events', 'lineups', 'players', 'statistics']);
    expect(ff!.detailFetchedAt?.toISOString()).toBe('2026-10-21T14:17:00.000Z');
    expect(ff!.referee).toBe('Árbitro Anônimo');
  });

  it('times, seleção, estádio, elenco atual, técnico e classificação', async () => {
    const pid = async (providerId: string) =>
      (
        await db
          .select({ id: providerMap.entityId })
          .from(providerMap)
          .where(and(eq(providerMap.entityType, 'participant'), eq(providerMap.providerId, providerId)))
      )[0]!.id;
    const [brazil] = await db
      .select()
      .from(participant)
      .where(eq(participant.id, await pid('6')));
    expect(brazil).toMatchObject({ kind: 'national_team', code: 'BRA', countryCode: 'BR', founded: 1914 });
    const palmeiras = await pid('121');
    const [club] = await db.select().from(participant).where(eq(participant.id, palmeiras));
    expect(club).toMatchObject({ kind: 'club', name: 'Palmeiras', countryCode: 'BR' });
    expect(club!.homeVenueId).not.toBeNull();
    expect(club!.logoAssetId).not.toBeNull();

    const squad = await db.select().from(roster).where(eq(roster.participantId, palmeiras));
    expect(squad.filter((r) => r.role === 'player' && r.seasonId == null)).toHaveLength(4);
    expect(squad.filter((r) => r.role === 'coach')).toHaveLength(1);
    expect(squad.filter((r) => r.role === 'player' && r.seasonId != null)).toHaveLength(2); // players?team&season
    const table = await db.select().from(standing).orderBy(asc(standing.rank));
    expect(table.map((s) => [s.rank, s.points, s.source])).toEqual([
      [1, 73, 'provider'],
      [2, 65, 'provider'],
      [3, 56, 'provider'],
    ]);
  });

  it('reprocessar o raw inteiro de novo gera exatamente o mesmo estado', async () => {
    const again = await normalizeFootballFromRaw(db);
    expect(again.stats.events.inserted).toBe(0);
    expect(again.stats.events.updated).toBe(0);
    expect(again.stats.events.transitions).toBe(0);
    expect(await snapshot()).toEqual(first);
  });

  it('job incremental registra cursor e não reprocessa o que já foi visto', async () => {
    const full = await runNormalizeFootballJob(db, { full: true });
    expect(full.rows.length).toBeGreaterThan(0);
    const incremental = await runNormalizeFootballJob(db);
    expect(incremental.rows).toHaveLength(0);
    const runs = await db.select().from(jobRun).where(eq(jobRun.job, 'normalize:football'));
    expect(runs.every((r) => r.status === 'ok')).toBe(true);
    expect(await snapshot()).toEqual(first);
  });
});

describe('máquina de estados persistida', () => {
  it('correção finished → live quando a fonte normaliza (prorrogação)', async () => {
    const env = fixture<{ response: ApiFixture[] }>('fixtures-id-1492407.json');
    const f = structuredClone(env.response[0]!);
    // jogo remarcado para hoje às 15:00 e, às 16:50, a fonte informa prorrogação
    f.fixture.date = '2026-10-21T15:00:00+00:00';
    f.fixture.timestamp = Date.parse(f.fixture.date) / 1000;
    f.fixture.periods = { first: f.fixture.timestamp, second: null };
    f.fixture.status = { long: 'Extra Time', short: 'ET', elapsed: 95, extra: null };
    const batch = normalizeFixtures([f], new Date('2026-10-21T16:50:00Z'));
    const stats = await upsertBatch(db, batch);
    expect(stats.events.transitions).toBe(1);
    const e = await eventRow('1492407');
    expect(e).toMatchObject({ status: 'live', statusDetail: 'ET', isStale: false });
    const logs = await db
      .select()
      .from(eventStateLog)
      .where(eq(eventStateLog.eventId, e.id))
      .orderBy(asc(eventStateLog.occurredAt));
    expect(logs.at(-1)).toMatchObject({ fromStatus: 'finished', toStatus: 'live', reason: 'correction' });
  });

  it('falha 5xx mantém o último estado válido com is_stale', async () => {
    const before = await eventRow('1492407');
    const r = await applyProviderFailure(db, {
      provider: 'api-sports',
      sport: 'football',
      providerEventIds: ['1492407'],
      at: new Date('2026-10-21T16:52:00Z'),
      reason: 'http_error',
    });
    expect(r.changed).toBe(1);
    const after = await eventRow('1492407');
    expect(after).toMatchObject({ status: 'live', statusDetail: 'ET', isStale: true, score: before.score });
    expect(after.lastValidAt).toEqual(before.lastValidAt);
  });

  it('payload vazio de um provedor também mantém o último estado', async () => {
    const fake = new FakeProvider('api-sports').willReturn(
      'getEventDetail',
      emptyBatch('api-sports', 'football', new Date('2026-10-21T16:53:00Z')),
    );
    const res = await ingestProviderResult(db, await fake.getEventDetail('football', '1492407'), {
      provider: 'api-sports',
      sport: 'football',
      expectedEventIds: ['1492407'],
    });
    expect(res.outcome).toBe('kept_last_valid');
    expect((await eventRow('1492407')).status).toBe('live');
  });

  it('fallback temporal: sem fonte, o relógio termina o jogo em ends_at_expected', async () => {
    const e = await eventRow('1492407');
    const now = new Date(e.endsAtExpected.getTime() + 60_000);
    const r = await advanceEventClock(db, now);
    expect(r.changed).toBeGreaterThan(0);
    expect(await eventRow('1492407')).toMatchObject({
      status: 'finished',
      statusSource: 'temporal',
      isStale: true,
    });
    // idempotente para o mesmo instante
    expect((await advanceEventClock(db, now)).changed).toBe(0);
  });

  it('jogo NS do dia sem nenhuma atualização percorre o ciclo temporal completo', async () => {
    const e = await eventRow('1490439');
    expect(e.status).toBe('scheduled');
    await advanceEventClock(db, new Date(e.endsAtExpected.getTime() + 1));
    const logs = await db
      .select()
      .from(eventStateLog)
      .where(eq(eventStateLog.eventId, e.id))
      .orderBy(asc(eventStateLog.occurredAt));
    expect(logs.map((l) => [l.fromStatus, l.toStatus, l.reason])).toEqual([
      [null, 'scheduled', 'provider'],
      ['scheduled', 'starting', 'temporal'],
      ['starting', 'live', 'temporal_fallback'],
      ['live', 'finished', 'temporal_fallback'],
    ]);
    // reprocessar o raw antigo não desfaz a inferência
    await normalizeFootballFromRaw(db);
    expect((await eventRow('1490439')).status).toBe('finished');
  });
});

describe('camada de provedores', () => {
  function licensedBatch(observedAt: Date, homeGoals: number): NormalizedBatch {
    const startsAt = new Date('2026-10-21T15:00:00Z');
    const b = emptyBatch('provedor-licenciado', 'football', observedAt);
    b.participants.push(
      {
        id: 'L-PAL',
        kind: 'club',
        name: 'Palmeiras',
        shortName: 'PAL',
        code: null,
        countryName: null,
        countryCode: 'BR',
        founded: null,
        venueId: null,
        logoUrl: null,
      },
      {
        id: 'L-COR',
        kind: 'club',
        name: 'Corinthians',
        shortName: 'COR',
        code: null,
        countryName: null,
        countryCode: 'BR',
        founded: null,
        venueId: null,
        logoUrl: null,
      },
    );
    b.events.push({
      id: 'L-9001',
      competitionId: null,
      season: null,
      stageLabel: null,
      venueId: null,
      participants: [
        { participantId: 'L-PAL', side: 'home', position: null, result: null },
        { participantId: 'L-COR', side: 'away', position: null, result: null },
      ],
      observation: {
        kind: 'valid',
        observedAt,
        status: 'live',
        statusDetail: 'INPLAY_2ND_HALF',
        clock: { minute: 80, extra: null, period: '2H' },
        score: { home: homeGoals, away: 1 },
        startsAt,
        endsAtExpected: expectedEnd({ sport: 'football', startsAt }),
      },
    });
    return b;
  }

  it('outro provedor, com participantes vinculados, descreve o mesmo evento (sem duplicar)', async () => {
    // vínculo editorial dos times do provedor licenciado aos nossos IDs
    const ids = await db.execute<{ provider_id: string; entity_id: string }>(sql`
      select provider_id, entity_id from core.provider_map
      where provider = 'api-sports' and entity_type = 'participant' and provider_id in ('121', '131')`);
    const byApi = Object.fromEntries(ids.map((r) => [r.provider_id, r.entity_id]));
    await db.insert(providerMap).values([
      {
        entityType: 'participant',
        entityId: byApi['121']!,
        provider: 'provedor-licenciado',
        sport: 'football',
        providerId: 'L-PAL',
      },
      {
        entityType: 'participant',
        entityId: byApi['131']!,
        provider: 'provedor-licenciado',
        sport: 'football',
        providerId: 'L-COR',
      },
    ]);
    const eventsBefore = (await db.select({ id: event.id }).from(event)).length;

    const fake = new FakeProvider('provedor-licenciado').willReturn(
      'listLive',
      licensedBatch(new Date('2026-10-21T17:50:00Z'), 5),
    );
    const res = await ingestProviderResult(db, await fake.listLive('football'), {
      provider: 'provedor-licenciado',
      sport: 'football',
    });
    expect(res.stats.events.matchedAcrossProviders).toBe(1);
    expect((await db.select({ id: event.id }).from(event)).length).toBe(eventsBefore);
    expect(await eventIdOf('L-9001', 'provedor-licenciado')).toBe(await eventIdOf('1492407'));
    // o api-sports estava stale: o provedor licenciado assume o estado
    expect(await eventRow('1492407')).toMatchObject({
      sourceProvider: 'provedor-licenciado',
      status: 'live',
      score: { home: 5, away: 1 },
      isStale: false,
    });
  });

  it('precedência: provedor de menor precedência não sobrescreve dado fresco do dono', async () => {
    const precedence = { order: ['provedor-licenciado', 'api-sports'], staleAfterMs: 10 * 60_000 };
    const env = fixture<{ response: ApiFixture[] }>('fixtures-id-1492407.json');
    const stats = await upsertBatch(db, normalizeFixtures(env.response, new Date('2026-10-21T17:55:00Z')), {
      precedence,
    });
    expect(stats.events.skippedByPrecedence).toBe(1);
    expect(await eventRow('1492407')).toMatchObject({
      sourceProvider: 'provedor-licenciado',
      score: { home: 5, away: 1 },
    });

    // depois de 10 min sem dado do dono, o api-sports pode assumir
    const later = await upsertBatch(db, normalizeFixtures(env.response, new Date('2026-10-21T18:30:00Z')), {
      precedence,
    });
    expect(later.events.skippedByPrecedence).toBe(0);
    expect(await eventRow('1492407')).toMatchObject({
      sourceProvider: 'api-sports',
      status: 'finished',
      score: { home: 4, away: 1 },
    });
  });

  it('ApiSportsProvider ponta a ponta: raw do provedor, core atualizado e 5xx sem perder o último estado', async () => {
    const live = structuredClone(
      fixture<{ response: ApiFixture[] }>('fixtures-date-2026-10-21.json').response.find(
        (f) => f.fixture.id === 1490439,
      )!,
    );
    live.fixture.status = { long: 'First Half', short: '1H', elapsed: 12, extra: null };
    live.goals = { home: 1, away: 0 };
    const urls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(`${url.pathname}${url.search}`);
      if (url.searchParams.get('id') === '1496673') return new Response('indisponível', { status: 503 });
      return new Response(
        JSON.stringify({
          get: 'fixtures',
          parameters: { id: url.searchParams.get('id') },
          errors: [],
          results: 1,
          paging: { current: 1, total: 1 },
          response: [live],
        }),
      );
    }) as typeof globalThis.fetch;
    const client = new ApiSportsClient({
      apiKey: 'chave-de-teste',
      store: new PgRawStore(db),
      governor: new PgQuotaGovernor(db, () => defaultPolicy(100)),
      fetch: fetchFn,
      rateLimiter: new RateLimiter(6000),
    });
    const provider = new ApiSportsProvider(client, { priority: 'ADHOC', jobId: 'teste-e2e' });

    const ok = await provider.getEventDetail('football', '1490439');
    expect(ok.status).toBe('ok');
    const res = await ingestProviderResult(db, ok, {
      provider: provider.id,
      sport: 'football',
      expectedEventIds: ['1490439'],
    });
    expect(res).toMatchObject({ outcome: 'upserted', staleEvents: 0 });
    expect(await eventRow('1490439')).toMatchObject({
      status: 'live',
      statusDetail: '1H',
      isStale: false,
      score: { home: 1, away: 0 },
    });

    const before = await eventRow('1496673');
    const failed = await provider.getEventDetail('football', '1496673');
    expect(failed).toMatchObject({ status: 'error', error: { kind: 'http_error', retryable: true } });
    const kept = await ingestProviderResult(db, failed, {
      provider: provider.id,
      sport: 'football',
      expectedEventIds: ['1496673'],
    });
    expect(kept.outcome).toBe('kept_last_valid');
    const after = await eventRow('1496673');
    expect(after).toMatchObject({ status: before.status, score: before.score, isStale: true });

    expect(urls).toEqual(['/fixtures?id=1490439', '/fixtures?id=1496673']);
    const raws = await db
      .select({ provider: apiResponse.provider, status: apiResponse.statusCode, jobId: apiResponse.jobId })
      .from(apiResponse)
      .where(eq(apiResponse.jobId, 'teste-e2e'));
    expect(raws).toEqual([
      { provider: 'api-sports', status: 200, jobId: 'teste-e2e' },
      { provider: 'api-sports', status: 503, jobId: 'teste-e2e' },
    ]);
  });

  it('clássico informado pela base semântica entra na importância', async () => {
    const env = fixture<{ response: ApiFixture[] }>('fixtures-headtohead-121-131.json');
    const derbyId = '01900000-0000-7000-8000-000000000001';
    // core.event.derby_id tem FK para semantic.derby: o clássico precisa existir
    await db.execute(
      sql`insert into semantic.derby (id, slug, name, scope, intensity, source_file)
          values (${derbyId}, 'derby-paulista-teste', 'Derby Paulista', 'state', 5, 'teste') on conflict do nothing`,
    );
    await upsertBatch(db, normalizeFixtures(env.response, new Date('2026-10-21T19:00:00Z')), {
      derbyLookup: () => ({ derbyId, intensity: 5 }),
    });
    const e = await eventRow('1492212');
    expect(e.derbyId).toBe(derbyId);
    // tier 1 + rodada (4 + reta final pelo total de rodadas conhecido) + clássico 6 × 5
    expect(e.importanceBreakdown).toMatchObject({ tier: 40, derby: 30, decisive: 0, prestige: 0, flags: [] });
    expect(e.importanceBreakdown!.phase).toBeGreaterThanOrEqual(4);
    expect(e.importance).toBe(40 + e.importanceBreakdown!.phase + 30);
  });

  it('nome do estádio: o jogo mais recente vence o /teams e o histórico vira nome anterior', async () => {
    const VENUE = 99258;
    const venueRow = async () =>
      (
        await db
          .select({ name: venue.name, seen: venue.nameSeenAt, former: venue.providerFormerNames })
          .from(venue)
          .innerJoin(providerMap, eq(providerMap.entityId, venue.id))
          .where(and(eq(providerMap.entityType, 'venue'), eq(providerMap.providerId, String(VENUE))))
      )[0]!;
    const teams = (name: string) =>
      normalizeTeams(
        [
          {
            team: {
              id: 121,
              name: 'Palmeiras',
              code: 'PAL',
              country: 'Brazil',
              founded: 1914,
              national: false,
              logo: null,
            },
            venue: {
              id: VENUE,
              name,
              address: null,
              city: 'São Paulo',
              capacity: 43713,
              surface: 'grass',
              image: null,
            },
          } as ApiTeamItem,
        ],
        new Date('2026-10-22T12:00:00Z'),
      );
    const base = fixture<{ response: ApiFixture[] }>('fixtures-headtohead-121-131.json').response[0]!;
    const game = (id: number, date: string, name: string): ApiFixture => {
      const f = structuredClone(base);
      f.fixture = {
        ...f.fixture,
        id,
        date: `${date}T00:30:00+00:00`,
        timestamp: Date.parse(`${date}T00:30:00Z`) / 1000,
        venue: { id: VENUE, name, city: 'São Paulo' },
      };
      return f;
    };
    // /teams (sem data) diz o nome antigo; os jogos de 2026 já trazem o novo
    await upsertBatch(db, teams('Allianz Parque'));
    expect((await venueRow()).name).toBe('Allianz Parque');
    const observed = new Date('2026-10-22T12:00:00Z');
    await upsertBatch(
      db,
      normalizeFixtures(
        [
          game(99001, '2025-05-01', 'Allianz Parque'),
          game(99002, '2025-05-22', 'Allianz Parque'),
          game(99003, '2026-10-09', 'Nubank Parque'),
          game(99004, '2026-10-16', 'Nubank Parque'),
        ],
        observed,
      ),
    );
    expect(await venueRow()).toMatchObject({ name: 'Nubank Parque', seen: new Date('2026-10-16T00:30:00Z') });
    // /teams desatualizado e jogo antigo reprocessado não voltam o nome
    await upsertBatch(db, teams('Allianz Parque'));
    await upsertBatch(db, normalizeFixtures([game(99001, '2025-05-01', 'Allianz Parque')], observed));
    expect((await venueRow()).name).toBe('Nubank Parque');

    const derived = await deriveProviderNames(db);
    expect(derived.venues.renamed).toBeGreaterThanOrEqual(1);
    expect((await venueRow()).former).toEqual([
      { name: 'Allianz Parque', from: '2025-05-01', until: '2025-05-22' },
    ]);
    // idempotente
    expect((await deriveProviderNames(db)).venues.changed).toBe(0);
  });
});
