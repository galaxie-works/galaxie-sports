import { beforeAll, describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import type { CompetitionRules } from '../config/types.js';
import { makeStake } from './codes.js';
import { decisiveFlagsFromStakes } from './decisive.js';

let BRA: CompetitionRules;
beforeAll(async () => {
  BRA = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
});

describe('decisiveFlagsFromStakes', () => {
  it('título e rebaixamento do Brasileirão (Palmeiras x Bragantino)', () => {
    const stakes = [
      makeStake('home', 'in_title_race'),
      makeStake('away', 'at_risk_of_relegation'),
      makeStake('away', 'can_qualify_for_zone', { zone: 'sudamericana' }),
    ];
    expect(decisiveFlagsFromStakes(stakes, BRA)).toEqual(['title', 'relegation', 'qualification']);
  });

  it('a zona do regulamento decide o sinal da vaga', () => {
    const rules = {
      league: {
        teams: 6,
        matchesPerTeam: 10,
        meetingsPerPair: 2,
        title: true,
        zones: [
          { id: 'acesso', kind: 'promotion' as const, from: 1, to: 2 },
          { id: 'playout', kind: 'relegation_playoff' as const, from: 4, to: 4 },
          { id: 'fora', kind: 'elimination' as const, from: 5, to: 6 },
        ],
      },
    };
    expect(
      decisiveFlagsFromStakes([makeStake('home', 'can_clinch_zone', { zone: 'acesso' })], rules),
    ).toEqual(['qualification']);
    expect(
      decisiveFlagsFromStakes([makeStake('home', 'clinches_zone_with_win', { zone: 'playout' })], rules),
    ).toEqual(['relegation']);
    expect(
      decisiveFlagsFromStakes([makeStake('both', 'can_qualify_for_zone', { zone: 'fora' })], rules),
    ).toEqual(['elimination']);
    // zona fora do regulamento: vaga
    expect(
      decisiveFlagsFromStakes([makeStake('home', 'can_clinch_zone', { zone: 'desconhecida' })], null),
    ).toEqual(['qualification']);
  });

  it('o que já está resolvido não decide nada', () => {
    const stakes = [
      makeStake('home', 'mathematically_champion'),
      makeStake('away', 'mathematically_relegated'),
      makeStake('home', 'safe_from_relegation'),
      makeStake('away', 'mathematically_eliminated'),
      makeStake('home', 'qualifies_for_zone', { zone: 'libertadores_group_stage' }),
    ];
    expect(decisiveFlagsFromStakes(stakes, BRA)).toEqual([]);
  });

  it('eliminação na fase de grupos e sinais repetidos contam uma vez', () => {
    const stakes = [
      makeStake('home', 'eliminated_if_loses'),
      makeStake('away', 'eliminated_unless_wins'),
      makeStake('both', 'decides_title'),
    ];
    expect(decisiveFlagsFromStakes(stakes, null)).toEqual(['title', 'elimination']);
  });
});
