import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventIncident,
  eventParticipant,
  participant,
  runMigrations,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { computeStandings } from '../src/index.js';
import { loadCompetitionRules } from '../src/config/loader.js';
import { loadProviderBaseline, loadSeasonResults, writeComputedStandings } from '../src/db/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

// Banco descartável por execução.
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
let seasonId: string;
let otherSeasonId: string;
let regularStageId: string;
let cupStageId: string;
const team: Record<string, string> = {};

async function addMatch(
  home: string,
  away: string,
  homeGoals: number | null,
  awayGoals: number | null,
  day: number,
  opts: { status?: 'finished' | 'scheduled'; stageId?: string; cards?: [string, string][] } = {},
) {
  const startsAt = new Date(Date.UTC(2026, 3, day, 20));
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      seasonId,
      stageId: opts.stageId ?? regularStageId,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 115 * 60_000),
      status: opts.status ?? 'finished',
      statusDetail: opts.status === 'scheduled' ? 'NS' : 'FT',
      score: { home: homeGoals, away: awayGoals },
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: team[home]!, side: 'home' },
    { eventId: ev!.id, participantId: team[away]!, side: 'away' },
  ]);
  for (const [i, [who, detail]] of (opts.cards ?? []).entries()) {
    await db.insert(eventIncident).values({
      eventId: ev!.id,
      type: 'card',
      detail,
      participantId: team[who]!,
      sequence: i + 1,
    });
  }
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'brasileirao-serie-a', name: 'Serie A', type: 'league', tier: 1 })
    .returning();
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: comp!.id, label: '2026', year: 2026, current: true },
      { competitionId: comp!.id, label: '2025', year: 2025 },
    ])
    .returning();
  seasonId = seasons[0]!.id;
  otherSeasonId = seasons[1]!.id;
  const stages = await db
    .insert(stage)
    .values([
      { seasonId, kind: 'regular', name: { 'pt-BR': 'Rodada' }, providerLabel: 'Regular Season' },
      { seasonId, kind: 'final', name: { 'pt-BR': 'Final' }, providerLabel: 'Final' },
    ])
    .returning();
  regularStageId = stages[0]!.id;
  cupStageId = stages[1]!.id;
  const rows = await db
    .insert(participant)
    .values(
      ['Alfa', 'Beta', 'Gama', 'Delta'].map((name) => ({ sport: 'football', kind: 'club' as const, name })),
    )
    .returning();
  for (const r of rows) team[r.name] = r.id;

  // Fase regular: Beta 7 pts, Alfa 6, Gama 2, Delta 1.
  await addMatch('Alfa', 'Gama', 2, 0, 1, { cards: [['Alfa', 'Yellow Card']] });
  await addMatch('Beta', 'Delta', 2, 0, 2);
  await addMatch('Beta', 'Alfa', 1, 0, 3, {
    cards: [
      ['Beta', 'Red Card'],
      ['Alfa', 'Second Yellow card'],
    ],
  });
  await addMatch('Alfa', 'Delta', 1, 0, 4);
  await addMatch('Gama', 'Beta', 0, 0, 5);
  await addMatch('Delta', 'Gama', 1, 1, 6);
  // Ignorados: jogo agendado e jogo de outra fase quando filtrado.
  await addMatch('Gama', 'Delta', null, null, 7, { status: 'scheduled' });
  await addMatch('Gama', 'Alfa', 3, 0, 8, { stageId: cupStageId });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('loadSeasonResults', () => {
  it('lê só jogos encerrados, com mandante/visitante, data e cartões', async () => {
    const all = await loadSeasonResults(db, seasonId, { includeCards: true });
    expect(all).toHaveLength(7);
    const regular = await loadSeasonResults(db, seasonId, { includeCards: true, stageIds: [regularStageId] });
    expect(regular).toHaveLength(6);
    const derby = regular.find((m) => m.homeId === team.Beta && m.awayId === team.Alfa)!;
    expect(derby).toMatchObject({ homeGoals: 1, awayGoals: 0 });
    expect(derby.cards).toEqual({ home: { yellow: 0, red: 1 }, away: { yellow: 0, red: 1 } });
    expect(regular[0]!.cards).toEqual({ home: { yellow: 1, red: 0 }, away: { yellow: 0, red: 0 } });
    expect(regular.map((m) => m.playedAt)).toEqual([...regular.map((m) => m.playedAt!)].sort());
  });

  it('aplica o grupo informado', async () => {
    const ms = await loadSeasonResults(db, seasonId, { stageIds: [regularStageId], groupOf: () => 'A' });
    expect(new Set(ms.map((m) => m.group))).toEqual(new Set(['A']));
  });
});

describe('writeComputedStandings', () => {
  it('grava a tabela calculada com source = computed e é idempotente', async () => {
    const rules = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
    const matches = await loadSeasonResults(db, seasonId, { stageIds: [regularStageId], includeCards: true });
    const tables = computeStandings({ rules, matches });
    expect(await writeComputedStandings(db, seasonId, tables)).toBe(4);
    expect(await writeComputedStandings(db, seasonId, tables)).toBe(4);

    const rows = await db
      .select()
      .from(standing)
      .where(eq(standing.seasonId, seasonId))
      .orderBy(standing.rank);
    expect(rows.map((r) => r.participantId)).toEqual([team.Beta, team.Alfa, team.Gama, team.Delta]);
    expect(rows[0]).toMatchObject({
      group: '',
      rank: 1,
      points: 7,
      played: 3,
      won: 2,
      drawn: 1,
      lost: 0,
      goalsFor: 3,
      goalsAgainst: 0,
      form: 'WWD',
      source: 'computed',
      description: 'libertadores_group_stage',
    });
    expect(rows[1]).toMatchObject({ rank: 2, points: 6, form: 'WLW', source: 'computed' });
  });

  it('modo keep_provider não sobrescreve linhas do provedor; replace sobrescreve', async () => {
    await db.insert(standing).values({
      seasonId: otherSeasonId,
      participantId: team.Alfa!,
      rank: 1,
      points: 10,
      played: 4,
      won: 3,
      drawn: 1,
      lost: 0,
      goalsFor: 6,
      goalsAgainst: 1,
      form: 'WWDW',
      source: 'provider',
    });
    const tables = [
      {
        group: '',
        rows: [
          {
            teamId: team.Alfa!,
            group: '',
            rank: 2,
            points: 1,
            played: 1,
            won: 0,
            drawn: 1,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            awayGoalsFor: 0,
            awayWon: 0,
            yellowCards: 0,
            redCards: 0,
            pointsAdjustment: 0,
            form: ['D' as const],
            goalDifference: 0,
            zone: null,
            unresolvedTieWith: [],
            decidedBy: null,
          },
        ],
      },
    ];
    await writeComputedStandings(db, otherSeasonId, tables, { mode: 'keep_provider' });
    const kept = await db
      .select()
      .from(standing)
      .where(and(eq(standing.seasonId, otherSeasonId), eq(standing.participantId, team.Alfa!)));
    expect(kept[0]).toMatchObject({ points: 10, source: 'provider' });

    const baseline = await loadProviderBaseline(db, otherSeasonId);
    expect(baseline).toEqual([
      {
        teamId: team.Alfa,
        group: '',
        played: 4,
        won: 3,
        drawn: 1,
        lost: 0,
        goalsFor: 6,
        goalsAgainst: 1,
        points: 10,
        form: 'WWDW',
      },
    ]);

    await writeComputedStandings(db, otherSeasonId, tables);
    const replaced = await db
      .select()
      .from(standing)
      .where(and(eq(standing.seasonId, otherSeasonId), eq(standing.participantId, team.Alfa!)));
    expect(replaced[0]).toMatchObject({
      points: 1,
      rank: 2,
      source: 'computed',
      form: 'D',
      description: null,
    });
    expect(await loadProviderBaseline(db, otherSeasonId)).toEqual([]);
  });

  it('incremental: tabela do provedor + novos resultados', async () => {
    const rules = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
    const baseline = [
      { teamId: team.Alfa!, played: 2, won: 2, drawn: 0, lost: 0, goalsFor: 3, goalsAgainst: 0, points: 3 },
      { teamId: team.Beta!, played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 2, goalsAgainst: 0, points: 4 },
    ];
    // Alfa tem punição de 3 pontos embutida na tabela do provedor (2 vitórias = 6, informado 3).
    const tables = computeStandings({
      rules,
      baseline,
      matches: [{ homeId: team.Alfa!, awayId: team.Beta!, homeGoals: 2, awayGoals: 0 }],
    });
    expect(tables[0]!.rows.map((r) => [r.teamId, r.points, r.pointsAdjustment])).toEqual([
      [team.Alfa, 6, -3],
      [team.Beta, 4, 0],
    ]);
    expect(await writeComputedStandings(db, otherSeasonId, tables)).toBe(2);
    expect(await writeComputedStandings(db, otherSeasonId, [])).toBe(0);
  });
});
