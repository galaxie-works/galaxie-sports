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
  providerMap,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { upsertBatch } from '@galaxie/core-writer';
import { emptyBatch } from '@galaxie/providers';
import { recomputeNbaStandings } from '../src/standings/nba.js';
import { footballSeasonIds, recomputeSeasonStandings } from '../src/standings/recompute.js';
import { seasonsWithProviderTable, simulateSeasonStandings } from '../src/standings/simulate.js';
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

async function seedSeason(sportSlug: string, slug: string, teams: readonly string[], tier = 3) {
  const [comp] = await db
    .insert(competition)
    .values({ sport: sportSlug, slug, name: slug, type: 'league', tier })
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

  it('tabela do fornecedor mais nova que o último resultado não prevalece: a calculada a substitui (#880)', async () => {
    const s = await seedSeason('football', 'liga-provedor-fresco', ['E1', 'E2']);
    await finished('football', s.seasonId, s.team('E1'), s.team('E2'), [1, 0]);
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
    expect(report).toMatchObject({ outcome: 'written', rows: 2 });
    const rows = await db
      .select({ team: standing.participantId, points: standing.points, source: standing.source })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'computed')).toBe(true);
    expect(rows.find((r) => r.team === s.team('E1'))?.points).toBe(3);
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

    // R e S eram o mesmo grupo e ainda não tinham se enfrentado: o grupo deduzido é refeito, não herdado
    await finished('football', s.seasonId, s.team('R1'), s.team('S1'), [2, 2]);
    await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    const after = await tableOf(s.seasonId);
    expect(after.map((r) => r.group).sort()).toEqual([
      'Group 1',
      'Group 1',
      'unnamed:1',
      'unnamed:1',
      'unnamed:1',
      'unnamed:1',
    ]);
  });

  it('time sem linha que joga contra um grupo com nome entra nele (não some nem vira grupo sozinho)', async () => {
    const s = await seedSeason('football', 'liga-norte-sul', ['N1', 'N2', 'S1', 'S2', 'NOVO']);
    await db.insert(standing).values(
      [
        ['North', 'N1'],
        ['North', 'N2'],
        ['South', 'S1'],
        ['South', 'S2'],
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
    await finished('football', s.seasonId, s.team('N1'), s.team('N2'), [1, 0]);
    await finished('football', s.seasonId, s.team('S1'), s.team('S2'), [1, 0]);
    // promovido sem linha na tabela do fornecedor: antes, com dois grupos, os jogos dele ficavam de fora
    await finished('football', s.seasonId, s.team('NOVO'), s.team('N1'), [2, 0]);
    await finished('football', s.seasonId, s.team('N2'), s.team('NOVO'), [0, 1]);

    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
      rows: 5,
    });
    const table = await tableOf(s.seasonId);
    const novo = table.find((r) => r.participantId === s.team('NOVO'));
    expect(novo).toMatchObject({ group: 'North', played: 2 });
    expect(table.some((r) => r.group.startsWith('unnamed:'))).toBe(false);
  });
});

describe('temporada com só as últimas rodadas no banco', () => {
  it('não publica a tabela parcial e tira a calculada que havia', async () => {
    const s = await seedSeason('football', 'liga-sem-historico', ['A', 'B', 'C', 'D']);
    const [st] = await db
      .insert(stage)
      .values({
        seasonId: s.seasonId,
        kind: 'regular',
        name: { en: 'Regular Season - 30' },
        providerLabel: 'Regular Season - 30',
      })
      .returning();
    await db.insert(standing).values({
      seasonId: s.seasonId,
      group: '',
      participantId: s.team('A'),
      rank: 1,
      points: 3,
      played: 1,
      source: 'computed',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await finished('football', s.seasonId, s.team('A'), s.team('B'), [1, 0], st!.id);
    await finished('football', s.seasonId, s.team('C'), s.team('D'), [2, 2], st!.id);

    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'partial',
    });
    expect(await tableOf(s.seasonId)).toEqual([]);

    // tier 1 e 2 têm a carga histórica: lá a tabela sai mesmo com poucos jogos no banco
    const t1 = await seedSeason('football', 'liga-tier-1', ['E', 'F'], 1);
    const [st1] = await db
      .insert(stage)
      .values({
        seasonId: t1.seasonId,
        kind: 'regular',
        name: { en: 'Regular Season - 30' },
        providerLabel: 'Regular Season - 30',
      })
      .returning();
    await finished('football', t1.seasonId, t1.team('E'), t1.team('F'), [1, 0], st1!.id);
    expect(await recomputeSeasonStandings(db, t1.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
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

describe('temporadas relistadas pelo sync diário', () => {
  it('footballSeasonIds: liga da api-sports e ano viram o id da temporada; par desconhecido fica de fora', async () => {
    const { competitionId, seasonId } = await seedSeason('football', 'relista-948', ['R1', 'R2']);
    await db.insert(providerMap).values({
      entityType: 'competition',
      entityId: competitionId,
      provider: 'api-sports',
      sport: 'football',
      providerId: '948',
    });
    expect(
      await footballSeasonIds(db, [
        { league: '948', year: 2026 },
        { league: '948', year: 2025 },
        { league: '99999', year: 2026 },
      ]),
    ).toEqual([seasonId]);
    expect(await footballSeasonIds(db, [])).toEqual([]);
  });
});

describe('tabela do fornecedor atrasada (espelho, #855)', () => {
  it('não rebaixa a calculada que conta mais jogos, e o recálculo não a trata como fresca', async () => {
    const s = await seedSeason('football', 'liga-fornecedor-atrasado', ['P1', 'P2']);
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9855',
      },
      {
        entityType: 'participant',
        entityId: s.team('P1'),
        provider: 'api-sports',
        sport: 'football',
        providerId: '98551',
      },
      {
        entityType: 'participant',
        entityId: s.team('P2'),
        provider: 'api-sports',
        sport: 'football',
        providerId: '98552',
      },
    ]);
    await finished('football', s.seasonId, s.team('P1'), s.team('P2'), [1, 0]);
    await finished('football', s.seasonId, s.team('P2'), s.team('P1'), [2, 2]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const [{ group }] = (await tableOf(s.seasonId)) as unknown as [{ group: string }];

    const provider = (played: number) => {
      const batch = emptyBatch('api-sports', 'football', new Date());
      batch.participants = (['98551', '98552'] as const).map((id) => ({
        id,
        kind: null,
        name: id,
        shortName: null,
        code: null,
        countryName: null,
        countryCode: null,
        founded: null,
        venueId: null,
        logoUrl: null,
      }));
      batch.standings = (['98551', '98552'] as const).map((id, i) => ({
        season: { competitionId: '9855', year: 2026 },
        group,
        participantId: id,
        rank: i + 1,
        points: played,
        played,
        won: 0,
        drawn: played,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        form: null,
        description: null,
      }));
      return batch;
    };
    const rows = () =>
      db
        .select({ played: standing.played, source: standing.source })
        .from(standing)
        .where(eq(standing.seasonId, s.seasonId));

    // fornecedor ainda sem o 2º jogo: a calculada fica
    await upsertBatch(db, provider(1));
    expect(await rows()).toEqual([
      { played: 2, source: 'computed' },
      { played: 2, source: 'computed' },
    ]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });

    // fornecedor em dia: a tabela continua a nossa (espelho dos dados, não do formato); a dele fica no raw
    await upsertBatch(db, provider(2));
    expect((await rows()).map((r) => r.source)).toEqual(['computed', 'computed']);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
  });

  it('onde ainda não calculamos, a tabela do fornecedor é a reserva e entra inteira', async () => {
    const s = await seedSeason('football', 'liga-sem-calculo', ['R1', 'R2']);
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9857',
      },
      {
        entityType: 'participant',
        entityId: s.team('R1'),
        provider: 'api-sports',
        sport: 'football',
        providerId: '98571',
      },
      {
        entityType: 'participant',
        entityId: s.team('R2'),
        provider: 'api-sports',
        sport: 'football',
        providerId: '98572',
      },
    ]);
    const batch = emptyBatch('api-sports', 'football', new Date());
    batch.participants = (['98571', '98572'] as const).map((id) => ({
      id,
      kind: null,
      name: id,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: null,
    }));
    batch.standings = (['98571', '98572'] as const).map((id, i) => ({
      season: { competitionId: '9857', year: 2026 },
      group: 'Liga',
      participantId: id,
      rank: i + 1,
      points: 3 - 3 * i,
      played: 1,
      won: 1 - i,
      drawn: 0,
      lost: i,
      goalsFor: 1 - i,
      goalsAgainst: i,
      form: null,
      description: null,
    }));
    await upsertBatch(db, batch);
    const rows = await db
      .select({ rank: standing.rank, source: standing.source })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId))
      .orderBy(asc(standing.rank));
    expect(rows).toEqual([
      { rank: 1, source: 'provider' },
      { rank: 2, source: 'provider' },
    ]);
  });

  it('fornecedor que contou só parte da rodada: o grupo inteiro fica calculado (sem tabela misturada)', async () => {
    const s = await seedSeason('football', 'liga-rodada-parcial', ['Q1', 'Q2', 'Q3', 'Q4']);
    const ids = { Q1: '98561', Q2: '98562', Q3: '98563', Q4: '98564' } as const;
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9856',
      },
      ...(Object.entries(ids) as [keyof typeof ids, string][]).map(([name, providerId]) => ({
        entityType: 'participant' as const,
        entityId: s.team(name),
        provider: 'api-sports',
        sport: 'football',
        providerId,
      })),
    ]);
    await finished('football', s.seasonId, s.team('Q1'), s.team('Q2'), [1, 0]);
    await finished('football', s.seasonId, s.team('Q3'), s.team('Q4'), [1, 0]);
    await finished('football', s.seasonId, s.team('Q1'), s.team('Q3'), [2, 0]);
    await finished('football', s.seasonId, s.team('Q2'), s.team('Q4'), [3, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const [{ group }] = (await tableOf(s.seasonId)) as unknown as [{ group: string }];

    // fornecedor sem o Q2 x Q4: Q1 e Q3 em dia, Q2 e Q4 com 1 jogo
    const batch = emptyBatch('api-sports', 'football', new Date());
    batch.participants = Object.values(ids).map((id) => ({
      id,
      kind: null,
      name: id,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: null,
    }));
    const played = { [ids.Q1]: 2, [ids.Q3]: 2, [ids.Q2]: 1, [ids.Q4]: 1 };
    batch.standings = Object.values(ids).map((id, i) => ({
      season: { competitionId: '9856', year: 2026 },
      group,
      participantId: id,
      rank: i + 1,
      points: 0,
      played: played[id]!,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      form: null,
      description: null,
    }));
    await upsertBatch(db, batch);
    const rows = await db
      .select({ played: standing.played, source: standing.source })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source === 'computed' && r.played === 2)).toBe(true);
  });

  it('grupo calculado fica nosso; os promedios do fornecedor ao lado ficam de reserva, também com promovido', async () => {
    const s = await seedSeason('football', 'liga-com-promedios', ['T1', 'T2', 'T3']);
    const ids = ['98581', '98582', '98583'] as const;
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9858',
      },
      ...(['T1', 'T2', 'T3'] as const).map((t, i) => ({
        entityType: 'participant' as const,
        entityId: s.team(t),
        provider: 'api-sports',
        sport: 'football' as const,
        providerId: ids[i]!,
      })),
    ]);
    const providerRows = (g: string, teams: readonly string[], played: number) =>
      teams.map((id, i) => ({
        season: { competitionId: '9858', year: 2026 },
        group: g,
        participantId: id,
        rank: i + 1,
        points: 9 - i,
        played,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        form: null,
        description: null,
      }));
    const participants = ids.map((id) => ({
      id,
      kind: null,
      name: id,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: null,
    }));
    // a liga chega com o rótulo do fornecedor antes do 1º recálculo, que o adota (T3 ainda não jogou)
    const first = emptyBatch('api-sports', 'football', new Date());
    first.participants = participants;
    first.standings = providerRows('Liga B', ['98581', '98582'], 0);
    await upsertBatch(db, first);
    await finished('football', s.seasonId, s.team('T1'), s.team('T2'), [1, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const group = 'Liga B';

    // o espelho: a liga do fornecedor (descartada, o grupo é calculado) e os promedios de 3 temporadas, com o
    // promovido T3 só nos promedios
    const batch = emptyBatch('api-sports', 'football', new Date());
    batch.participants = participants;
    batch.standings = [
      ...providerRows(group, ['98581', '98582'], 0),
      ...providerRows('Promedios 2026', ids, 76),
    ];
    await upsertBatch(db, batch);
    const rows = async () =>
      db
        .select({ group: standing.group, played: standing.played, source: standing.source })
        .from(standing)
        .where(eq(standing.seasonId, s.seasonId))
        .orderBy(asc(standing.group), asc(standing.rank));
    expect((await rows()).filter((r) => r.group === group).every((r) => r.source === 'computed')).toBe(true);
    expect((await rows()).filter((r) => r.group === 'Promedios 2026')).toHaveLength(3);

    // o promovido estreia contra T1: entra na liga, não leva a liga (nem a sua linha) para os promedios
    await finished('football', s.seasonId, s.team('T3'), s.team('T1'), [2, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const after = await rows();
    const league = after.filter((r) => r.group === group);
    expect(league.every((r) => r.source === 'computed')).toBe(true);
    expect(league.map((r) => r.played).sort()).toEqual([1, 1, 2]);
    expect(after.filter((r) => r.group === 'Promedios 2026')).toEqual([
      { group: 'Promedios 2026', played: 76, source: 'provider' },
      { group: 'Promedios 2026', played: 76, source: 'provider' },
      { group: 'Promedios 2026', played: 76, source: 'provider' },
    ]);
  });

  it('competição sem `tables:`: a acumulada do fornecedor com os mesmos times não trava o recálculo', async () => {
    const s = await seedSeason('football', 'liga-com-acumulada', ['A1', 'A2']);
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9859',
      },
      ...(['A1', 'A2'] as const).map((t, i) => ({
        entityType: 'participant' as const,
        entityId: s.team(t),
        provider: 'api-sports',
        sport: 'football' as const,
        providerId: `9859${i + 1}`,
      })),
    ]);
    const providerTable = (g: string, played: number) =>
      (['98591', '98592'] as const).map((id, i) => ({
        season: { competitionId: '9859', year: 2026 },
        group: g,
        participantId: id,
        rank: i + 1,
        points: 3 - i,
        played,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        form: null,
        description: null,
      }));
    const participants = (['98591', '98592'] as const).map((id) => ({
      id,
      kind: null,
      name: id,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: null,
    }));
    // a liga chega com o rótulo do fornecedor antes do 1º recálculo, que o adota
    const first = emptyBatch('api-sports', 'football', new Date());
    first.participants = participants;
    first.standings = providerTable('Liga A', 0);
    await upsertBatch(db, first);
    // o resultado depois da tabela do fornecedor: ela fica atrasada e o recálculo grava a nossa
    await finished('football', s.seasonId, s.team('A1'), s.team('A2'), [1, 0]);
    await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    const group = 'Liga A';
    expect((await tableOf(s.seasonId)).every((r) => (r as { group: string }).group === group)).toBe(true);
    const batch = emptyBatch('api-sports', 'football', new Date());
    batch.participants = participants;
    // a liga do fornecedor (descartada: o grupo é calculado) e a acumulada, com os jogos da temporada
    batch.standings = [...providerTable(group, 1), ...providerTable('Acumulada', 1)];
    await upsertBatch(db, batch);
    await finished('football', s.seasonId, s.team('A2'), s.team('A1'), [1, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const after = await db
      .select({ group: standing.group, played: standing.played, source: standing.source })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId))
      .orderBy(asc(standing.group), asc(standing.rank));
    expect(after.filter((r) => r.group === group).map((r) => [r.played, r.source])).toEqual([
      [2, 'computed'],
      [2, 'computed'],
    ]);
    expect(after.filter((r) => r.group === 'Acumulada').every((r) => r.source === 'provider')).toBe(true);
  });

  it('competição sem `tables:`: a 2ª fase do fornecedor com quase os mesmos times não entra na tabela da regular', async () => {
    const s = await seedSeason('football', 'liga-com-segunda-fase', ['F1', 'F2', 'F3', 'F4']);
    const ids = ['98701', '98702', '98703', '98704'] as const;
    await db.insert(providerMap).values([
      {
        entityType: 'competition',
        entityId: s.competitionId,
        provider: 'api-sports',
        sport: 'football',
        providerId: '9870',
      },
      ...(['F1', 'F2', 'F3', 'F4'] as const).map((t, i) => ({
        entityType: 'participant' as const,
        entityId: s.team(t),
        provider: 'api-sports',
        sport: 'football' as const,
        providerId: ids[i]!,
      })),
    ]);
    const providerRows = (g: string, teams: readonly string[], played: number) =>
      teams.map((id, i) => ({
        season: { competitionId: '9870', year: 2026 },
        group: g,
        participantId: id,
        rank: i + 1,
        points: 9 - i,
        played,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        form: null,
        description: null,
      }));
    const participants = ids.map((id) => ({
      id,
      kind: null,
      name: id,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: null,
    }));
    // a fase regular chega com o rótulo do fornecedor e o recálculo a adota
    const first = emptyBatch('api-sports', 'football', new Date());
    first.participants = participants;
    first.standings = providerRows('Liga C', ids, 0);
    await upsertBatch(db, first);
    await finished('football', s.seasonId, s.team('F1'), s.team('F2'), [1, 0]);
    await finished('football', s.seasonId, s.team('F3'), s.team('F4'), [2, 1]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
    });
    const rows = async () =>
      db
        .select({
          group: standing.group,
          participantId: standing.participantId,
          played: standing.played,
          source: standing.source,
        })
        .from(standing)
        .where(eq(standing.seasonId, s.seasonId))
        .orderBy(asc(standing.group), asc(standing.rank));
    const regular = (await rows()).filter((r) => r.group === 'Liga C');
    expect(regular.map((r) => [r.played, r.source])).toEqual([
      [1, 'computed'],
      [1, 'computed'],
      [1, 'computed'],
      [1, 'computed'],
    ]);

    // a fase final do fornecedor: 3 dos 4 times (a maioria já está na nossa regular) e um jogo dela, sem rodada
    // que separe as fases
    const batch = emptyBatch('api-sports', 'football', new Date());
    batch.participants = participants;
    batch.standings = providerRows('Championship Round', ['98701', '98702', '98703'], 1);
    await upsertBatch(db, batch);
    await finished('football', s.seasonId, s.team('F2'), s.team('F3'), [0, 0]);
    expect(await recomputeSeasonStandings(db, s.seasonId, { publish: false })).toMatchObject({
      outcome: 'no_groups',
    });

    // a regular continua com 1 jogo por time (o da fase final não entrou) e a fase final fica a do fornecedor
    const after = await rows();
    expect(after.filter((r) => r.group === 'Liga C')).toEqual(regular);
    expect(after.filter((r) => r.group === 'Championship Round').map((r) => [r.played, r.source])).toEqual([
      [1, 'provider'],
      [1, 'provider'],
      [1, 'provider'],
    ]);
  });
});

describe('prévia do recálculo (#880)', () => {
  it('simula sem gravar: mostra a troca da tabela do fornecedor e deixa o banco como estava', async () => {
    const s = await seedSeason('football', 'liga-previa', ['P1', 'P2']);
    await finished('football', s.seasonId, s.team('P1'), s.team('P2'), [0, 2]);
    await db.insert(standing).values(
      ['P1', 'P2'].map((team, i) => ({
        seasonId: s.seasonId,
        group: '',
        participantId: s.team(team),
        rank: i + 1,
        points: 0,
        source: 'provider',
        updatedAt: new Date(Date.now() + 60_000),
      })),
    );
    // os jogos semeados têm data fixa (set/2026): a janela de temporada atual é alargada até eles
    expect(await seasonsWithProviderTable(db, 3650)).toContain(s.seasonId);
    const { report, diff } = await simulateSeasonStandings(db, s.seasonId);
    expect(report).toMatchObject({ outcome: 'written', rows: 2 });
    expect(diff).toMatchObject({ providerReplaced: 2, moved: 2, maxShift: 1 });
    const rows = await db
      .select({ source: standing.source, rank: standing.rank, team: standing.participantId })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId));
    expect(rows.every((r) => r.source === 'provider')).toBe(true);
    expect(rows.find((r) => r.team === s.team('P1'))?.rank).toBe(1);
  });
});

describe('trava do #880: fornecedor com mais jogos', () => {
  it('time com mais jogos na tabela do fornecedor: fica a do fornecedor, nada é gravado', async () => {
    const s = await seedSeason('football', 'liga-fornecedor-a-frente', ['K1', 'K2']);
    await finished('football', s.seasonId, s.team('K1'), s.team('K2'), [1, 0]);
    await db.insert(standing).values(
      ['K1', 'K2'].map((team, i) => ({
        seasonId: s.seasonId,
        group: '',
        participantId: s.team(team),
        rank: i + 1,
        points: 6 - i * 3,
        played: 3,
        source: 'provider',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    const report = await recomputeSeasonStandings(db, s.seasonId, { publish: false });
    expect(report.outcome).toBe('provider_ahead');
    expect(report.detail).toContain('tabela do fornecedor com mais jogos');
    const rows = await db
      .select({ source: standing.source, played: standing.played })
      .from(standing)
      .where(eq(standing.seasonId, s.seasonId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'provider' && r.played === 3)).toBe(true);
  });
});
