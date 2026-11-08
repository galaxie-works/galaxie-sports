/**
 * Leitura de `core.team_season_stat.stats` (#893) para a resposta da API. O JSON é nosso (escrito pelo
 * core-writer), mas a leitura é defensiva: uma linha gravada antes de um bloco novo existir sai com o bloco
 * vazio (null ou lista vazia), nunca quebra a rota.
 */
import type { TeamSeasonStatistics } from '@galaxie/contracts';

type Stats = Omit<TeamSeasonStatistics, 'competition' | 'season' | 'form' | 'updated_at'>;
type HomeAwayTotal = Stats['clean_sheets'];
type MinuteRange = Stats['cards']['yellow_by_minute'][number];
type GoalLine = Stats['goals']['scored_lines'][number];
type ScoreLine = NonNullable<Stats['biggest']['win']['home']>;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

function homeAway(v: unknown, parse: (x: unknown) => number | null = int): HomeAwayTotal {
  const o = obj(v);
  return { home: parse(o.home), away: parse(o.away), total: parse(o.total) };
}

function ranges(v: unknown): MinuteRange[] {
  return arr(v).flatMap((r) => {
    const o = obj(r);
    const count = int(o.count);
    return count == null ? [] : [{ from: int(o.from), to: int(o.to), count }];
  });
}

function lines(v: unknown): GoalLine[] {
  return arr(v).flatMap((r) => {
    const o = obj(r);
    const line = num(o.line);
    return line == null ? [] : [{ line, over: int(o.over), under: int(o.under) }];
  });
}

function score(v: unknown): ScoreLine | null {
  const o = obj(v);
  const f = int(o.for);
  const a = int(o.against);
  return f == null || a == null ? null : { for: f, against: a };
}

const sumOrZero = (list: MinuteRange[]) => list.reduce((s, r) => s + r.count, 0);

export function readTeamSeasonStats(raw: unknown): Stats {
  const s = obj(raw);
  const record = obj(s.record);
  const goals = obj(s.goals);
  const streaks = obj(s.streaks);
  const biggest = obj(s.biggest);
  const penalties = obj(s.penalties);
  const cards = obj(s.cards);
  const yellow = ranges(cards.yellow_by_minute);
  const red = ranges(cards.red_by_minute);
  return {
    record: {
      played: homeAway(record.played),
      won: homeAway(record.won),
      drawn: homeAway(record.drawn),
      lost: homeAway(record.lost),
    },
    goals: {
      scored: homeAway(goals.scored),
      conceded: homeAway(goals.conceded),
      scored_average: homeAway(goals.scored_average, num),
      conceded_average: homeAway(goals.conceded_average, num),
      scored_by_minute: ranges(goals.scored_by_minute),
      conceded_by_minute: ranges(goals.conceded_by_minute),
      scored_lines: lines(goals.scored_lines),
      conceded_lines: lines(goals.conceded_lines),
    },
    clean_sheets: homeAway(s.clean_sheets),
    failed_to_score: homeAway(s.failed_to_score),
    streaks: { wins: int(streaks.wins), draws: int(streaks.draws), losses: int(streaks.losses) },
    biggest: {
      win: { home: score(obj(biggest.win).home), away: score(obj(biggest.win).away) },
      loss: { home: score(obj(biggest.loss).home), away: score(obj(biggest.loss).away) },
      scored: { home: int(obj(biggest.scored).home), away: int(obj(biggest.scored).away) },
      conceded: { home: int(obj(biggest.conceded).home), away: int(obj(biggest.conceded).away) },
    },
    penalties: { scored: int(penalties.scored), missed: int(penalties.missed), total: int(penalties.total) },
    formations: arr(s.formations).flatMap((f) => {
      const o = obj(f);
      const played = int(o.played);
      return typeof o.formation === 'string' && o.formation && played != null
        ? [{ formation: o.formation, played }]
        : [];
    }),
    // sem nenhuma faixa nos dois, o bloco não veio (null); com amarelos e sem vermelhos, são zero vermelhos
    cards: {
      yellow: yellow.length || red.length ? sumOrZero(yellow) : null,
      red: yellow.length || red.length ? sumOrZero(red) : null,
      yellow_by_minute: yellow,
      red_by_minute: red,
    },
  };
}
