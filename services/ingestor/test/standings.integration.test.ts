/**
 * Recálculo das tabelas no Postgres: grupos do fornecedor preservados entre recálculos seguidos (o replace grava
 * `computed` sobre a linha do provedor) e conferências da NBA com nome legado.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  event,
  eventParticipant,
  participant,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { recomputeNbaStandings } from '../src/standings/nba.js';
import { recomputeSeasonStandings } from '../src/standings/recompute.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol' } },
    { slug: 'nba', name: { 'pt-BR': 'NBA' } },
  ]);
});

afterAll(async () => {
  await disposable.teardown();
});

async function seedSeason(sportSlug: string, slug: string, teams: readonly string[]) {
  const [comp] = await db
    .insert(competition)
    .values({ sport: sportSlug, slug, name: slug, type: 'league' })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026, current: true })
    .returning();
  const ids = new Map<string, string>();
  for (const name of teams) {
    const [p] = await db.insert(participant).values({ sport: sportSlug, kind: 'club', name }).returning();
    ids.set(name, p!.id);
  }
  return { competitionId: comp!.id, seasonId: s!.id, team: (name: string) => ids.get(name)! };
}

let day = 0;
async function finished(
  sportSlug: string,
  seasonId: string,
  home: string,
  away: string,
  score: [number, number],
  stageId: string | null = null,
) {
  const startsAt = new Date(Date.UTC(2026, 8, 1 + day++, 20));
  const [e] = await db
    .insert(event)
    .values({
      sport: sportSlug,
      seasonId,
      stageId,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
      status: 'finished',
      score: { home: score[0], away: score[1] },
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: e!.id, participantId: home, side: 'home' },
    { eventId: e!.id, participantId: away, side: 'away' },
  ]);
}

async function tableOf(seasonId: string) {
  return db
    .select({ group: standing.group, participantId: standing.participantId, played: standing.played })
    .from(standing)
    .where(eq(standing.seasonId, seasonId))
    .orderBy(asc(standing.group), asc(standing.participantId));
}

describe('recálculo da tabela com grupos do fornecedor', () => {
  it('dois recálculos seguidos mantêm os grupos (sem tabela no grupo vazio)', async () => {
    const s = await seedSeason('football', 'liga-com-grupos', ['A1', 'A2', 'B1', 'B2']);
    // tabela do fornecedor (ex.: bootstrap Pro) mais velha que os resultados: a calculada a substitui
    const old = new Date('2026-01-01T00:00:00Z');
    await db.insert(standing).values(
      [
        ['Grupo A', 'A1'],
        ['Grupo A', 'A2'],
        ['Grupo B', 'B1'],
        ['Grupo B', 'B2'],
      ].map(([group, team], i) => ({
        seasonId: s.seasonId,
        group: group!,
        participantId: s.team(team!),
        rank: (i % 2) + 1,
        points: 0,
        source: 'provider',
        updatedAt: old,
      })),
    );
    await finished('football', s.seasonId, s.team('A1'), s.team('A2'), [2, 0]);
    await finished('football', s.seasonId, s.team('B1'), s.team('B2'), [1, 1]);

    const first = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(first).toMatchObject({ outcome: 'written', results: 2, rows: 4 });
    const afterFirst = await tableOf(s.seasonId);
    expect(new Set(afterFirst.map((r) => r.group))).toEqual(new Set(['Grupo A', 'Grupo B']));

    // novo jogo encerrado: agora não há mais linha `provider` (o replace gravou `computed` por cima)
    await finished('football', s.seasonId, s.team('A2'), s.team('A1'), [1, 0]);
    const second = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(second).toMatchObject({ outcome: 'written', results: 3, rows: 4 });
    const afterSecond = await tableOf(s.seasonId);
    expect(afterSecond).toHaveLength(4);
    expect(afterSecond.map((r) => [r.group, r.played])).toEqual([
      ['Grupo A', 2],
      ['Grupo A', 2],
      ['Grupo B', 1],
      ['Grupo B', 1],
    ]);
  });

  it('resíduo do recálculo que perdia os grupos (tabela no grupo vazio) sai no próximo recálculo', async () => {
    const s = await seedSeason('football', 'liga-com-residuo', ['C1', 'C2', 'D1', 'D2']);
    const rows = [
      ['Grupo C', 'C1'],
      ['Grupo C', 'C2'],
      ['Grupo D', 'D1'],
      ['Grupo D', 'D2'],
      // a tabela inteira gravada no grupo vazio pelo recálculo antigo
      ['', 'C1'],
      ['', 'C2'],
      ['', 'D1'],
      ['', 'D2'],
    ];
    await db.insert(standing).values(
      rows.map(([group, team], i) => ({
        seasonId: s.seasonId,
        group: group!,
        participantId: s.team(team!),
        rank: i + 1,
        points: 0,
        source: 'computed',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    await finished('football', s.seasonId, s.team('C1'), s.team('C2'), [3, 1]);
    await finished('football', s.seasonId, s.team('D1'), s.team('D2'), [0, 2]);

    const report = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(report).toMatchObject({ outcome: 'written', rows: 4 });
    const table = await tableOf(s.seasonId);
    expect(table.map((r) => r.group)).toEqual(['Grupo C', 'Grupo C', 'Grupo D', 'Grupo D']);
  });

  it('time em dois grupos do fornecedor (fase regular + fase final): não recalcula, nada some', async () => {
    const s = await seedSeason('football', 'liga-com-fase-final', ['F1', 'F2', 'F3', 'F4']);
    const rows = [
      ['Regular Season', 'F1'],
      ['Regular Season', 'F2'],
      ['Regular Season', 'F3'],
      ['Regular Season', 'F4'],
      ['Championship Round', 'F1'],
      ['Championship Round', 'F2'],
    ];
    await db.insert(standing).values(
      rows.map(([group, team], i) => ({
        seasonId: s.seasonId,
        group: group!,
        participantId: s.team(team!),
        rank: i + 1,
        points: 30 - i,
        played: 10,
        source: 'provider',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    await finished('football', s.seasonId, s.team('F1'), s.team('F2'), [1, 0]);
    await finished('football', s.seasonId, s.team('F3'), s.team('F4'), [1, 0]);
    for (let i = 0; i < 2; i++) {
      const report = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
      expect(report.outcome).toBe('no_groups');
      expect(report.detail).toMatch(/Championship Round, Regular Season/);
      await finished('football', s.seasonId, s.team('F2'), s.team('F1'), [2, 0]);
    }
    const table = await tableOf(s.seasonId);
    expect(table.map((r) => [r.group, r.played])).toEqual(rows.map(([g]) => [g, 10]).sort());
  });

  it('grupo com nome que este recálculo não gravou (sem jogo novo) fica', async () => {
    const s = await seedSeason('football', 'liga-grupo-parado', ['G1', 'G2', 'H1', 'H2']);
    await db.insert(standing).values(
      [
        ['Grupo G', 'G1'],
        ['Grupo G', 'G2'],
        ['Grupo H', 'H1'],
        ['Grupo H', 'H2'],
      ].map(([group, team], i) => ({
        seasonId: s.seasonId,
        group: group!,
        participantId: s.team(team!),
        rank: (i % 2) + 1,
        points: 3,
        played: 1,
        source: 'computed',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    // só o grupo G tem resultado no core
    await finished('football', s.seasonId, s.team('G1'), s.team('G2'), [1, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
      rows: 2,
    });
    const table = await tableOf(s.seasonId);
    expect(table.map((r) => r.group)).toEqual(['Grupo G', 'Grupo G', 'Grupo H', 'Grupo H']);
  });

  it('linha do provedor não é apagada pela limpeza das calculadas', async () => {
    const s = await seedSeason('football', 'liga-provedor-fresco', ['E1', 'E2']);
    await finished('football', s.seasonId, s.team('E1'), s.team('E2'), [1, 0]);
    // tabela do fornecedor mais nova que o último resultado: prevalece, nada é regravado
    await db.insert(standing).values(
      ['E1', 'E2'].map((team, i) => ({
        seasonId: s.seasonId,
        group: 'Liga',
        participantId: s.team(team),
        rank: i + 1,
        points: 0,
        source: 'provider',
        updatedAt: new Date(Date.now() + 60_000),
      })),
    );
    const report = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(report.outcome).toBe('provider_fresh');
    expect(await tableOf(s.seasonId)).toHaveLength(2);
  });
});

describe('recálculo da tabela com fases', () => {
  async function round(seasonId: string, label: string) {
    const [s] = await db
      .insert(stage)
      .values({ seasonId, kind: 'regular', name: { en: label }, providerLabel: label })
      .returning();
    return s!.id;
  }

  it('Apertura e Clausura: tabela de cada torneio e a anual; o grupo vazio que misturava sai', async () => {
    const s = await seedSeason('football', 'liga-apertura-clausura', ['P1', 'P2', 'P3']);
    // resíduo do recálculo antigo: a soma dos torneios no grupo vazio, sem rótulo
    await db.insert(standing).values(
      ['P1', 'P2', 'P3'].map((team, i) => ({
        seasonId: s.seasonId,
        group: '',
        participantId: s.team(team),
        rank: i + 1,
        points: 0,
        source: 'computed',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    await finished(
      'football',
      s.seasonId,
      s.team('P1'),
      s.team('P2'),
      [1, 0],
      await round(s.seasonId, 'Apertura - 1'),
    );
    await finished(
      'football',
      s.seasonId,
      s.team('P2'),
      s.team('P3'),
      [1, 0],
      await round(s.seasonId, 'Apertura - 2'),
    );
    await finished(
      'football',
      s.seasonId,
      s.team('P3'),
      s.team('P1'),
      [2, 2],
      await round(s.seasonId, 'Clausura - 1'),
    );
    await finished(
      'football',
      s.seasonId,
      s.team('P2'),
      s.team('P1'),
      [0, 1],
      await round(s.seasonId, 'Clausura - 2'),
    );
    // mata-mata do torneio (rodada sem número) não entra em tabela
    await finished(
      'football',
      s.seasonId,
      s.team('P1'),
      s.team('P3'),
      [5, 0],
      await round(s.seasonId, 'Clausura - Final'),
    );

    const report = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(report).toMatchObject({ outcome: 'written', results: 4, rows: 9 });
    const table = await tableOf(s.seasonId);
    const played = (group: string, team: string) =>
      table.find((r) => r.group === group && r.participantId === s.team(team))?.played;
    expect(new Set(table.map((r) => r.group))).toEqual(new Set(['Apertura', 'Clausura', 'annual']));
    expect(played('Apertura', 'P2')).toBe(2);
    expect(played('Clausura', 'P1')).toBe(2);
    expect(played('annual', 'P1')).toBe(3);
  });

  it('fornecedor com só parte dos grupos: os outros são deduzidos dos jogos', async () => {
    const s = await seedSeason('football', 'liga-grupos-parciais', ['Q1', 'Q2', 'R1', 'R2', 'S1', 'S2']);
    await db.insert(standing).values(
      [
        ['Group 1', 'Q1'],
        ['Group 1', 'Q2'],
        ['', 'R1'],
        ['', 'R2'],
        ['', 'S1'],
        ['', 'S2'],
      ].map(([group, team], i) => ({
        seasonId: s.seasonId,
        group: group!,
        participantId: s.team(team!),
        rank: i + 1,
        points: 0,
        source: 'computed',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    await finished('football', s.seasonId, s.team('Q1'), s.team('Q2'), [1, 0]);
    await finished('football', s.seasonId, s.team('R1'), s.team('R2'), [1, 0]);
    await finished('football', s.seasonId, s.team('S1'), s.team('S2'), [1, 0]);

    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
      rows: 6,
    });
    const table = await tableOf(s.seasonId);
    expect(table.map((r) => r.group).sort()).toEqual([
      'Group 1',
      'Group 1',
      'unnamed:1',
      'unnamed:1',
      'unnamed:2',
      'unnamed:2',
    ]);
  });
});

describe('recálculo da NBA', () => {
  it('conferência com nome legado (east) e canônico do mesmo time vira uma só, a canônica', async () => {
    const s = await seedSeason('nba', 'nba-standard', ['BOS', 'NYK', 'LAL', 'GSW']);
    const [regular] = await db
      .insert(stage)
      .values({ seasonId: s.seasonId, kind: 'regular', name: { 'pt-BR': 'Temporada regular' } })
      .returning();
    const conf = (team: string) => (['BOS', 'NYK'].includes(team) ? 'east' : 'west');
    const canonical = (team: string) => (conf(team) === 'east' ? 'Eastern Conference' : 'Western Conference');
    // linhas antigas (east/west) e novas (canônicas) do fornecedor convivem na base
    await db.insert(standing).values(
      ['BOS', 'NYK', 'LAL', 'GSW'].flatMap((team, i) =>
        [conf(team), canonical(team)].map((group) => ({
          seasonId: s.seasonId,
          group,
          participantId: s.team(team),
          rank: i + 1,
          points: 0,
          source: 'provider',
        })),
      ),
    );
    await finished('nba', s.seasonId, s.team('BOS'), s.team('NYK'), [110, 100], regular!.id);
    await finished('nba', s.seasonId, s.team('LAL'), s.team('GSW'), [99, 101], regular!.id);
    await finished('nba', s.seasonId, s.team('NYK'), s.team('LAL'), [90, 95], regular!.id);

    const [report] = await recomputeNbaStandings(db, { publish: false });
    expect(report).toMatchObject({ seasonId: s.seasonId, results: 3, rows: 4 });
    const table = await tableOf(s.seasonId);
    expect(table).toHaveLength(4);
    expect(new Set(table.map((r) => r.group))).toEqual(new Set(['Eastern Conference', 'Western Conference']));
    const [bos] = await db
      .select({ group: standing.group })
      .from(standing)
      .where(and(eq(standing.seasonId, s.seasonId), eq(standing.participantId, s.team('BOS'))));
    expect(bos!.group).toBe('Eastern Conference');
  });
});
