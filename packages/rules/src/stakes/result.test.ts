import { describe, expect, it } from 'vitest';
import { computeTable } from '../standings/compute.js';
import type { MatchResult } from '../standings/types.js';
import {
  brasileiraoRules,
  finishedInput,
  loadR32,
  randomDoubleRoundRobin,
  rng,
  rulesFrom,
  type R32Fixture,
} from '../test-helpers.js';
import type { Stake } from './codes.js';
import { localizeStake } from './labels.js';
import { LeagueInputError, type LeagueTeamInput } from './league.js';
import {
  finishedLeagueMatchStakes,
  leagueInputOf,
  leagueResultStakes,
  pickGroupTable,
  prepareFinishedLeagueMatch,
  tablesAroundMatch,
} from './result.js';

const codes = (stakes: Stake[], side: 'home' | 'away') =>
  stakes.filter((s) => s.team === side).map((s) => s.code);

const rankOf = (rows: { teamId: string; rank: number }[], id: string) =>
  rows.find((r) => r.teamId === id)!.rank;

describe('Brasileirão 2026, rodada 32 — Vasco 3 × 2 Corinthians (encerrado)', () => {
  const fx: R32Fixture = loadR32();
  const finished = finishedLeagueMatchStakes(finishedInput(fx, 'vas-cor'));

  it('tabela de antes: desfaz o jogo, o simultâneo (Palmeiras × Bragantino) e os posteriores', () => {
    const by = new Map(finished.before.map((r) => [r.teamId, r]));
    expect(by.get('vasco')).toMatchObject({ rank: 15, points: 35, played: 30 });
    expect(by.get('internacional')).toMatchObject({ rank: 16, points: 35, played: 32 });
    expect(by.get('corinthians')).toMatchObject({ rank: 17, points: 33, played: 31 });
    // Palmeiras × Bragantino começou no mesmo horário: fica fora da tabela de antes
    expect(by.get('flamengo')).toMatchObject({ rank: 1, points: 67 });
    expect(by.get('palmeiras')).toMatchObject({ rank: 2, points: 66, played: 31 });
    // jogos que começaram antes (sábado à tarde) ficam
    expect(by.get('cruzeiro')).toMatchObject({ points: 54, played: 32 });
    expect(by.get('chapecoense')).toMatchObject({ points: 18, played: 30 });
  });

  it('tabela de depois: antes + só este jogo', () => {
    const by = new Map(finished.after.map((r) => [r.teamId, r]));
    // empata com o Vitória em pontos e vitórias; passa no saldo (−6 × −11)
    expect(by.get('vasco')).toMatchObject({ rank: 13, points: 38, played: 31 });
    expect(by.get('vitoria')).toMatchObject({ rank: 14, points: 38 });
    expect(by.get('corinthians')).toMatchObject({ rank: 17, points: 33, played: 32 });
    expect(by.get('palmeiras')).toMatchObject({ points: 66 });
  });

  it('o que estava em jogo continua lá, com a tabela de antes', () => {
    expect(codes(finished.pre, 'home')).toEqual([
      'can_qualify_for_libertadores_group_stage',
      'at_risk_of_relegation',
    ]);
    expect(codes(finished.pre, 'away')).toEqual([
      'can_qualify_for_libertadores_group_stage',
      'at_risk_of_relegation',
    ]);
  });

  it('códigos de resultado: posição, distância e o que deixou de ser possível', () => {
    expect(codes(finished.result, 'home')).toEqual([
      'moved_up_to_13',
      'points_behind_sudamericana_1',
      'points_above_relegation_5',
    ]);
    expect(codes(finished.result, 'away')).toEqual([
      'stayed_at_17',
      'lost_libertadores_group_stage_chance',
      'points_below_safety_2',
    ]);
  });

  it('rótulos fixos em pt-BR e es-AR', () => {
    const text = (code: string) =>
      localizeStake(
        finished.result.find((s) => s.code === code)!,
        ['pt-BR', 'es-AR'],
      ).text;
    expect(text('moved_up_to_13')).toEqual({
      'pt-BR': 'Subiu para o 13º lugar',
      'es-AR': 'Subió al puesto 13',
    });
    expect(text('points_behind_sudamericana_1')).toEqual({
      'pt-BR': 'Fica a 1 ponto da vaga para a Sul-Americana',
      'es-AR': 'Queda a 1 punto de un lugar para la Sudamericana',
    });
    expect(text('points_above_relegation_5')).toEqual({
      'pt-BR': 'Fica 5 pontos acima da zona de rebaixamento',
      'es-AR': 'Queda 5 puntos por encima de la zona de descenso',
    });
    expect(text('points_below_safety_2')).toEqual({
      'pt-BR': 'Fica a 2 pontos de sair da zona de rebaixamento',
      'es-AR': 'Queda a 2 puntos de salir de la zona de descenso',
    });
  });

  it('jogo do sábado à tarde: Internacional 3 × 0 Botafogo tira o Inter da zona', () => {
    const f = finishedLeagueMatchStakes(finishedInput(fx, 'int-bot'));
    expect(rankOf(f.before, 'internacional')).toBe(17);
    expect(rankOf(f.after, 'internacional')).toBe(16);
    expect(codes(f.result, 'home')).toEqual([
      'moved_up_to_16',
      'climbed_out_of_relegation',
      'points_behind_sudamericana_4',
      'points_above_relegation_2',
    ]);
    expect(codes(f.result, 'away')).toContain('stayed_at_11');
  });
});

/** Liga de 4 times: 1º vaga, 4º rebaixado, 6 jogos cada. */
const MINI = rulesFrom({
  standings: { points: { win: 3, draw: 1, loss: 0 }, tie_breakers: ['wins', 'goal_difference', 'goals_for'] },
  league: {
    teams: 4,
    matches_per_team: 6,
    title: true,
    zones: [
      { id: 'libertadores', kind: 'qualification', from: 1, to: 1 },
      { id: 'relegation', kind: 'relegation', from: 4, to: 4 },
    ],
  },
});

const t = (rows: [string, number, number][]): LeagueTeamInput[] =>
  rows.map(([teamId, points, played]) => ({ teamId, points, played }));

describe('leagueResultStakes', () => {
  it('assumiu a liderança, entrou na zona de vaga e garantiu o título', () => {
    const out = leagueResultStakes({
      before: t([
        ['B', 13, 5],
        ['A', 12, 5],
        ['C', 4, 5],
        ['D', 1, 5],
      ]),
      after: t([
        ['A', 15, 6],
        ['B', 13, 6],
        ['C', 4, 5],
        ['D', 1, 5],
      ]),
      league: MINI.league!,
      homeId: 'A',
      awayId: 'B',
    });
    expect(codes(out, 'home')).toEqual([
      'moved_up_to_1',
      'took_the_lead',
      'entered_libertadores',
      'clinched_title',
      'clinched_libertadores',
      'points_ahead_at_top_2',
      'points_above_relegation_14',
    ]);
    expect(codes(out, 'away')).toEqual([
      'moved_down_to_2',
      'lost_the_lead',
      'left_libertadores',
      'lost_title_chance',
      'lost_libertadores_chance',
      'points_behind_libertadores_2',
      'points_above_relegation_12',
    ]);
  });

  it('entrou na zona de rebaixamento e teve o rebaixamento confirmado; o outro garantiu a permanência', () => {
    const out = leagueResultStakes({
      before: t([
        ['A', 15, 5],
        ['B', 9, 5],
        ['D', 4, 5],
        ['C', 3, 5],
      ]),
      after: t([
        ['A', 15, 5],
        ['B', 9, 5],
        ['C', 6, 6],
        ['D', 4, 6],
      ]),
      league: MINI.league!,
      homeId: 'C',
      awayId: 'D',
    });
    expect(codes(out, 'home')).toEqual([
      'moved_up_to_3',
      'climbed_out_of_relegation',
      'clinched_safety',
      'points_behind_libertadores_9',
      'points_above_relegation_2',
    ]);
    expect(codes(out, 'away')).toEqual([
      'moved_down_to_4',
      'dropped_into_relegation',
      'relegation_confirmed',
      'points_below_safety_2',
    ]);
  });

  it('empatado em pontos com a linha: n = 0 e rótulo próprio', () => {
    const out = leagueResultStakes({
      before: t([
        ['A', 10, 4],
        ['B', 7, 4],
        ['C', 6, 4],
        ['D', 3, 4],
      ]),
      after: t([
        ['A', 10, 4],
        ['B', 7, 5],
        ['C', 7, 5],
        ['D', 3, 4],
      ]),
      league: MINI.league!,
      homeId: 'C',
      awayId: 'B',
    });
    const zero = out.find((s) => s.code === 'points_behind_libertadores_3');
    expect(zero).toBeDefined();
    const r = out.find((s) => s.code === 'points_above_relegation_4')!;
    expect(localizeStake(r, ['pt-BR']).text['pt-BR']).toBe('Fica 4 pontos acima da zona de rebaixamento');
  });
});

describe('tablesAroundMatch e prepareFinishedLeagueMatch', () => {
  const rules = rulesFrom({
    standings: {
      points: { win: 3, draw: 1, loss: 0 },
      tie_breakers: ['wins', 'goal_difference', 'goals_for', { criterion: 'h2h_points', max_teams: 2 }],
    },
    league: {
      teams: 6,
      matches_per_team: 10,
      title: true,
      zones: [
        { id: 'libertadores', kind: 'qualification', from: 1, to: 2 },
        { id: 'relegation', kind: 'relegation', from: 6, to: 6 },
      ],
    },
  });
  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const all6 = teams.map((teamId) => ({ teamId }));

  it('propriedade: antes = tabela dos jogos anteriores; depois = antes + o jogo (40 ligas aleatórias)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const all = randomDoubleRoundRobin(teams, rand);
      const played = all.slice(0, 18 + (seed % 10));
      const current = computeTable({ rules, matches: played, teams: all6 });
      const target = played[Math.floor(rand() * played.length)]!;
      const input = prepareFinishedLeagueMatch({ rules, current, results: played, matchId: target.id! });
      const out = tablesAroundMatch(input);
      const earlier = played.filter((m) => m.playedAt! < target.playedAt!);
      const strip = (rows: ReturnType<typeof computeTable>) =>
        rows.map((r) => [r.teamId, r.rank, r.points, r.played, r.goalsFor - r.goalsAgainst]);
      expect(strip(out.before), `seed ${seed}`).toEqual(
        strip(computeTable({ rules, matches: earlier, teams: all6 })),
      );
      expect(strip(out.after), `seed ${seed}`).toEqual(
        strip(computeTable({ rules, matches: [...earlier, target], teams: all6 })),
      );
    }
  });

  it('preserva ajuste de pontos (punição) já aplicado na tabela atual', () => {
    const played: MatchResult[] = [
      { id: 'm1', homeId: 'A', awayId: 'B', homeGoals: 1, awayGoals: 0, playedAt: '2026-01-01T00:00:00Z' },
      { id: 'm2', homeId: 'C', awayId: 'D', homeGoals: 2, awayGoals: 2, playedAt: '2026-01-02T00:00:00Z' },
    ];
    const current = computeTable({
      rules,
      matches: played,
      teams: teams.map((teamId) => ({ teamId })),
      adjustments: [{ teamId: 'A', points: -3 }],
    });
    const out = tablesAroundMatch(
      prepareFinishedLeagueMatch({ rules, current, results: played, matchId: 'm1' }),
    );
    expect(out.before.find((r) => r.teamId === 'A')!.points).toBe(-3);
    expect(out.after.find((r) => r.teamId === 'A')!.points).toBe(0);
  });

  it('recusa tabela que não bate com os resultados (tabela desatualizada)', () => {
    const played = randomDoubleRoundRobin(teams, rng(7)).slice(0, 12);
    const current = computeTable({ rules, matches: played.slice(0, 11) });
    expect(() =>
      prepareFinishedLeagueMatch({ rules, current, results: played, matchId: played[11]!.id! }),
    ).toThrow(LeagueInputError);
    expect(() => prepareFinishedLeagueMatch({ rules, current, results: played, matchId: 'x' })).toThrow(
      /não está entre os resultados/,
    );
  });

  describe('critérios de gols e vitórias fora (Champions, Libertadores)', () => {
    const awayRules = rulesFrom({
      standings: {
        points: { win: 3, draw: 1, loss: 0 },
        tie_breakers: ['goal_difference', 'goals_for', 'away_goals_for', 'wins', 'away_wins'],
      },
      league: { teams: 6, matches_per_team: 10, title: true, zones: [] },
    });
    // a tabela da `core.standing`: sem gols/vitórias fora nem cartões
    const snapshot = (rows: ReturnType<typeof computeTable>) =>
      rows.map(({ teamId, played, won, drawn, lost, goalsFor, goalsAgainst, points }) => ({
        teamId,
        played,
        won,
        drawn,
        lost,
        goalsFor,
        goalsAgainst,
        points,
      }));
    const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();

    it('A e B empatados em tudo menos nos gols fora: B à frente na tabela de antes', () => {
      const played: MatchResult[] = [
        { id: 'm1', homeId: 'A', awayId: 'C', homeGoals: 2, awayGoals: 0, playedAt: at(1) },
        { id: 'm2', homeId: 'D', awayId: 'B', homeGoals: 0, awayGoals: 2, playedAt: at(2) },
        { id: 'm3', homeId: 'E', awayId: 'F', homeGoals: 1, awayGoals: 0, playedAt: at(3) },
      ];
      const current = snapshot(computeTable({ rules: awayRules, matches: played, teams: all6 }));
      const out = tablesAroundMatch(
        prepareFinishedLeagueMatch({ rules: awayRules, current, results: played, matchId: 'm3' }),
      );
      const top = out.before.slice(0, 2);
      expect(top.map((r) => r.teamId)).toEqual(['B', 'A']);
      expect(top[1]!.decidedBy).toBe('away_goals_for');
      expect(top[0]).toMatchObject({ awayGoalsFor: 2, awayWon: 1 });
      // sem os gols fora na tabela e sem os resultados para somá-los: recusa em vez de reordenar errado
      expect(() =>
        tablesAroundMatch({ rules: awayRules, current, match: played[2]!, later: [], earlier: played }),
      ).toThrow(/gols e vitórias como visitante/);
    });

    it('propriedade: antes/depois iguais aos calculados dos jogos, com a tabela com ou sem os gols fora', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const rand = rng(100 + seed);
        const all = randomDoubleRoundRobin(teams, rand);
        const played = all.slice(0, 15 + (seed % 12));
        const full = computeTable({ rules: awayRules, matches: played, teams: all6 });
        const target = played[Math.floor(rand() * played.length)]!;
        const earlier = played.filter((m) => m.playedAt! < target.playedAt!);
        const strip = (rows: ReturnType<typeof computeTable>) =>
          rows.map((r) => [r.teamId, r.rank, r.points, r.awayGoalsFor, r.awayWon]);
        for (const current of [full, snapshot(full)]) {
          const out = tablesAroundMatch(
            prepareFinishedLeagueMatch({ rules: awayRules, current, results: played, matchId: target.id! }),
          );
          expect(strip(out.before), `seed ${seed}`).toEqual(
            strip(computeTable({ rules: awayRules, matches: earlier, teams: all6 })),
          );
          expect(strip(out.after), `seed ${seed}`).toEqual(
            strip(computeTable({ rules: awayRules, matches: [...earlier, target], teams: all6 })),
          );
        }
      }
    });
  });

  it('cartões da tabela atual: o jogo desfeito tira os cartões dele', () => {
    const cardRules = rulesFrom({
      standings: {
        points: { win: 3, draw: 1, loss: 0 },
        tie_breakers: ['goal_difference', 'fewest_red_cards'],
      },
      league: { teams: 6, matches_per_team: 10, title: true, zones: [] },
    });
    const played: MatchResult[] = [
      { id: 'm1', homeId: 'A', awayId: 'B', homeGoals: 1, awayGoals: 1, playedAt: '2026-01-01T00:00:00Z' },
      {
        id: 'm2',
        homeId: 'B',
        awayId: 'A',
        homeGoals: 0,
        awayGoals: 0,
        playedAt: '2026-01-02T00:00:00Z',
        cards: { home: { red: 1 } },
      },
    ];
    const current = computeTable({ rules: cardRules, matches: played, teams: all6 });
    const out = tablesAroundMatch(
      prepareFinishedLeagueMatch({ rules: cardRules, current, results: played, matchId: 'm2' }),
    );
    expect(out.before.find((r) => r.teamId === 'B')!.redCards).toBe(0);
    expect(out.after.find((r) => r.teamId === 'B')!.redCards).toBe(1);
    expect(out.after.slice(0, 2).map((r) => [r.teamId, r.decidedBy])).toEqual([
      ['A', null],
      ['B', 'fewest_red_cards'],
    ]);
  });

  it('pickGroupTable: com dois rótulos para a mesma liga, fica a tabela mais completa', () => {
    const fresh = [
      { participantId: 'A', played: 32 },
      { participantId: 'B', played: 31 },
    ];
    const stale = [
      { participantId: 'A', played: 31 },
      { participantId: 'B', played: 30 },
    ];
    expect(pickGroupTable([stale, fresh], 'A', 'B')).toBe(fresh);
    expect(pickGroupTable([fresh, stale], 'B', 'A')).toBe(fresh);
    expect(pickGroupTable([[{ participantId: 'A', played: 1 }]], 'A', 'B')).toBeUndefined();
  });

  it('leagueInputOf ordena pela posição', () => {
    const rows = computeTable({ rules, matches: randomDoubleRoundRobin(teams, rng(3)).slice(0, 9) });
    expect(leagueInputOf([...rows].reverse()).map((r) => r.teamId)).toEqual(rows.map((r) => r.teamId));
  });

  it('regulamento sem pontos corridos é recusado', () => {
    const fx = loadR32();
    const input = finishedInput(fx, 'vas-cor');
    expect(() =>
      finishedLeagueMatchStakes({ ...input, rules: { ...brasileiraoRules(), league: null } }),
    ).toThrow(LeagueInputError);
  });
});
