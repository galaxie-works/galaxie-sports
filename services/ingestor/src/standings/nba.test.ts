import type { MatchResult } from '@galaxie/rules';
import { describe, expect, it } from 'vitest';
import { canonicalConference, nbaZone, rankNbaStandings } from './nba.js';

let n = 0;
const game = (homeId: string, awayId: string, homeGoals: number, awayGoals: number): MatchResult => ({
  id: `g${++n}`,
  homeId,
  awayId,
  homeGoals,
  awayGoals,
  playedAt: new Date(Date.UTC(2024, 10, 1) + n * 86_400_000).toISOString(),
});

describe('rankNbaStandings', () => {
  const groupOf = new Map([
    ['BOS', 'east'],
    ['NYK', 'east'],
    ['MIA', 'east'],
    ['LAL', 'west'],
  ]);

  it('ordena por aproveitamento por conferência; jogo entre conferências conta para os dois', () => {
    const tables = rankNbaStandings(
      [
        game('BOS', 'NYK', 110, 100),
        game('NYK', 'MIA', 99, 90),
        game('BOS', 'LAL', 120, 121),
        game('MIA', 'BOS', 101, 100),
        game('LAL', 'NYK', 90, 91),
        game('BOS', 'LAL', 105, 100),
      ],
      groupOf,
    );
    expect(tables.map((t) => t.group)).toEqual(['east', 'west']);
    const east = tables[0]!.rows;
    // BOS 2-2, NYK 2-1, MIA 1-1 → NYK (.667), BOS (.500) e MIA (.500): confronto direto põe MIA à frente
    expect(east.map((r) => [r.teamId, r.won, r.lost, r.rank])).toEqual([
      ['NYK', 2, 1, 1],
      ['MIA', 1, 1, 2],
      ['BOS', 2, 2, 3],
    ]);
    expect(east[1]).toMatchObject({ decidedBy: 'win_percentage', points: 1, drawn: 0 });
    expect(east[2]).toMatchObject({ decidedBy: 'h2h_win_percentage' });
    const bos = east.find((r) => r.teamId === 'BOS')!;
    expect(bos).toMatchObject({
      goalsFor: 435,
      goalsAgainst: 422,
      goalDifference: 13,
      form: ['W', 'L', 'L', 'W'],
    });
    expect(tables[1]!.rows[0]).toMatchObject({ teamId: 'LAL', won: 1, lost: 2, awayWon: 1 });
  });

  it('empate no confronto direto vai para o saldo de pontos; time sem jogo entra zerado', () => {
    const tables = rankNbaStandings([game('BOS', 'NYK', 100, 90), game('NYK', 'BOS', 95, 94)], groupOf);
    expect(tables[0]!.rows.map((r) => [r.teamId, r.rank, r.decidedBy])).toEqual([
      ['BOS', 1, null],
      ['NYK', 2, 'point_difference'],
      ['MIA', 3, 'win_percentage'],
    ]);
    expect(tables[0]!.rows[2]).toMatchObject({ played: 0, won: 0, lost: 0 });
  });

  it('zonas: 1º–6º playoffs, 7º–10º play-in', () => {
    expect([1, 6, 7, 10, 11].map(nbaZone)).toEqual([
      'Promotion - NBA (Playoffs)',
      'Promotion - NBA (Playoffs)',
      'NBA Play-in',
      'NBA Play-in',
      null,
    ]);
  });
});

describe('canonicalConference', () => {
  it('nome legado da NBA v2 vira o do normalizador; os outros passam como estão', () => {
    expect(canonicalConference('east')).toBe('Eastern Conference');
    expect(canonicalConference('West')).toBe('Western Conference');
    expect(canonicalConference('Eastern Conference')).toBe('Eastern Conference');
    expect(canonicalConference('')).toBe('');
  });
});
