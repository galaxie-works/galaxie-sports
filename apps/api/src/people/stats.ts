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
