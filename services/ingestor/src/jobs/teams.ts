import type { RawSource } from './runtime/raw-source.js';

/** Time como aparece em /teams (`response[].team`). */
export interface TeamRef {
  id: number;
  name: string;
  country: string | null;
  national: boolean;
}

interface ApiTeamItem {
  team?: { id?: number; name?: string; country?: string | null; national?: boolean };
}

export function apiTeams(response: unknown): TeamRef[] {
  if (!Array.isArray(response)) return [];
  return (response as ApiTeamItem[])
    .filter((t) => typeof t?.team?.id === 'number')
    .map((t) => ({
      id: t.team!.id!,
      name: t.team!.name ?? '',
      country: t.team!.country ?? null,
      national: t.team!.national ?? false,
    }));
}

/** Times de uma competição × temporada a partir de teams?league&season já gravado (zero cota). */
export async function teamsOfSeason(raw: RawSource, leagueId: number, season: number): Promise<TeamRef[]> {
  const out = new Map<number, TeamRef>();
  for await (const e of raw.latest({
    sport: 'football',
    endpoint: '/teams',
    where: { league: String(leagueId), season: String(season) },
  })) {
    for (const t of apiTeams(e.response)) out.set(t.id, t);
  }
  return [...out.values()];
}

/**
 * Para cada liga, os times da temporada mais recente presente no raw (elenco "atual").
 * Ligas sem nenhuma lista de times no raw ficam de fora (rode bootstrap:seasons antes).
 */
export async function latestTeamsByLeague(
  raw: RawSource,
  leagueIds: Iterable<number>,
): Promise<Map<number, { season: number; teams: TeamRef[] }>> {
  const wanted = new Set(leagueIds);
  const out = new Map<number, { season: number; teams: TeamRef[] }>();
  for await (const e of raw.latest({ sport: 'football', endpoint: '/teams', has: ['league', 'season'] })) {
    const league = Number(e.params.league);
    const season = Number(e.params.season);
    if (!wanted.has(league)) continue;
    const prev = out.get(league);
    if (prev && prev.season >= season) continue;
    const teams = apiTeams(e.response);
    if (teams.length) out.set(league, { season, teams });
  }
  return out;
}

export function teamMatchKey(name: string, country: string | null): string {
  return `${name.trim().toLowerCase()}|${(country ?? '').trim().toLowerCase()}`;
}

/** Índice nome+país → IDs, a partir de todas as listas de times do raw (resolve IDs ausentes na base semântica). */
export async function teamIndexFromRaw(raw: RawSource): Promise<Map<string, Set<number>>> {
  const index = new Map<string, Set<number>>();
  for await (const e of raw.latest({ sport: 'football', endpoint: '/teams' })) {
    for (const t of apiTeams(e.response)) {
      const key = teamMatchKey(t.name, t.country);
      const ids = index.get(key) ?? new Set<number>();
      ids.add(t.id);
      index.set(key, ids);
    }
  }
  return index;
}
