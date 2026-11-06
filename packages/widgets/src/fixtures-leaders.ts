// Artilharia e líderes de exemplo (#828): jogadores fictícios nos times da tabela de exemplo.
import type { CompetitionLeaders } from '@galaxie/contracts';

import type { GsCompetitionLeaders, GsLeaderCategory, GsStandings } from './core/model.js';

const PLAYERS: [name: string, goals: number, assists: number, yellow: number, red: number, apps: number][] = [
  ['Rafael Prado', 14, 3, 2, 0, 19],
  ['Matías Correa', 11, 6, 4, 0, 20],
  ['Diego Lima', 11, 2, 7, 1, 18],
  ['Thiago Ramos', 9, 8, 3, 0, 20],
  ['Lucas Ferraz', 8, 1, 5, 1, 17],
  ['Bruno Teles', 7, 9, 1, 0, 20],
  ['Iván Rojas', 6, 4, 8, 0, 19],
  ['Caio Mendes', 6, 5, 2, 0, 15],
  ['Pedro Alves', 5, 7, 6, 2, 18],
  ['Juan Herrera', 4, 3, 9, 1, 20],
  ['Gabriel Souza', 3, 6, 3, 0, 16],
  ['André Costa', 2, 2, 6, 2, 19],
];

const value = (p: (typeof PLAYERS)[number], category: GsLeaderCategory) =>
  category === 'goals' ? p[1] : category === 'assists' ? p[2] : p[3] + p[4];

/** Resposta de `/leaders` com os times da tabela de exemplo (o jogador i joga no time i da tabela). */
export function previewLeaders(
  standings: GsStandings,
  category: GsLeaderCategory,
  limit: number,
): GsCompetitionLeaders {
  const teams = standings.groups[0]?.rows.map((r) => r.participant) ?? [];
  const sorted = PLAYERS.map((p, i) => ({ p, i }))
    .filter(({ p }) => value(p, category) > 0)
    .sort(
      (a, b) =>
        value(b.p, category) - value(a.p, category) ||
        (category === 'cards' ? b.p[4] - a.p[4] : 0) ||
        a.p[5] - b.p[5],
    )
    .slice(0, limit);
  let rank = 0;
  const body: CompetitionLeaders = {
    competition_id: standings.competition_id,
    sport: standings.sport ?? 'football',
    season: standings.season,
    category,
    data: sorted.map(({ p, i }, n) => {
      if (n === 0 || value(p, category) !== value(sorted[n - 1]!.p, category)) rank = n + 1;
      const t = teams.length ? teams[i % teams.length]! : null;
      return {
        rank,
        person: {
          id: `0199a5c0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
          name: p[0],
          photo: null,
        },
        team: t
          ? { id: t.id, name: t.name, provider_name: t.name, short_name: t.short_name, logo: t.logo }
          : null,
        value: value(p, category),
        appearances: p[5],
        minutes: p[5] * 80,
        goals: p[1],
        assists: p[2],
        yellow_cards: p[3],
        red_cards: p[4],
      };
    }),
    updated_at: standings.updated_at,
  };
  return body;
}
