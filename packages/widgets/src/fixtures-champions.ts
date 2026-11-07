// Dados de exemplo da galeria de campeões (`/v1/competitions/{id}/champions`, #831) para a prévia do Builder
// e os testes. Mesmos times de exemplo da Liga Exemplo (fixtures.ts).

/** Escudo genérico (SVG em data URI) na cor do time. */
function shield(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 4 6v9c0 7.5 5.1 13 12 15 6.9-2 12-7.5 12-15V6z" fill="${color}"/><path d="M16 7 9 9.5V15c0 4.6 3 8 7 9.5 4-1.5 7-4.9 7-9.5V9.5z" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const team = (n: number, name: string, short: string, color: string) => ({
  id: `0199a5c0-0000-7000-8000-0000000000a${n}`,
  name,
  provider_name: name,
  short_name: short,
  logo: shield(color),
});

const TEAMS = {
  aurora: team(1, 'Clube Aurora', 'Aurora', '#1d4ed8'),
  estrela: team(2, 'Estrela do Sul', 'Estrela', '#dc2626'),
  serra: team(3, 'Atlético Serra', 'Serra', '#15803d'),
  litoral: team(4, 'União Litoral', 'Litoral', '#0891b2'),
  planalto: team(5, 'Real Planalto', 'Planalto', '#7c3aed'),
} as const;
type TeamKey = keyof typeof TEAMS;

/** Campeão e vice de cada ano, do mais recente para trás. */
const HISTORY: [number, TeamKey, TeamKey][] = [
  [2025, 'aurora', 'estrela'],
  [2024, 'estrela', 'aurora'],
  [2023, 'aurora', 'serra'],
  [2022, 'serra', 'litoral'],
  [2021, 'aurora', 'estrela'],
  [2020, 'litoral', 'aurora'],
  [2019, 'estrela', 'planalto'],
  [2018, 'aurora', 'serra'],
  [2017, 'planalto', 'estrela'],
  [2016, 'estrela', 'litoral'],
  [2015, 'serra', 'aurora'],
  [2014, 'aurora', 'planalto'],
];

/** Corpo de `/v1/competitions/{id}/champions` com o histórico de exemplo; null para as outras rotas. */
export function championsPreviewBody(url: URL): unknown {
  const m = /\/v1\/competitions\/([^/]+)\/champions$/.exec(url.pathname.replace(/\/+$/, ''));
  if (!m) return null;
  const limit = Number(url.searchParams.get('limit')) || HISTORY.length;
  const withRunnerUp = url.searchParams.get('runner_up') === 'true';
  const editions = HISTORY.map(([year, champion, runnerUp]) => ({
    season_year: year,
    season_label: String(year),
    decided_on: `${year}-12-06`,
    champion: TEAMS[champion],
    champion_name: TEAMS[champion].name,
    runner_up: withRunnerUp ? TEAMS[runnerUp] : null,
  }));
  const counts = new Map<TeamKey, number[]>();
  for (const [year, champion] of HISTORY) counts.set(champion, [...(counts.get(champion) ?? []), year]);
  const sorted = [...counts].sort(([, a], [, b]) => b.length - a.length || b[0]! - a[0]!);
  return {
    competition: {
      id: '0199a5c0-0000-7000-8000-0000000000c1',
      slug: 'liga-exemplo',
      sport: 'football',
      name: 'Liga Exemplo',
      logo: null,
    },
    editions: editions.slice(0, limit),
    total_editions: editions.length,
    unlisted_champions: 0,
    ranking: sorted.map(([key, years], i) => ({
      rank: i + 1,
      name: TEAMS[key].name,
      participant: TEAMS[key],
      titles: years.length,
      seasons: years.map(String),
    })),
    ranking_complete: true,
    coverage: { first_year: 2014, complete_through: 2025 },
  };
}
