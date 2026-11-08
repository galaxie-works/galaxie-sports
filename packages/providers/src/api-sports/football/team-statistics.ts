/**
 * `teams/statistics` da api-sports → nosso formato (#893). Puro: entra o objeto do fornecedor, sai o que
 * `core.team_season_stat` guarda. Guardamos o dado, não o formato: percentuais em texto saem (derivam das
 * contagens), placares viram gols do time e do adversário, a forma passa a ser do mais recente ao mais antigo.
 */
import type {
  GoalLineCount,
  HomeAwayTotal,
  MinuteRangeCount,
  TeamScoreLine,
  TeamSeasonStatsDetail,
} from '../../model.js';
import type { ApiHomeAway, ApiMinuteBuckets, ApiTeamStatistics } from './types.js';

/** Totais e detalhe de um time na temporada, sem as chaves (time e temporada). */
export interface TeamSeasonStatsValues {
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  cleanSheets: number | null;
  failedToScore: number | null;
  form: string | null;
  stats: TeamSeasonStatsDetail;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

function homeAway(v: ApiHomeAway<unknown> | null | undefined, parse: (x: unknown) => number | null = int) {
  const out: HomeAwayTotal = { home: parse(v?.home), away: parse(v?.away), total: parse(v?.total) };
  return out;
}

const RANGE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

/** Faixas com contagem (as nulas ficam de fora), em ordem de minuto; a de minuto não informado vai no fim. */
export function minuteRanges(buckets: ApiMinuteBuckets | null | undefined): MinuteRangeCount[] {
  const out: MinuteRangeCount[] = [];
  for (const [key, value] of Object.entries(buckets ?? {})) {
    const count = int(value?.total);
    if (count == null) continue;
    const m = RANGE.exec(key);
    out.push(m ? { from: Number(m[1]), to: Number(m[2]), count } : { from: null, to: null, count });
  }
  return out.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
}

function goalLines(lines: Record<string, { over?: unknown; under?: unknown } | null> | null | undefined) {
  const out: GoalLineCount[] = [];
  for (const [key, value] of Object.entries(lines ?? {})) {
    const line = num(key);
    if (line == null || !value) continue;
    const over = int(value.over);
    const under = int(value.under);
    if (over == null && under == null) continue;
    out.push({ line, over, under });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** "4-0" (mandante-visitante) visto pelo time: em casa os gols dele vêm primeiro; fora, depois. */
export function scoreLine(score: string | null | undefined, side: 'home' | 'away'): TeamScoreLine | null {
  const m = typeof score === 'string' ? RANGE.exec(score) : null;
  if (!m) return null;
  const [homeGoals, awayGoals] = [Number(m[1]), Number(m[2])];
  return side === 'home' ? { for: homeGoals, against: awayGoals } : { for: awayGoals, against: homeGoals };
}

/** Forma do fornecedor (cronológica) do mais recente ao mais antigo, só com W, D e L. */
export function recentFirstForm(form: string | null | undefined): string | null {
  const clean = (form ?? '').toUpperCase().replace(/[^WDL]/g, '');
  return clean ? [...clean].reverse().join('') : null;
}

export function teamSeasonStatsValues(item: ApiTeamStatistics): TeamSeasonStatsValues {
  const fx = item.fixtures;
  const goalsFor = item.goals?.for;
  const goalsAgainst = item.goals?.against;
  const biggest = item.biggest;
  const stats: TeamSeasonStatsDetail = {
    record: {
      played: homeAway(fx?.played),
      won: homeAway(fx?.wins),
      drawn: homeAway(fx?.draws),
      lost: homeAway(fx?.loses),
    },
    goals: {
      scored: homeAway(goalsFor?.total),
      conceded: homeAway(goalsAgainst?.total),
      scored_average: homeAway(goalsFor?.average, num),
      conceded_average: homeAway(goalsAgainst?.average, num),
      scored_by_minute: minuteRanges(goalsFor?.minute),
      conceded_by_minute: minuteRanges(goalsAgainst?.minute),
      scored_lines: goalLines(goalsFor?.under_over),
      conceded_lines: goalLines(goalsAgainst?.under_over),
    },
    clean_sheets: homeAway(item.clean_sheet),
    failed_to_score: homeAway(item.failed_to_score),
    streaks: {
      wins: int(biggest?.streak?.wins),
      draws: int(biggest?.streak?.draws),
      losses: int(biggest?.streak?.loses),
    },
    biggest: {
      win: {
        home: scoreLine(biggest?.wins?.home, 'home'),
        away: scoreLine(biggest?.wins?.away, 'away'),
      },
      loss: {
        home: scoreLine(biggest?.loses?.home, 'home'),
        away: scoreLine(biggest?.loses?.away, 'away'),
      },
      scored: { home: int(biggest?.goals?.for?.home), away: int(biggest?.goals?.for?.away) },
      conceded: { home: int(biggest?.goals?.against?.home), away: int(biggest?.goals?.against?.away) },
    },
    penalties: {
      scored: int(item.penalty?.scored?.total),
      missed: int(item.penalty?.missed?.total),
      total: int(item.penalty?.total),
    },
    formations: (item.lineups ?? [])
      .flatMap((l) => {
        const formation = l?.formation?.trim();
        const played = int(l?.played);
        return formation && played != null && played > 0 ? [{ formation, played }] : [];
      })
      .sort((a, b) => b.played - a.played || a.formation.localeCompare(b.formation)),
    cards: {
      yellow_by_minute: minuteRanges(item.cards?.yellow),
      red_by_minute: minuteRanges(item.cards?.red),
    },
  };
  return {
    played: stats.record.played.total,
    won: stats.record.won.total,
    drawn: stats.record.drawn.total,
    lost: stats.record.lost.total,
    goalsFor: stats.goals.scored.total,
    goalsAgainst: stats.goals.conceded.total,
    cleanSheets: stats.clean_sheets.total,
    failedToScore: stats.failed_to_score.total,
    form: recentFirstForm(item.form),
    stats,
  };
}
