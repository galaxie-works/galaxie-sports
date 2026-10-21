import { beforeAll, describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import type { CompetitionRules } from '../config/types.js';
import { leagueMatchStakes } from '../stakes/league.js';
import { loadSerieA2024, toMatch, type Season2024 } from '../test-helpers.js';
import { formString } from './accumulate.js';
import { computeTable } from './compute.js';
import type { BaselineRow } from './types.js';

/**
 * Validação com dados reais: os 380 jogos do Brasileirão 2024 (raw da api-sports, recortados
 * em packages/rules/fixtures) devem reproduzir a classificação final oficial da CBF.
 */
const OFFICIAL_2024: [string, number, number, number, number, number, number][] = [
  // [time, P, V, E, D, GP, GC]
  ['Botafogo', 79, 23, 10, 5, 59, 29],
  ['Palmeiras', 73, 22, 7, 9, 60, 33],
  ['Flamengo', 70, 20, 10, 8, 61, 42],
  ['Fortaleza EC', 68, 19, 11, 8, 53, 39],
  ['Internacional', 65, 18, 11, 9, 53, 36],
  ['Sao Paulo', 59, 17, 8, 13, 53, 43],
  ['Corinthians', 56, 15, 11, 12, 54, 45],
  ['Bahia', 53, 15, 8, 15, 49, 49],
  ['Cruzeiro', 52, 14, 10, 14, 43, 41],
  ['Vasco DA Gama', 50, 14, 8, 16, 43, 56],
  ['Vitoria', 47, 13, 8, 17, 45, 52],
  ['Atletico-MG', 47, 11, 14, 13, 47, 54],
  ['Fluminense', 46, 12, 10, 16, 33, 39],
  ['Gremio', 45, 12, 9, 17, 44, 50],
  ['Juventude', 45, 11, 12, 15, 48, 59],
  ['RB Bragantino', 44, 10, 14, 14, 44, 48],
  ['Atletico Paranaense', 42, 11, 9, 18, 40, 46],
  ['Criciuma', 38, 9, 11, 18, 42, 61],
  ['Atletico Goianiense', 30, 7, 9, 22, 29, 58],
  ['Cuiaba', 30, 6, 12, 20, 29, 49],
];

let season: Season2024;
let rules: CompetitionRules;
const name = (id: string) => season.teams[id]!;
const idOf = (team: string) => Object.entries(season.teams).find(([, n]) => n === team)![0];

beforeAll(async () => {
  season = loadSerieA2024();
  rules = await loadCompetitionRules('brasileirao-serie-a', { season: 2024 });
});

describe('Brasileirão 2024 — dados reais', () => {
  it('o recorte tem os 380 jogos de 20 times, 38 rodadas', () => {
    expect(season.fixtures).toHaveLength(380);
    expect(Object.keys(season.teams)).toHaveLength(20);
    expect(new Set(season.fixtures.map((f) => f.round)).size).toBe(38);
  });

  it('reproduz a classificação final oficial (campeão Botafogo)', () => {
    const table = computeTable({ rules, matches: season.fixtures.map(toMatch) });
    expect(
      table.map((r) => [name(r.teamId), r.points, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]),
    ).toEqual(OFFICIAL_2024);
    expect(table.every((r) => r.played === 38 && r.unresolvedTieWith.length === 0)).toBe(true);
  });

  it('desempates por vitórias nos três empates em pontos da tabela final', () => {
    const table = computeTable({ rules, matches: season.fixtures.map(toMatch) });
    const decided = table.filter((r) => r.decidedBy === 'wins').map((r) => name(r.teamId));
    expect(decided).toEqual(['Atletico-MG', 'Juventude', 'Cuiaba']);
  });

  it('zonas: G4 Libertadores, 5º–6º pré-Libertadores, 7º–12º Sul-Americana, Z4', () => {
    const table = computeTable({ rules, matches: season.fixtures.map(toMatch) });
    const zone = (team: string) => table.find((r) => name(r.teamId) === team)!.zone;
    expect(zone('Botafogo')).toBe('libertadores_group_stage');
    expect(zone('Fortaleza EC')).toBe('libertadores_group_stage');
    expect(zone('Internacional')).toBe('libertadores_qualifying');
    expect(zone('Sao Paulo')).toBe('libertadores_qualifying');
    expect(zone('Atletico-MG')).toBe('sudamericana');
    expect(zone('Fluminense')).toBeNull();
    expect(table.filter((r) => r.zone === 'relegation').map((r) => name(r.teamId))).toEqual([
      'Atletico Paranaense',
      'Criciuma',
      'Atletico Goianiense',
      'Cuiaba',
    ]);
  });

  it.each([10, 19, 25, 30, 37])(
    'incremental: tabela oficial até a rodada %i + jogos restantes = tabela final',
    (cut) => {
      const before = season.fixtures.filter((f) => f.round <= cut).map(toMatch);
      const after = season.fixtures.filter((f) => f.round > cut).map(toMatch);
      const partial = computeTable({ rules, matches: before });
      const baseline: BaselineRow[] = partial.map((r) => ({
        teamId: r.teamId,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        points: r.points,
        form: formString(r),
      }));
      const table = computeTable({ rules, matches: after, baseline, priorMatches: before });
      expect(
        table.map((r) => [name(r.teamId), r.points, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]),
      ).toEqual(OFFICIAL_2024);
    },
  );

  it('forma dos últimos 5 jogos do campeão', () => {
    const table = computeTable({ rules, matches: season.fixtures.map(toMatch) });
    expect(formString(table[0]!)).toBe('DDWWW');
  });
});

describe('Brasileirão 2024 — stakes antes da última rodada (rodada 38)', () => {
  function stakesBefore38() {
    const table = computeTable({ rules, matches: season.fixtures.filter((f) => f.round <= 37).map(toMatch) });
    const nextRound = season.fixtures
      .filter((f) => f.round === 38)
      .map((f) => ({ homeId: String(f.home), awayId: String(f.away) }));
    const byTeam = new Map<string, string[]>();
    for (const f of nextRound) {
      const stakes = leagueMatchStakes({
        table,
        league: rules.league!,
        homeId: f.homeId,
        awayId: f.awayId,
        nextRound,
      });
      byTeam.set(
        name(f.homeId),
        stakes.filter((s) => s.team === 'home').map((s) => s.code),
      );
      byTeam.set(
        name(f.awayId),
        stakes.filter((s) => s.team === 'away').map((s) => s.code),
      );
    }
    return { table, byTeam };
  }

  it('Botafogo (76) é campeão com empate; Palmeiras (73) ainda briga', () => {
    const { table, byTeam } = stakesBefore38();
    expect(name(table[0]!.teamId)).toBe('Botafogo');
    expect(table[0]!.points).toBe(76);
    expect(byTeam.get('Botafogo')).toContain('clinches_title_with_draw');
    expect(byTeam.get('Palmeiras')).toContain('in_title_race');
    expect(byTeam.get('Flamengo')).not.toContain('in_title_race');
  });

  it('rebaixamento: três já rebaixados, Bragantino cai se perder, Athletico pode cair', () => {
    const { byTeam } = stakesBefore38();
    for (const team of ['Criciuma', 'Atletico Goianiense', 'Cuiaba']) {
      expect(byTeam.get(team), team).toContain('mathematically_relegated');
    }
    expect(byTeam.get('RB Bragantino')).toContain('relegated_if_loses');
    expect(byTeam.get('Atletico Paranaense')).toEqual(
      expect.arrayContaining(['can_be_relegated', 'secures_safety_with_win']),
    );
    expect(byTeam.get('Fluminense')).toEqual(
      expect.arrayContaining(['can_be_relegated', 'secures_safety_with_win']),
    );
    expect(byTeam.get('Gremio')).toContain('safe_from_relegation');
  });

  it('vagas: Fortaleza e Internacional garantem o G4 com vitória no confronto direto', () => {
    const { byTeam } = stakesBefore38();
    for (const team of ['Fortaleza EC', 'Internacional']) {
      expect(byTeam.get(team), team).toEqual(
        expect.arrayContaining([
          'qualifies_for_libertadores_qualifying',
          'clinches_libertadores_group_stage_with_win',
        ]),
      );
    }
    expect(byTeam.get('Botafogo')).toContain('qualifies_for_libertadores_group_stage');
    expect(byTeam.get('Sao Paulo')).toContain('qualifies_for_libertadores_qualifying');
  });

  it('o resultado real da rodada 38 confirma os códigos de certeza', () => {
    const { byTeam } = stakesBefore38();
    const final = computeTable({ rules, matches: season.fixtures.map(toMatch) });
    const rank = (team: string) => final.findIndex((r) => r.teamId === idOf(team)) + 1;
    expect(rank('Botafogo')).toBe(1);
    // Bragantino venceu e escapou; Athletico perdeu e caiu (can_be_relegated se concretizou).
    expect(byTeam.get('RB Bragantino')).not.toContain('mathematically_relegated');
    expect(rank('RB Bragantino')).toBe(16);
    expect(rank('Atletico Paranaense')).toBe(17);
  });
});
