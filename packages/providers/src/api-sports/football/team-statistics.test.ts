import { describe, expect, it } from 'vitest';
import { loadFootballFixture } from '../../../test/load-fixture.js';
import { normalizeFootballEnvelope, NORMALIZABLE_FOOTBALL_ENDPOINTS } from './normalize.js';
import { minuteRanges, recentFirstForm, scoreLine, teamSeasonStatsValues } from './team-statistics.js';
import type { ApiTeamStatistics } from './types.js';

const FETCHED = new Date('2026-11-07T12:00:00Z');
const envelope = () =>
  loadFootballFixture<{ response: ApiTeamStatistics; parameters: Record<string, string> }>(
    'teams-statistics-71-2024-121.json',
  );

describe('teams/statistics → core.team_season_stat (#893)', () => {
  it('é endpoint normalizável e responde um objeto (1 item), não lista', () => {
    expect(NORMALIZABLE_FOOTBALL_ENDPOINTS).toContain('/teams/statistics');
    const env = envelope();
    const out = normalizeFootballEnvelope('/teams/statistics', env, FETCHED, env.parameters)!;
    expect(out.items).toBe(1);
    expect(out.batch.teamSeasonStats).toHaveLength(1);
    // time e competição como referência, para o provider_map achar (ou criar) os nossos ids
    expect(out.batch.participants).toEqual([
      expect.objectContaining({ id: '121', name: 'Palmeiras', reference: true }),
    ]);
    expect(out.batch.competitions).toEqual([
      expect.objectContaining({ id: '71', seasons: [expect.objectContaining({ year: 2024 })] }),
    ]);
    expect(out.batch.teamSeasonStats[0]).toMatchObject({
      participantId: '121',
      season: { competitionId: '71', year: 2024 },
      played: 38,
      won: 22,
      drawn: 7,
      lost: 9,
      goalsFor: 60,
      goalsAgainst: 33,
      cleanSheets: 15,
      failedToScore: 5,
    });
  });

  it('guarda o dado no nosso formato: casa e fora, médias em número, sem percentuais', () => {
    const v = teamSeasonStatsValues(envelope().response);
    expect(v.stats.record.won).toEqual({ home: 13, away: 9, total: 22 });
    expect(v.stats.goals.scored_average).toEqual({ home: 1.8, away: 1.3, total: 1.6 });
    expect(v.stats.goals.scored_by_minute).toEqual([
      { from: 0, to: 15, count: 7 },
      { from: 16, to: 30, count: 9 },
      { from: 31, to: 45, count: 11 },
      { from: 46, to: 60, count: 8 },
      { from: 61, to: 75, count: 10 },
      { from: 76, to: 90, count: 15 },
    ]);
    expect(v.stats.goals.scored_lines[2]).toEqual({ line: 2.5, over: 6, under: 32 });
    expect(v.stats.streaks).toEqual({ wins: 5, draws: 1, losses: 1 });
    expect(v.stats.penalties).toEqual({ scored: 6, missed: 1, total: 7 });
    expect(v.stats.formations.map((f) => f.formation)).toEqual(['4-2-3-1', '4-4-2', '3-5-2']);
    expect(v.stats.cards.red_by_minute).toEqual([
      { from: 31, to: 45, count: 1 },
      { from: 76, to: 90, count: 2 },
    ]);
    expect(JSON.stringify(v.stats)).not.toContain('%');
  });

  it('maiores placares vistos pelo time: fora, os gols dele vêm depois', () => {
    const v = teamSeasonStatsValues(envelope().response);
    expect(v.stats.biggest.win).toEqual({ home: { for: 5, against: 0 }, away: { for: 3, against: 0 } });
    expect(v.stats.biggest.loss).toEqual({ home: { for: 0, against: 2 }, away: { for: 1, against: 3 } });
    expect(v.stats.biggest.scored).toEqual({ home: 5, away: 3 });
    expect(scoreLine(null, 'home')).toBeNull();
    expect(scoreLine('x', 'away')).toBeNull();
  });

  it('forma do mais recente ao mais antigo, só W/D/L', () => {
    expect(recentFirstForm('WWDL')).toBe('LDWW');
    expect(recentFirstForm(' w-d ')).toBe('DW');
    expect(recentFirstForm('')).toBeNull();
    expect(recentFirstForm(null)).toBeNull();
    expect(teamSeasonStatsValues(envelope().response).form).toMatch(/^LWDL/);
  });

  it('faixa sem minuto informado fica no fim; contagem nula sai', () => {
    expect(
      minuteRanges({
        '': { total: 2, percentage: '5%' },
        '76-90': { total: 1, percentage: null },
        '0-15': { total: null, percentage: null },
      }),
    ).toEqual([
      { from: 76, to: 90, count: 1 },
      { from: null, to: null, count: 2 },
    ]);
  });

  it('resposta vazia (lista) ou sem time não vira linha', () => {
    expect(normalizeFootballEnvelope('/teams/statistics', { response: [] }, FETCHED)!.items).toBe(0);
    const semTime = { ...envelope().response, team: null };
    expect(normalizeFootballEnvelope('/teams/statistics', { response: semTime }, FETCHED)!.items).toBe(0);
  });

  it('bloco ausente vira nulo ou lista vazia, sem quebrar', () => {
    const v = teamSeasonStatsValues({
      league: { id: 1, name: 'X', season: 2024 },
      team: { id: 1, name: 'A' },
    });
    expect(v.played).toBeNull();
    expect(v.form).toBeNull();
    expect(v.stats.formations).toEqual([]);
    expect(v.stats.goals.scored_by_minute).toEqual([]);
    expect(v.stats.biggest.win).toEqual({ home: null, away: null });
  });
});
