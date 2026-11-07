// Palpite e odds de exemplo (`/v1/events/{id}/predictions` e `/odds`) para a prévia do Builder e os testes. Segue o contrato
// completo da API (@galaxie/contracts): se ele mudar, o typecheck daqui acusa.
import type { EventOdds, EventPredictions } from '@galaxie/contracts';

import { sidesOf, type GsEvent } from './core/model.js';

/** Palpite do jogo de exemplo: o mandante favorito ("vence ou empata"), menos de 3,5 gols. */
export function samplePrediction(e: GsEvent, now: Date): EventPredictions {
  const { home, away } = sidesOf(e);
  const ref = (p: typeof home) =>
    p ? { id: p.id, name: p.name, short_name: p.short_name ?? null, logo: p.logo ?? null } : null;
  // depois de encerrado o jogo, o palpite continua o de antes do apito (a API não apaga)
  return {
    event_id: e.id,
    sport: e.sport,
    home: ref(home),
    away: ref(away),
    prediction: home
      ? {
          winner: { side: 'home', participant_id: home.id, win_or_draw: true },
          probabilities: { home: 48, draw: 30, away: 22 },
          goals: {
            total: { side: 'under', line: 3.5 },
            home: { side: 'under', line: 2.5 },
            away: { side: 'under', line: 1.5 },
          },
          comparison: [
            { key: 'form', home: 64, away: 36 },
            { key: 'attack', home: 58, away: 42 },
            { key: 'defense', home: 47, away: 53 },
            { key: 'poisson', home: 55, away: 45 },
            { key: 'h2h', home: 60, away: 40 },
            { key: 'goals', home: 57, away: 43 },
            { key: 'total', home: 56.8, away: 43.2 },
          ],
          recent_form: { home: null, away: null },
        }
      : null,
    updated_at: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
  };
}

/** Odds de exemplo do jogo, em consenso entre casas (sem identificá-las, como a API). */
export function sampleOdds(e: GsEvent, now: Date): EventOdds {
  const { home, away } = sidesOf(e);
  const ref = (p: typeof home) =>
    p ? { id: p.id, name: p.name, short_name: p.short_name ?? null, logo: p.logo ?? null } : null;
  const sel = (key: string, average: number, best: number, line: number | null = null, bookmakers = 8) => ({
    key,
    line,
    average,
    best,
    bookmakers,
  });
  return {
    event_id: e.id,
    sport: e.sport,
    home: ref(home),
    away: ref(away),
    markets: [
      {
        key: 'match_winner',
        selections: [sel('home', 1.92, 2.0), sel('draw', 3.35, 3.5), sel('away', 4.1, 4.4)],
      },
      {
        key: 'double_chance',
        selections: [
          sel('home_draw', 1.22, 1.25),
          sel('home_away', 1.33, 1.36),
          sel('draw_away', 1.85, 1.95),
        ],
      },
      {
        key: 'goals_over_under',
        selections: [
          sel('over', 1.4, 1.44, 1.5, 6),
          sel('under', 2.8, 2.9, 1.5, 6),
          sel('over', 2.05, 2.12, 2.5),
          sel('under', 1.76, 1.8, 2.5),
        ],
      },
      { key: 'both_teams_score', selections: [sel('yes', 1.9, 1.95), sel('no', 1.85, 1.9)] },
    ],
    bookmakers: 8,
    updated_at: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
  };
}
