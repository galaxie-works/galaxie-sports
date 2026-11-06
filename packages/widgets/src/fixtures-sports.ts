// Dados de exemplo dos outros esportes coletivos (épico #731): o mesmo roteiro de jogos do futebol
// (quem ganhou, quem perdeu), com placar, parciais e tabela no jeito de cada esporte.
import { sportProfile, type GsEvent, type GsStandings } from './core/model.js';

type Pair = [number, number];

/** Parciais de um jogo típico de cada esporte (casa, fora). O vôlei conta os pontos de cada set. */
const SAMPLE_PERIODS: Record<string, { codes: string[]; variants: Pair[][] }> = {
  basketball: {
    codes: ['q1', 'q2', 'q3', 'q4'],
    variants: [
      [
        [24, 19],
        [21, 23],
        [26, 18],
        [19, 22],
      ],
      [
        [18, 22],
        [25, 20],
        [17, 24],
        [22, 21],
      ],
    ],
  },
  nba: {
    codes: ['q1', 'q2', 'q3', 'q4'],
    variants: [
      [
        [31, 27],
        [26, 29],
        [30, 24],
        [28, 25],
      ],
      [
        [25, 30],
        [29, 27],
        [24, 31],
        [27, 26],
      ],
    ],
  },
  volleyball: {
    codes: ['s1', 's2', 's3', 's4'],
    variants: [
      [
        [25, 21],
        [23, 25],
        [25, 19],
        [25, 22],
      ],
      [
        [25, 18],
        [25, 23],
        [26, 24],
      ],
    ],
  },
  'american-football': {
    codes: ['q1', 'q2', 'q3', 'q4'],
    variants: [
      [
        [7, 3],
        [10, 7],
        [0, 7],
        [7, 3],
      ],
      [
        [3, 0],
        [7, 14],
        [14, 3],
        [3, 7],
      ],
    ],
  },
  baseball: {
    codes: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9'],
    variants: [
      [
        [0, 1],
        [2, 0],
        [0, 0],
        [1, 0],
        [0, 2],
        [0, 0],
        [3, 0],
        [0, 1],
        [0, 0],
      ],
      [
        [1, 0],
        [0, 0],
        [0, 3],
        [2, 0],
        [0, 0],
        [1, 1],
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    ],
  },
  hockey: {
    codes: ['p1', 'p2', 'p3'],
    variants: [
      [
        [1, 0],
        [1, 2],
        [1, 0],
      ],
      [
        [0, 1],
        [2, 0],
        [2, 1],
      ],
    ],
  },
  handball: {
    codes: ['h1', 'h2'],
    variants: [
      [
        [15, 13],
        [14, 12],
      ],
      [
        [12, 14],
        [17, 11],
      ],
    ],
  },
  rugby: {
    codes: ['h1', 'h2'],
    variants: [
      [
        [17, 10],
        [12, 13],
      ],
      [
        [10, 13],
        [21, 7],
      ],
    ],
  },
  afl: {
    codes: ['q1', 'q2', 'q3', 'q4'],
    variants: [
      [
        [26, 19],
        [21, 22],
        [31, 14],
        [16, 25],
      ],
      [
        [20, 27],
        [33, 15],
        [14, 22],
        [25, 13],
      ],
    ],
  },
};

/** Esportes coletivos com dados de exemplo próprios (fora o futebol). */
export const SAMPLE_SPORTS = Object.keys(SAMPLE_PERIODS);

/** Período do relógio do fornecedor para o código da parcial (q3 → Q3, h2 → 2H, i6 → IN6). */
function providerPeriod(code: string): string {
  if (code.startsWith('h')) return `${code.slice(1)}H`;
  if (code.startsWith('i')) return `IN${code.slice(1)}`;
  return code.toUpperCase();
}

const sum = (rows: Pair[], i: 0 | 1) => rows.reduce((n, r) => n + r[i], 0);
/** No vôlei o placar são os sets vencidos; nos outros, a soma das parciais. */
const totals = (sport: string, rows: Pair[]): Pair =>
  sport === 'volleyball'
    ? [rows.filter((r) => r[0] > r[1]).length, rows.filter((r) => r[1] > r[0]).length]
    : [sum(rows, 0), sum(rows, 1)];

/** AFL: gols e behinds que dão os pontos (6 × gols + behinds), com o número de behinds plausível. */
function goalsBehinds(points: number) {
  const goals = Math.floor(points / 7);
  return { goals, behinds: points - goals * 6 };
}

/**
 * Troca o placar de futebol do jogo de exemplo pelo do esporte: mesmo vencedor (empate vira vitória do
 * mandante onde não há empate), parciais de um jogo típico e, ao vivo, só as parciais já jogadas.
 */
export function sportifyEvent<E extends GsEvent>(event: E, sport: string, variant: number): E {
  const sample = SAMPLE_PERIODS[sport];
  if (!sample) return event;
  const profile = sportProfile(sport);
  const live = event.status === 'live' || event.status === 'break';
  const started = live || event.status === 'finished';
  const base = { ...event, sport, clock: null };
  if (!started) return base;
  const [h, a] = [event.score.home ?? 0, event.score.away ?? 0];
  const winner = event.score.penalty
    ? event.score.penalty.home! > event.score.penalty.away!
      ? 'home'
      : 'away'
    : h > a
      ? 'home'
      : h < a
        ? 'away'
        : profile.draws
          ? 'draw'
          : 'home';
  let rows = sample.variants[variant % sample.variants.length]!.map((r) => [...r] as Pair);
  const [th, ta] = totals(sport, rows);
  if ((winner === 'home' && th < ta) || (winner === 'away' && ta < th)) rows = rows.map(([x, y]) => [y, x]);
  if (winner === 'draw') {
    const [dh, da] = totals(sport, rows);
    const last = rows[rows.length - 1]!;
    if (dh > da) last[1] += dh - da;
    else last[0] += da - dh;
  }
  // ao vivo: as parciais já disputadas e a em andamento
  const played = live ? rows.slice(0, Math.max(1, Math.ceil(rows.length * 0.6))) : rows;
  const [home, away] = totals(sport, played);
  const periods = played.map(([x, y], i) => ({ code: sample.codes[i]!, home: x, away: y }));
  return {
    ...base,
    clock: live
      ? { minute: null, extra: null, period: providerPeriod(periods[periods.length - 1]!.code) }
      : null,
    participants: event.participants.map((p) => ({
      ...p,
      winner: live ? null : winner === 'draw' ? null : p.side === winner,
    })),
    score: {
      ...event.score,
      home,
      away,
      penalty: null,
      halftime: null,
      periods,
      ...(sport === 'afl'
        ? {
            goals_behinds: { home: goalsBehinds(home), away: goalsBehinds(away) },
          }
        : {}),
    },
  };
}

/** Placar médio por jogo e quanto o saldo de gols do exemplo pesa no esporte (pró e contra da tabela). */
const SCORE_SCALE: Record<string, [number, number]> = {
  basketball: [80, 4],
  nba: [108, 4],
  volleyball: [1, 1],
  'american-football': [20, 3],
  baseball: [4, 1],
  hockey: [2, 1],
  handball: [26, 2],
  rugby: [20, 3],
  afl: [80, 6],
};

/** A tabela de exemplo no jeito do esporte: sem empate onde não há, pontos pela regra dele, DP no hóquei. */
export function sportifyStandings<S extends GsStandings>(standings: S, sport: string): S {
  const scale = SCORE_SCALE[sport];
  if (!scale) return standings;
  const profile = sportProfile(sport);
  const [avg, k] = scale;
  return {
    ...standings,
    sport,
    groups: standings.groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => {
        // sem empate: metade vira vitória e metade derrota
        const won = profile.draws ? r.won : r.won + Math.ceil(r.drawn / 2);
        const drawn = profile.draws ? r.drawn : 0;
        const lost = profile.draws ? r.lost : r.lost + Math.floor(r.drawn / 2);
        const played = won + drawn + lost;
        const otLost = profile.overtimeLosses ? Math.min(lost, 1 + (r.rank % 2)) : null;
        const otWon = profile.overtimeLosses ? Math.min(won, r.rank % 3) : null;
        const gf = played * avg + (r.goals_for ?? 0) * k;
        const ga = played * avg + (r.goals_against ?? 0) * k;
        const points = !profile.points
          ? won
          : sport === 'hockey'
            ? won * 2 + (otLost ?? 0)
            : won * profile.pointsPerWin + drawn * (profile.pointsPerWin / 2);
        return {
          ...r,
          points,
          played,
          won,
          drawn,
          lost,
          ot_won: otWon,
          ot_lost: otLost,
          goals_for: gf,
          goals_against: ga,
          goal_diff: gf - ga,
          form: profile.draws ? r.form : (r.form ?? '').replace(/D/g, 'W'),
          description: null,
        };
      }),
    })),
  };
}

/** Retrospecto sem empate onde o esporte não tem: os empates do exemplo viram vitórias do primeiro time. */
export function sportifyH2hSummary<
  T extends { draws: number; teams: { id: string; wins: number; goals: number | null }[] },
>(summary: T, sport: string): T {
  if (sportProfile(sport).draws || !summary.draws) return summary;
  return {
    ...summary,
    draws: 0,
    teams: summary.teams.map((t, i) => (i === 0 ? { ...t, wins: t.wins + summary.draws } : t)),
  };
}
