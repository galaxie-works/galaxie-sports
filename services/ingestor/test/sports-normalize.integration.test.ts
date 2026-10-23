/**
 * Normalização raw → core dos demais esportes (issue #25) contra um Postgres descartável:
 * respostas reais recortadas (packages/providers/test/fixtures/api-sports/<esporte>) gravadas no raw,
 * `normalize:sports` e conferência do core — eventos, N participantes (F1), cantos (MMA), fases,
 * classificação, espelho em core.sport_event_detail, idempotência e cursor incremental.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeParams, requestHash } from '@galaxie/apisports-client';
import {
  apiResponse,
  competition,
  event,
  eventParticipant,
  eventStateLog,
  jobRun,
  participant,
  providerMap,
  season,
  sportEventDetail,
  stage,
  standing,
  syncCursor,
  venue,
  type Database,
} from '@galaxie/db';
import { upsertCatalog } from '../src/catalog/persist.js';
import { SPORT_PROFILES } from '../src/catalog/sport-catalog.js';
import { runNormalizeSportsJob } from '../src/normalize/raw-runner.js';
import { disposableDb } from './db.js';

const FIXTURES = new URL('../../../packages/providers/test/fixtures/api-sports/', import.meta.url);
const fixture = (sport: string, name: string) =>
  JSON.parse(readFileSync(new URL(`${sport}/${name}`, FIXTURES), 'utf8')) as {
    parameters: Record<string, string>;
    results?: number;
    response: unknown[];
  };

const testDb = disposableDb();
let db: Database;

async function insertRaw(sport: string, endpoint: string, name: string, fetchedAt: string) {
  const body = fixture(sport, name);
  const params = normalizeParams(body.parameters ?? {});
  await db.insert(apiResponse).values({
    provider: 'api-sports',
    sport,
    apiVersion: sport === 'nba' ? 'v2' : 'v1',
    endpoint,
    params,
    requestHash: requestHash('api-sports', sport, endpoint, params),
    statusCode: 200,
    results: body.results ?? null,
    errors: [],
    body,
    bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    fetchedAt: new Date(fetchedAt),
    jobId: 'teste',
  });
}

async function entityId(sport: string, entityType: string, providerId: string): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.sport, sport),
        eq(providerMap.entityType, entityType),
        eq(providerMap.providerId, providerId),
      ),
    );
  if (!row) throw new Error(`${sport} ${entityType} ${providerId} sem mapeamento`);
  return row.id;
}

async function eventRow(sport: string, providerId: string) {
  const [row] = await db
    .select()
    .from(event)
    .where(eq(event.id, await entityId(sport, 'event', providerId)));
  return row!;
}

async function snapshot() {
  const all = async <T>(q: Promise<T[]>) => JSON.stringify(await q);
  return {
    competition: await all(db.select().from(competition).orderBy(asc(competition.id))),
    season: await all(db.select().from(season).orderBy(asc(season.id))),
    stage: await all(db.select().from(stage).orderBy(asc(stage.id))),
    venue: await all(db.select().from(venue).orderBy(asc(venue.id))),
    participant: await all(db.select().from(participant).orderBy(asc(participant.id))),
    event: await all(db.select().from(event).orderBy(asc(event.id))),
    eventParticipant: await all(
      db
        .select()
        .from(eventParticipant)
        .orderBy(asc(eventParticipant.eventId), asc(eventParticipant.participantId)),
    ),
    eventStateLog: await all(db.select().from(eventStateLog).orderBy(asc(eventStateLog.id))),
    sportEventDetail: await all(db.select().from(sportEventDetail).orderBy(asc(sportEventDetail.eventId))),
    standing: await all(
      db
        .select()
        .from(standing)
        .orderBy(asc(standing.seasonId), asc(standing.group), asc(standing.participantId)),
    ),
    providerMap: await all(
      db
        .select()
        .from(providerMap)
        .orderBy(asc(providerMap.sport), asc(providerMap.entityType), asc(providerMap.providerId)),
    ),
  };
}

beforeAll(async () => {
  db = await testDb.setup();

  // catálogo da F1 como o bootstrap deixaria: competição sintética, equipes e circuito do Bahrein
  await upsertCatalog(
    db,
    'formula-1',
    SPORT_PROFILES['formula-1'].build(
      new Map<string, unknown>([
        ['/seasons', [2023, 2024]],
        [
          '/teams',
          [{ id: 1, name: 'Red Bull Racing', logo: 'https://media.api-sports.io/formula-1/teams/1.png' }],
        ],
        [
          '/circuits',
          [
            {
              id: 2,
              name: 'Bahrain International Circuit',
              image: 'https://media.api-sports.io/formula-1/circuits/2.png',
              competition: {
                id: 2,
                name: 'Bahrain Grand Prix',
                location: { country: 'Bahrain', city: 'Sakhir' },
              },
              capacity: 70000,
            },
          ],
        ],
      ]),
      {
        catalog: [
          {
            slug: 'formula-1',
            name: 'Formula 1 World Championship',
            country: 'World',
            type: 'league',
            api_sports_id: 'world-championship',
            tier: 1,
          },
        ],
        today: new Date('2026-10-21T00:00:00Z'),
      },
    ),
  );

  // raw dos 11 esportes (os complementos da F1/MMA entram ANTES das listas: o runner os ordena)
  await insertRaw('formula-1', '/rankings/races', 'rankings-races-1967.json', '2026-10-21T10:00:00Z');
  await insertRaw(
    'formula-1',
    '/rankings/startinggrid',
    'rankings-startinggrid-1967.json',
    '2026-10-21T10:00:10Z',
  );
  await insertRaw('formula-1', '/races', 'races-2024.json', '2026-10-21T10:01:00Z');
  await insertRaw('formula-1', '/rankings/drivers', 'rankings-drivers-2024.json', '2026-10-21T10:02:00Z');
  await insertRaw('formula-1', '/rankings/teams', 'rankings-teams-2024.json', '2026-10-21T10:03:00Z');
  await insertRaw('mma', '/fights/results', 'fights-results-1097.json', '2026-10-21T10:00:00Z');
  await insertRaw('mma', '/fights', 'fights-2024.json', '2026-10-21T10:05:00Z');
  await insertRaw('afl', '/games/quarters', 'games-quarters-3058.json', '2026-10-21T10:00:00Z');
  await insertRaw('basketball', '/games', 'games-12-2024-2025.json', '2026-10-21T11:00:00Z');
  await insertRaw('basketball', '/standings', 'standings-12-2024-2025.json', '2026-10-21T11:01:00Z');
  await insertRaw('nba', '/games', 'games-date-2026-05-17.json', '2026-10-21T11:02:00Z');
  await insertRaw('nba', '/standings', 'standings-standard-2024.json', '2026-10-21T11:03:00Z');
  for (const [sport, games, standings] of [
    ['afl', 'games-1-2024.json', 'standings-1-2024.json'],
    ['baseball', 'games-1-2024.json', 'standings-1-2024.json'],
    ['handball', 'games-39-2024.json', 'standings-39-2024.json'],
    ['hockey', 'games-57-2024.json', 'standings-57-2024.json'],
    ['american-football', 'games-1-2024.json', 'standings-1-2024.json'],
    ['rugby', 'games-16-2024.json', 'standings-16-2024.json'],
    ['volleyball', 'games-132-2024.json', 'standings-132-2024.json'],
  ] as const) {
    await insertRaw(sport, '/games', games, '2026-10-21T12:00:00Z');
    await insertRaw(sport, '/standings', standings, '2026-10-21T12:01:00Z');
  }
}, 120_000);

afterAll(() => testDb.teardown());

describe('normalize:sports (raw → core dos 11 esportes)', () => {
  let first: Awaited<ReturnType<typeof snapshot>>;

  it('processa todos os esportes sem erro, com os complementos depois das listas', async () => {
    const results = await runNormalizeSportsJob(db, { full: true });
    expect(results.map((r) => r.sport)).toHaveLength(11);
    for (const { sport, result } of results) {
      expect(
        result.rows.filter((r) => r.outcome === 'error'),
        sport,
      ).toEqual([]);
    }
    const f1 = results.find((r) => r.sport === 'formula-1')!.result;
    expect(f1.rows.map((r) => r.endpoint)).toEqual([
      '/races',
      '/rankings/drivers',
      '/rankings/teams',
      '/rankings/races',
      '/rankings/startinggrid',
    ]);
    expect(f1.stats.supplements).toEqual({ applied: 2, missingEvent: 0 });
    expect(f1.stats.competitionsCreated).toBe(0); // reusa a competição sintética do catálogo
    const mma = results.find((r) => r.sport === 'mma')!.result;
    expect(mma.stats.supplements).toEqual({ applied: 1, missingEvent: 0 });
    const afl = results.find((r) => r.sport === 'afl')!.result;
    expect(afl.rows.map((r) => r.endpoint)).toEqual(['/games', '/standings', '/games/quarters']);
    expect(afl.stats.supplements).toEqual({ applied: 1, missingEvent: 0 });
    first = await snapshot();
  });

  it('todos os esportes têm eventos no core (base de /v1/events)', async () => {
    const rows = await db.execute<{ sport: string; n: number }>(
      sql`select sport, count(*)::int as n from core.event group by sport order by sport`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.sport, Number(r.n)]))).toEqual({
      afl: 11,
      'american-football': 3,
      baseball: 5,
      basketball: 4,
      'formula-1': 12,
      handball: 1,
      hockey: 6,
      mma: 6,
      nba: 2,
      rugby: 3,
      volleyball: 3,
    });
    const details = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.sport_event_detail`,
    );
    expect(Number(details[0]!.n)).toBe(56);
  });

  it('AFL: quartos da grande final no espelho do jogo, grande final como fase', async () => {
    const gf = await entityId('afl', 'event', '3058');
    const [d] = await db.select().from(sportEventDetail).where(eq(sportEventDetail.eventId, gf));
    expect((d!.detail as { quarters: unknown[] }).quarters).toHaveLength(4);
    const [e] = await db.execute<{ score: unknown; kind: string; label: string }>(sql`
      select e.score, s.kind, s.provider_label as label from core.event e join core.stage s on s.id = e.stage_id
      where e.id = ${gf}`);
    expect(e).toMatchObject({
      kind: 'final',
      label: 'Grand Final',
      score: {
        home: 60,
        away: 120,
        breakdown: { home: { goals: 9, behinds: 6 }, away: { goals: 18, behinds: 12 } },
      },
    });
  });

  it('basquete: estado, placar com parciais, fim previsto e mandante/visitante', async () => {
    const e = await eventRow('basketball', '425068');
    expect(e).toMatchObject({
      sport: 'basketball',
      status: 'finished',
      statusDetail: 'FT',
      statusSource: 'provider',
      score: { home: 103, away: 107, periods: { q1: { home: 32, away: 25 } } },
    });
    expect((e.endsAtExpected.getTime() - e.startsAt.getTime()) / 60_000).toBe(135);
    const parts = await db.select().from(eventParticipant).where(eq(eventParticipant.eventId, e.id));
    expect(parts.map((p) => [p.side, p.result]).sort()).toEqual([
      ['away', { score: 107, winner: true }],
      ['home', { score: 103, winner: false }],
    ]);
    const [s] = await db.select().from(season).where(eq(season.id, e.seasonId!));
    expect(s).toMatchObject({ year: 2024, label: '2024/25' });
    const [detail] = await db.select().from(sportEventDetail).where(eq(sportEventDetail.eventId, e.id));
    expect(detail).toMatchObject({ kind: 'game', providerEventId: '425068', sport: 'basketball' });
  });

  it('F1: GP vira fase race_weekend, sessões viram eventos no circuito do catálogo', async () => {
    const race = await eventRow('formula-1', '1857');
    const [st] = await db.select().from(stage).where(eq(stage.id, race.stageId!));
    expect(st).toMatchObject({ kind: 'race_weekend', providerLabel: 'grand-prix-2' });
    expect(race.venueId).toBe(await entityId('formula-1', 'venue', '2'));
    expect(race.competitionId).toBe(await entityId('formula-1', 'competition', 'world-championship'));
    const sessions = await db.select().from(event).where(eq(event.stageId, st!.id));
    expect(sessions).toHaveLength(7); // 3 treinos, Q1–Q3 e corrida
  });

  it('F1: resultado e grid mesclados em N pilotos (lado grid, posição final, grid e tempos)', async () => {
    const race = await eventRow('formula-1', '1967');
    const parts = await db
      .select({ ep: eventParticipant, name: participant.name, kind: participant.kind })
      .from(eventParticipant)
      .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
      .where(eq(eventParticipant.eventId, race.id))
      .orderBy(asc(eventParticipant.position));
    expect(parts).toHaveLength(5);
    expect(parts.every((p) => p.kind === 'driver' && p.ep.side === 'grid')).toBe(true);
    const ver = parts.find((p) => p.name === 'Max Verstappen')!;
    expect(ver.ep.position).toBe(1);
    expect(ver.ep.result).toMatchObject({
      position: 1,
      grid: 2,
      time: '1:31:05.323',
      qualifying_time: '1:20.520',
    });
    const russell = parts.find((p) => p.name === 'George Russell')!;
    expect(russell.ep).toMatchObject({ position: null, result: { grid: 1 } });
    const [d] = await db.select().from(sportEventDetail).where(eq(sportEventDetail.eventId, race.id));
    expect(Object.keys(d!.detail as object).sort()).toEqual(['results', 'startinggrid']);
  });

  it('F1: classificação de pilotos e construtores na temporada do campeonato', async () => {
    const rows = await db
      .select({ group: standing.group, rank: standing.rank, points: standing.points, name: participant.name })
      .from(standing)
      .innerJoin(participant, eq(participant.id, standing.participantId))
      .innerJoin(season, eq(season.id, standing.seasonId))
      .where(eq(season.competitionId, await entityId('formula-1', 'competition', 'world-championship')))
      .orderBy(asc(standing.group), asc(standing.rank));
    expect(rows.map((r) => [r.group, r.rank, r.name])).toEqual([
      ['constructors', 1, 'McLaren Racing'],
      ['constructors', 2, 'Scuderia Ferrari'],
      ['constructors', 3, 'Red Bull Racing'],
      ['drivers', 1, 'Max Verstappen'],
      ['drivers', 2, 'Lando Norris'],
      ['drivers', 3, 'Charles Leclerc'],
    ]);
    // a equipe do catálogo continua dona do cadastro (referência só preenche lacunas)
    const [rb] = await db
      .select()
      .from(participant)
      .where(eq(participant.id, await entityId('formula-1', 'participant', '1')));
    expect(rb).toMatchObject({ kind: 'constructor', name: 'Red Bull Racing' });
  });

  it('MMA: lutas com os dois cantos, card como fase e desfecho no espelho', async () => {
    const fight = await eventRow('mma', '1097');
    const parts = await db.select().from(eventParticipant).where(eq(eventParticipant.eventId, fight.id));
    expect(parts.map((p) => [p.side, p.result]).sort()).toEqual([
      ['corner_blue', { winner: true }],
      ['corner_red', { winner: false }],
    ]);
    const [st] = await db.select().from(stage).where(eq(stage.id, fight.stageId!));
    expect(st).toMatchObject({ kind: 'fight_card', providerLabel: 'card-ufc-2024-01-13' });
    expect(st!.name).toMatchObject({ 'pt-BR': 'UFC Fight Night: Ankalaev vs. Walker 2' });
    const [d] = await db.select().from(sportEventDetail).where(eq(sportEventDetail.eventId, fight.id));
    expect(d!.detail).toMatchObject({ result: { won_type: 'KO', round: 2 } });
    expect(d!.summary).toMatchObject({ slug: 'UFC Fight Night: Ankalaev vs. Walker 2' });
  });

  it('classificação dos esportes coletivos (NBA v2 por conferência, NFL por divisão)', async () => {
    const count = await db.execute<{ sport: string; n: number }>(sql`
      select c.sport, count(*)::int as n from core.standing s
      join core.season se on se.id = s.season_id join core.competition c on c.id = se.competition_id
      group by c.sport order by c.sport`);
    expect(Object.fromEntries(count.map((r) => [r.sport, Number(r.n)]))).toEqual({
      afl: 3,
      'american-football': 3,
      baseball: 6,
      basketball: 3,
      'formula-1': 6,
      handball: 3,
      hockey: 4,
      nba: 3,
      rugby: 3,
      volleyball: 3,
    });
    const nfl = await db.execute<{ group: string }>(sql`
      select distinct s."group" from core.standing s
      join core.season se on se.id = s.season_id join core.competition c on c.id = se.competition_id
      where c.sport = 'american-football'`);
    expect(nfl.map((r) => r.group)).toEqual(['AFC East']);
  });

  it('hóquei: o Utah ("id 0" na tabela da NHL) volta pelo nome dos jogos no raw; prorrogação à parte', async () => {
    const rows = await db.execute<{
      pid: string;
      group: string;
      won: number;
      ot_won: number;
      ot_lost: number;
    }>(sql`
      select pm.provider_id as pid, s."group", s.won, s.ot_won, s.ot_lost from core.standing s
      join core.season se on se.id = s.season_id join core.competition c on c.id = se.competition_id
      join core.provider_map pm on pm.entity_id = s.participant_id and pm.entity_type = 'participant'
        and pm.sport = 'hockey'
      where c.sport = 'hockey' order by s.rank`);
    expect(rows.map((r) => [r.pid, r.group, r.won, r.ot_won, r.ot_lost])).toEqual([
      ['704', 'Western Conference', 56, 13, 4],
      ['702', 'Western Conference', 50, 4, 10],
      ['681', 'Western Conference', 50, 9, 6],
      ['2483', 'Western Conference', 38, 8, 13],
    ]);
  });

  it('reprocessar o raw inteiro de novo gera exatamente o mesmo estado', async () => {
    const again = await runNormalizeSportsJob(db, { full: true });
    expect(again.every(({ result }) => result.stats.events.inserted === 0)).toBe(true);
    expect(await snapshot()).toEqual(first);
  });

  it('jobs por esporte registram cursor e o modo incremental não reprocessa nada', async () => {
    const runs = await db.select().from(jobRun).where(eq(jobRun.job, 'normalize:volleyball'));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.status === 'ok')).toBe(true);
    const cursors = await db.select().from(syncCursor).where(eq(syncCursor.endpoint, 'normalize:core'));
    expect(cursors).toHaveLength(11);
    const incremental = await runNormalizeSportsJob(db, { sports: ['volleyball', 'formula-1'] });
    expect(incremental.map(({ result }) => result.rows.length)).toEqual([0, 0]);
  });
});
