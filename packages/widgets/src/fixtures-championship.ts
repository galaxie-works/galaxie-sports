// Dados de exemplo dos widgets do campeonato (épico #820): clássicos da semana, artilharia e campeões. Seguem os
// contratos da API (@galaxie/contracts) e usam os times e o clássico da liga de exemplo (fixtures.ts).
import type { Champions, Leaders, UpcomingDerby } from '@galaxie/contracts';

import type { GsDerbyRecord, GsEvent, GsStandings } from './core/model.js';

const COMPETITION_ID = '0199a5c0-0000-7000-8000-0000000000c1';
const person = (n: number) => `0199a5c0-0000-7000-8000-0000000000${(0xe0 + n).toString(16)}`;

type Team = GsStandings['groups'][number]['rows'][number]['participant'];

const ref = (t: Team) => ({ id: t.id, name: t.name, short_name: t.short_name ?? null, logo: t.logo ?? null });

/** Artilharia, assistências ou cartões da liga de exemplo. */
export function sampleLeaders(teams: readonly Team[], category: Leaders['category'], limit: number): Leaders {
  const players: [string, number, number, number, number, number][] = [
    // nome, time, gols, assistências, amarelos, vermelhos
    ['Rafael Lima', 0, 14, 4, 3, 0],
    ['Diego Costa Neto', 1, 11, 6, 5, 1],
    ['Bruno Teixeira', 2, 11, 2, 2, 0],
    ['Lucas Andrade', 3, 9, 7, 6, 0],
    ['Mateus Rocha', 4, 7, 3, 8, 1],
    ['Caio Ferreira', 5, 6, 9, 1, 0],
    ['Thiago Nunes', 0, 4, 8, 4, 2],
  ];
  const value = (p: (typeof players)[number]) =>
    category === 'goals' ? p[2] : category === 'assists' ? p[3] : p[4] + p[5];
  const rows = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => value(p) > 0)
    .sort((a, b) => value(b.p) - value(a.p) || (category === 'cards' ? b.p[5] - a.p[5] : 0) || a.i - b.i);
  const data: Leaders['data'] = [];
  rows.forEach(({ p, i }, n) => {
    const prev = rows[n - 1];
    const tie = prev && value(prev.p) === value(p) && (category !== 'cards' || prev.p[5] === p[5]);
    const team = teams[p[1] % Math.max(1, teams.length)];
    data.push({
      rank: tie ? data[n - 1]!.rank : n + 1,
      person: { id: person(i), name: p[0], photo: null, nationality: 'Brazil' },
      team: team ? ref(team) : null,
      teams: 1,
      appearances: 30 - i,
      minutes: 2400 - i * 90,
      goals: p[2],
      assists: p[3],
      yellow_cards: p[4],
      red_cards: p[5],
    });
  });
  return {
    competition_id: COMPETITION_ID,
    sport: 'football',
    season: { year: 2026, label: '2026' },
    category,
    data: data.slice(0, limit),
    updated_at: '2026-11-05T12:00:00Z',
  };
}

/** Campeões da liga de exemplo, ano a ano, com o vice e o ranking. */
export function sampleChampions(teams: readonly Team[], limit: number): Champions {
  const order = [0, 1, 0, 2, 3, 0, 1, 4, 2, 0, 5, 1];
  const data: Champions['data'] = order.map((t, i) => {
    const year = 2025 - i;
    const champ = teams[t % Math.max(1, teams.length)];
    const runner = teams[(t + 1) % Math.max(1, teams.length)];
    return {
      season_year: year,
      season_label: String(year),
      decided_on: `${year}-12-01`,
      champion: champ ? ref(champ) : null,
      runner_up: runner ? ref(runner) : null,
    };
  });
  const tally = new Map<string, { team: ReturnType<typeof ref>; titles: number; last: string }>();
  for (const e of data) {
    if (!e.champion) continue;
    const t = tally.get(e.champion.id) ?? { team: e.champion, titles: 0, last: e.season_label };
    t.titles += 1;
    tally.set(e.champion.id, t);
  }
  return {
    competition_id: COMPETITION_ID,
    sport: 'football',
    data: data.slice(0, limit),
    editions: data.length,
    ranking: [...tally.values()].sort((a, b) => b.titles - a.titles || Number(b.last) - Number(a.last)),
    coverage: { first_year: 2014, complete_through: 2025, unidentified: 0 },
  };
}

/** O clássico do jogo de exemplo que ainda vai começar (e o retrospecto dele). */
export function sampleDerbies(events: readonly GsEvent[]): {
  upcoming: UpcomingDerby[];
  records: GsDerbyRecord[];
} {
  const upcoming: UpcomingDerby[] = [];
  const records: GsDerbyRecord[] = [];
  for (const e of events) {
    if (!e.derby || e.status !== 'scheduled') continue;
    const sides = e.participants.map((p) => ({
      side: p.side,
      id: p.id,
      name: p.name,
      slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    }));
    upcoming.push({
      event_id: e.id,
      starts_at: e.starts_at,
      status: e.status,
      competition: e.competition
        ? { id: e.competition.id, slug: e.competition.slug, name: e.competition.name }
        : null,
      participants: sides,
      derby: {
        slug: e.derby.slug,
        name: e.derby.name,
        aliases: [],
        scope: 'state',
        intensity: e.derby.intensity,
        review_status: 'approved',
        teams: sides.map((s) => ({
          slug: s.slug,
          participant_id: s.id,
          name: s.name,
          country: 'BR',
          kind: 'club' as const,
        })),
      },
    });
    records.push({
      slug: e.derby.slug,
      all_time: {
        matches: 214,
        draws: 61,
        teams: [
          { slug: sides[0]!.slug, wins: 82 },
          { slug: sides[1]!.slug, wins: 71 },
        ],
        basis: 'official',
      },
      retrospect: { available: true, since: 2013, matches: 28, draws: 9, teams: [] },
    });
  }
  return { upcoming, records };
}

/** Resposta de exemplo das rotas do campeonato; null quando a rota é de outro widget. */
export function championshipPreviewBody(
  url: URL,
  data: { events: readonly GsEvent[]; standings: GsStandings },
): unknown | null {
  const path = url.pathname.replace(/\/+$/, '');
  const teams = data.standings.groups[0]?.rows.map((r) => r.participant) ?? [];
  const limit = (fallback: number) => Number(url.searchParams.get('limit')) || fallback;
  if (/\/v1\/competitions\/[^/]+\/seasons\/[^/]+\/leaders$/.test(path)) {
    const category = url.searchParams.get('category');
    return sampleLeaders(
      teams,
      category === 'assists' || category === 'cards' ? category : 'goals',
      limit(10),
    );
  }
  if (/\/v1\/competitions\/[^/]+\/champions$/.test(path)) return sampleChampions(teams, limit(20));
  if (path.endsWith('/v1/derbies/upcoming')) return { data: sampleDerbies(data.events).upcoming };
  const derby = /\/v1\/derbies\/([^/]+)$/.exec(path);
  if (derby) {
    const slug = decodeURIComponent(derby[1]!);
    return sampleDerbies(data.events).records.find((r) => r.slug === slug) ?? null;
  }
  return null;
}
