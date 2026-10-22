import type { EventStats, TeamStatistic } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { statRows } from './match-stats';

const stat = (code: TeamStatistic['code'], numeric: number | null, label = code ?? ''): TeamStatistic => ({
  type: code ?? 'x',
  value: numeric,
  code,
  label,
  numeric,
  source: 'provider',
});

const team = (side: 'home' | 'away', statistics: TeamStatistic[]) => ({
  team: { id: side, name: side, side, logo: null },
  statistics,
});

/** Palmeiras x Fluminense (semifinal da Libertadores 2026), já normalizado pela API. */
const stats: EventStats = {
  event_id: '01a163b8-7ca2-71e8-a92e-8dc201d5d83a',
  available: true,
  players: [],
  teams: [
    team('away', [
      stat('fouls', 13),
      stat('possession_pct', 46, 'Posse de bola'),
      stat('shots_total', 4),
      stat('offsides', 0),
      stat('red_cards', null),
      stat('xg', 0.24),
      stat('shots_inside_box', 2),
    ]),
    team('home', [
      stat('possession_pct', 54, 'Posse de bola'),
      stat('fouls', 11),
      stat('shots_total', 12),
      stat('offsides', 2),
      stat('red_cards', null),
      stat('xg', 0.64),
      stat('shots_inside_box', 6),
    ]),
  ],
};

describe('statRows', () => {
  const rows = statRows(stats);

  it('ordem fixa, mandante e visitante pelo lado, só os códigos da seção', () => {
    expect(rows.map((r) => r.code)).toEqual([
      'possession_pct',
      'shots_total',
      'xg',
      'fouls',
      'offsides',
      'red_cards',
    ]);
    expect(rows[0]).toMatchObject({ label: 'Posse de bola', home: 54, away: 46, best: 'home', share: 0.54 });
  });

  it('maior é melhor, exceto faltas, impedimentos e cartões; empate não destaca', () => {
    const best = Object.fromEntries(rows.map((r) => [r.code, r.best]));
    expect(best).toEqual({
      possession_pct: 'home',
      shots_total: 'home',
      xg: 'home',
      fouls: 'home',
      offsides: 'away',
      red_cards: null,
    });
  });

  it('contagem sem valor vira zero e fica sem barra', () => {
    expect(rows.find((r) => r.code === 'red_cards')).toMatchObject({ home: 0, away: 0, share: null });
  });

  it('sem estatística, sem linhas', () => {
    expect(statRows({ ...stats, available: false })).toEqual([]);
    expect(statRows({ ...stats, teams: [] })).toEqual([]);
    expect(statRows(null)).toEqual([]);
  });
});
