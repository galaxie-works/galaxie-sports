import type { CompetitionRules, StandingsRules, TieBreaker, TieBreakerId, Zone } from '../config/types.js';
import { accumulate, StandingsInputError, totalPoints, validateMatch } from './accumulate.js';
import type {
  BaselineRow,
  MatchResult,
  PointsAdjustment,
  StandingRow,
  StandingsTable,
  TeamId,
  TeamRecord,
} from './types.js';

const H2H: ReadonlySet<TieBreakerId> = new Set([
  'h2h_points',
  'h2h_goal_difference',
  'h2h_goals_for',
  'h2h_away_goals',
]);

export function isHeadToHead(criterion: TieBreakerId): boolean {
  return H2H.has(criterion);
}

interface RankContext {
  records: Map<TeamId, TeamRecord>;
  /** Todas as partidas conhecidas do grupo (inclui as já contidas na tabela de partida). */
  matches: readonly MatchResult[];
  rules: StandingsRules;
  meetingsPerPair: number;
  points: Map<TeamId, number>;
}

interface Ordered {
  teamId: TeamId;
  decidedBy: string | null;
  unresolvedTieWith: TeamId[];
}

function between(ctx: RankContext, tied: ReadonlySet<TeamId>): MatchResult[] {
  return ctx.matches.filter((m) => tied.has(m.homeId) && tied.has(m.awayId));
}

function h2hComplete(ctx: RankContext, tied: readonly TeamId[]): boolean {
  const set = new Set(tied);
  const count = new Map<string, number>();
  for (const m of between(ctx, set)) {
    const key = [m.homeId, m.awayId].sort().join('|');
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < tied.length; i++) {
    for (let j = i + 1; j < tied.length; j++) {
      const key = [tied[i]!, tied[j]!].sort().join('|');
      if ((count.get(key) ?? 0) < ctx.meetingsPerPair) return false;
    }
  }
  return true;
}

function applicable(
  tb: TieBreaker,
  tied: readonly TeamId[],
  scope: readonly TeamId[],
  ctx: RankContext,
): boolean {
  if (tb.maxTeams !== undefined && tied.length > tb.maxTeams) return false;
  if (isHeadToHead(tb.criterion) && tb.requireComplete && !h2hComplete(ctx, scope)) return false;
  return true;
}

/**
 * Valor do critério para cada time empatado (maior é melhor; "menos é melhor" retorna negativo).
 * Critérios de confronto direto usam a mini-tabela dos jogos entre os times de `scope`.
 */
function criterionValues(
  tb: TieBreaker,
  tied: readonly TeamId[],
  scope: readonly TeamId[],
  ctx: RankContext,
): Map<TeamId, number> {
  const out = new Map<TeamId, number>();
  const rec = (id: TeamId) => ctx.records.get(id)!;
  if (isHeadToHead(tb.criterion)) {
    const set = new Set(scope);
    const mini = new Map<TeamId, { pts: number; gf: number; ga: number; away: number }>();
    for (const id of scope) mini.set(id, { pts: 0, gf: 0, ga: 0, away: 0 });
    const { win, draw, loss } = ctx.rules.points;
    for (const m of between(ctx, set)) {
      const h = mini.get(m.homeId)!;
      const a = mini.get(m.awayId)!;
      h.gf += m.homeGoals;
      h.ga += m.awayGoals;
      a.gf += m.awayGoals;
      a.ga += m.homeGoals;
      if (!m.neutral) a.away += m.awayGoals;
      if (m.homeGoals > m.awayGoals) {
        h.pts += win;
        a.pts += loss;
      } else if (m.homeGoals < m.awayGoals) {
        h.pts += loss;
        a.pts += win;
      } else {
        h.pts += draw;
        a.pts += draw;
      }
    }
    for (const id of tied) {
      const s = mini.get(id)!;
      const v =
        tb.criterion === 'h2h_points'
          ? s.pts
          : tb.criterion === 'h2h_goal_difference'
            ? s.gf - s.ga
            : tb.criterion === 'h2h_goals_for'
              ? s.gf
              : s.away;
      out.set(id, v);
    }
    return out;
  }
  if (tb.criterion.startsWith('opponents_')) {
    for (const id of tied) {
      let total = 0;
      for (const m of ctx.matches) {
        const opp = m.homeId === id ? m.awayId : m.awayId === id ? m.homeId : null;
        if (opp === null) continue;
        const o = ctx.records.get(opp);
        if (!o) continue;
        total +=
          tb.criterion === 'opponents_points'
            ? (ctx.points.get(opp) ?? 0)
            : tb.criterion === 'opponents_goal_difference'
              ? o.goalsFor - o.goalsAgainst
              : o.goalsFor;
      }
      out.set(id, total);
    }
    return out;
  }
  for (const id of tied) {
    const r = rec(id);
    let v: number;
    switch (tb.criterion) {
      case 'wins':
        v = r.won;
        break;
      case 'goal_difference':
        v = r.goalsFor - r.goalsAgainst;
        break;
      case 'goals_for':
        v = r.goalsFor;
        break;
      case 'fewest_goals_against':
        v = -r.goalsAgainst;
        break;
      case 'away_goals_for':
        v = r.awayGoalsFor;
        break;
      case 'away_wins':
        v = r.awayWon;
        break;
      case 'fewest_red_cards':
        v = -r.redCards;
        break;
      case 'fewest_yellow_cards':
        v = -r.yellowCards;
        break;
      case 'fair_play':
        v = -(r.yellowCards * ctx.rules.fairPlay.yellow + r.redCards * ctx.rules.fairPlay.red);
        break;
      default:
        v = 0;
    }
    out.set(id, v);
  }
  return out;
}

/** Último recurso: ordem determinística por ID, marcando o empate como não resolvido. */
function lots(teams: readonly TeamId[]): Ordered[] {
  const sorted = [...teams].sort();
  return sorted.map((teamId, i) => ({
    teamId,
    decidedBy: i === 0 ? null : 'drawing_of_lots',
    unresolvedTieWith: sorted.filter((t) => t !== teamId),
  }));
}

function partition(teams: readonly TeamId[], values: Map<TeamId, number>): TeamId[][] {
  const byValue = new Map<number, TeamId[]>();
  for (const t of teams) {
    const v = values.get(t)!;
    const list = byValue.get(v) ?? [];
    list.push(t);
    byValue.set(v, list);
  }
  return [...byValue.entries()].sort((a, b) => b[0] - a[0]).map(([, list]) => list);
}

/**
 * Ordena times empatados a partir do critério `start`. `scope` é o conjunto da mini-tabela de
 * confronto direto vigente (sem reaplicação, continua sendo o empate original).
 */
function orderTied(
  teams: readonly TeamId[],
  start: number,
  ctx: RankContext,
  scope: readonly TeamId[],
): Ordered[] {
  if (teams.length === 1) return [{ teamId: teams[0]!, decidedBy: null, unresolvedTieWith: [] }];
  const criteria = ctx.rules.tieBreakers;
  for (let i = start; i < criteria.length; i++) {
    const tb = criteria[i]!;
    if (tb.criterion === 'drawing_of_lots') return lots(teams);
    if (!applicable(tb, teams, scope, ctx)) continue;
    const groups = partition(teams, criterionValues(tb, teams, scope, ctx));
    if (groups.length === 1) continue;
    // Subconjunto ainda empatado: com confronto direto já usado e reaplicação ligada (UEFA),
    // recomeça do primeiro critério com a mini-tabela restrita ao subconjunto; os critérios
    // gerais seguem empatados. Sem reaplicação, segue para o próximo critério na mesma mini-tabela.
    const usedH2H = criteria.slice(0, i + 1).some((c) => isHeadToHead(c.criterion));
    const reapply = ctx.rules.h2hReapply && usedH2H;
    const out: Ordered[] = [];
    groups.forEach((g, k) => {
      const sub = reapply ? orderTied(g, 0, ctx, g) : orderTied(g, i + 1, ctx, usedH2H ? scope : g);
      if (k > 0) sub[0]!.decidedBy = tb.criterion;
      out.push(...sub);
    });
    return out;
  }
  return lots(teams);
}

function zoneFor(rank: number, zones: readonly Zone[]): string | null {
  return zones.find((z) => rank >= z.from && rank <= z.to)?.id ?? null;
}

/** Ordena um grupo já acumulado. `matches` = todas as partidas conhecidas do grupo. */
export function rankRecords(
  records: Map<TeamId, TeamRecord>,
  matches: readonly MatchResult[],
  rules: StandingsRules,
  options: { meetingsPerPair?: number; zones?: readonly Zone[] } = {},
): StandingRow[] {
  const points = new Map<TeamId, number>();
  for (const [id, r] of records) points.set(id, totalPoints(r, rules.points));
  const ctx: RankContext = {
    records,
    matches,
    rules,
    meetingsPerPair: options.meetingsPerPair ?? 2,
    points,
  };
  const byPoints = partition([...records.keys()], points);
  const ordered: Ordered[] = [];
  byPoints.forEach((g, k) => {
    const sub = orderTied(g, 0, ctx, g);
    if (k > 0) sub[0]!.decidedBy = 'points';
    ordered.push(...sub);
  });
  return ordered.map((o, i) => {
    const r = records.get(o.teamId)!;
    return {
      ...r,
      form: [...r.form],
      rank: i + 1,
      points: points.get(o.teamId)!,
      goalDifference: r.goalsFor - r.goalsAgainst,
      zone: zoneFor(i + 1, options.zones ?? []),
      unresolvedTieWith: o.unresolvedTieWith,
      decidedBy: o.decidedBy,
    };
  });
}

export interface ComputeStandingsInput {
  rules: Pick<CompetitionRules, 'standings' | 'league'>;
  /** Resultados a aplicar (todos, ou só os posteriores à tabela de partida). */
  matches: readonly MatchResult[];
  /** Tabela de partida (ex.: a tabela completa do bootstrap do provedor). */
  baseline?: readonly BaselineRow[];
  /**
   * Partidas já contidas na tabela de partida. Não são somadas de novo; servem apenas para
   * critérios que dependem de jogos (confronto direto, adversários enfrentados).
   */
  priorMatches?: readonly MatchResult[];
  /** Garante que times sem jogos apareçam (com o grupo, se houver). */
  teams?: readonly { teamId: TeamId; group?: string }[];
  adjustments?: readonly PointsAdjustment[];
}

/**
 * Calcula as tabelas (uma por grupo) a partir dos resultados, aplicando pontuação,
 * ajustes de pontos e os critérios de desempate do regulamento.
 */
export function computeStandings(input: ComputeStandingsInput): StandingsTable[] {
  const { standings, league } = input.rules;
  const accInput: Parameters<typeof accumulate>[0] = { points: standings.points, matches: input.matches };
  if (input.baseline) accInput.baseline = input.baseline;
  if (input.teams) accInput.teams = input.teams;
  if (input.adjustments) accInput.adjustments = input.adjustments;
  const records = accumulate(accInput);
  for (const m of input.priorMatches ?? []) validateMatch(m);
  const allMatches = [...(input.priorMatches ?? []), ...input.matches];

  const groups = new Map<string, Map<TeamId, TeamRecord>>();
  for (const r of records.values()) {
    const g = groups.get(r.group) ?? new Map<TeamId, TeamRecord>();
    g.set(r.teamId, r);
    groups.set(r.group, g);
  }
  const opts: { meetingsPerPair?: number; zones?: readonly Zone[] } = {};
  if (league) {
    opts.meetingsPerPair = league.meetingsPerPair;
    opts.zones = league.zones;
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([group, recs]) => ({
      group,
      rows: rankRecords(
        recs,
        allMatches.filter((m) => recs.has(m.homeId) && recs.has(m.awayId)),
        standings,
        opts,
      ),
    }));
}

/** Atalho para tabela única (sem grupos). */
export function computeTable(input: ComputeStandingsInput): StandingRow[] {
  const tables = computeStandings(input);
  if (tables.length > 1) {
    throw new StandingsInputError(
      `computeTable espera uma tabela única, mas há ${tables.length} grupos; use computeStandings.`,
    );
  }
  return tables[0]?.rows ?? [];
}
