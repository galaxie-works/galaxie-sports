/**
 * Números de jogador a partir das estatísticas por partida da api-sports (`fixtures/players`, em
 * `core.football_fixture.detail.players`): uma linha por jogo, somadas por temporada, competição e time.
 */

/** `statistics[0]` de um jogador no detalhe da partida (só os campos usados aqui). */
export interface FixturePlayerStat {
  games?: {
    minutes?: number | null;
    number?: number | null;
    position?: string | null;
    rating?: string | number | null;
    substitute?: boolean | null;
  } | null;
  goals?: { total?: number | null; assists?: number | null } | null;
  cards?: { yellow?: number | null; red?: number | null } | null;
}

/** Os números de um jogo. */
export interface MatchNumbers {
  played: boolean;
  started: boolean;
  minutes: number | null;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  rating: number | null;
  number: number | null;
  position: string | null;
}

/** Soma de vários jogos (o `PersonNumbers` do contrato). */
export interface SummedNumbers {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  rating: number | null;
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Posição das escalações (G, D, M, F) → a do elenco (`players/squads`). */
const POSITIONS: Record<string, string> = {
  G: 'Goalkeeper',
  D: 'Defender',
  M: 'Midfielder',
  F: 'Attacker',
};

export function positionName(code: string | null | undefined): string | null {
  if (!code) return null;
  return POSITIONS[code] ?? (Object.values(POSITIONS).includes(code) ? code : null);
}

export function matchNumbers(st: FixturePlayerStat | null | undefined): MatchNumbers {
  const minutes = int(st?.games?.minutes);
  const rating = st?.games?.rating == null ? null : Number(st.games.rating);
  const played = (minutes ?? 0) > 0;
  return {
    played,
    started: played && st?.games?.substitute === false,
    minutes,
    goals: int(st?.goals?.total) ?? 0,
    assists: int(st?.goals?.assists) ?? 0,
    yellow_cards: int(st?.cards?.yellow) ?? 0,
    red_cards: int(st?.cards?.red) ?? 0,
    rating: rating !== null && Number.isFinite(rating) && rating > 0 ? rating : null,
    number: int(st?.games?.number),
    position: positionName(st?.games?.position),
  };
}

/** Soma os jogos; a nota é a média dos jogos com nota, com duas casas. */
export function sumNumbers(lines: MatchNumbers[]): SummedNumbers {
  const rated = lines.filter((l) => l.played && l.rating !== null).map((l) => l.rating!);
  return {
    appearances: lines.filter((l) => l.played).length,
    starts: lines.filter((l) => l.started).length,
    minutes: lines.reduce((a, l) => a + (l.minutes ?? 0), 0),
    goals: lines.reduce((a, l) => a + l.goals, 0),
    assists: lines.reduce((a, l) => a + l.assists, 0),
    yellow_cards: lines.reduce((a, l) => a + l.yellow_cards, 0),
    red_cards: lines.reduce((a, l) => a + l.red_cards, 0),
    rating: rated.length ? Math.round((rated.reduce((a, r) => a + r, 0) / rated.length) * 100) / 100 : null,
  };
}

/** O valor mais frequente (empate: o primeiro a aparecer). */
export function mostCommon<T>(values: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let max = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > max) {
      max = n;
      best = v;
    }
  }
  return best;
}

/** Linha de `core.person_season_stat` (`players?league&season`), só os números usados aqui. */
export interface ProviderSeasonRow {
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
  /** `numeric` do Postgres chega como texto. */
  rating: string | number | null;
}

/** Números de uma competição na temporada como o fornecedor os soma (`players?league&season`). */
export function providerNumbers(r: ProviderSeasonRow): SummedNumbers {
  const rating = r.rating == null ? null : Number(r.rating);
  return {
    appearances: r.appearances ?? 0,
    starts: r.lineups ?? 0,
    minutes: r.minutes ?? 0,
    goals: r.goals ?? 0,
    assists: r.assists ?? 0,
    yellow_cards: r.yellowCards ?? 0,
    red_cards: r.redCards ?? 0,
    rating: rating !== null && Number.isFinite(rating) && rating > 0 ? Math.round(rating * 100) / 100 : null,
  };
}

/** Soma várias competições; a nota é a média ponderada pelos jogos das que têm nota. */
export function addNumbers(list: SummedNumbers[]): SummedNumbers {
  const rated = list.filter((s) => s.rating !== null && s.appearances > 0);
  const weight = rated.reduce((a, s) => a + s.appearances, 0);
  return {
    appearances: list.reduce((a, s) => a + s.appearances, 0),
    starts: list.reduce((a, s) => a + s.starts, 0),
    minutes: list.reduce((a, s) => a + s.minutes, 0),
    goals: list.reduce((a, s) => a + s.goals, 0),
    assists: list.reduce((a, s) => a + s.assists, 0),
    yellow_cards: list.reduce((a, s) => a + s.yellow_cards, 0),
    red_cards: list.reduce((a, s) => a + s.red_cards, 0),
    rating: weight
      ? Math.round((rated.reduce((a, s) => a + s.rating! * s.appearances, 0) / weight) * 100) / 100
      : null,
  };
}

/**
 * Números de uma competição: os do fornecedor (cobrem jogos sem detalhe de partida) ou, se ele ainda não
 * tem a temporada ou ficou para trás, a soma das partidas.
 */
export function pickNumbers(
  provider: SummedNumbers | null,
  matches: SummedNumbers | null,
): { numbers: SummedNumbers; source: 'provider' | 'matches' } | null {
  if (provider && provider.appearances >= (matches?.appearances ?? 0) && provider.appearances > 0)
    return { numbers: provider, source: 'provider' };
  if (matches && matches.appearances > 0) return { numbers: matches, source: 'matches' };
  return null;
}
