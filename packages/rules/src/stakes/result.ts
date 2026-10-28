import type { CompetitionRules, LeagueRules, PointsRule, Zone } from '../config/types.js';
import { accumulate } from '../standings/accumulate.js';
import { computeTable } from '../standings/compute.js';
import type { BaselineRow, MatchResult, StandingRow, TeamId } from '../standings/types.js';
import { makeStake, type Stake, type StakeSide } from './codes.js';
import {
  analyzeLeague,
  isBadZone,
  leagueMatchStakes,
  LeagueInputError,
  type Fixture,
  type LeagueTeamInput,
  type TeamOutlook,
} from './league.js';

/**
 * Jogo encerrado em pontos corridos: a tabela de antes e a de depois do jogo, e os códigos de resultado
 * (`RESULT_FAMILIES`) que comparam as duas. Funções puras.
 *
 * - **Antes** = tabela atual menos este jogo e os jogos encerrados que começaram no mesmo instante ou
 *   depois dele (simultâneos e rodadas seguintes). Ajustes de pontos (punições) já aplicados na tabela
 *   atual são preservados.
 * - **Depois** = antes + este jogo, e só ele: os simultâneos ficam de fora, para o código dizer o que
 *   ESTE resultado mudou ("saiu da zona"), e não o efeito da rodada inteira.
 */

/** Linha da tabela atual (ex.: `core.standing`), em qualquer ordem. */
export interface TableSnapshotRow {
  teamId: TeamId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /**
   * Gols e vitórias como visitante (critérios `away_goals_for` e `away_wins`). A `core.standing` não os
   * guarda: `prepareFinishedLeagueMatch` os soma dos resultados; sem eles, `tablesAroundMatch` recusa o
   * regulamento que usa esses critérios.
   */
  awayGoalsFor?: number;
  awayWon?: number;
  /**
   * Cartões (critérios de disciplina). Sem eles, ficam zerados para todos: o critério não separa ninguém e o
   * empate segue para o próximo (no fim, sorteio sinalizado em `unresolvedTieWith`).
   */
  yellowCards?: number;
  redCards?: number;
}

const AWAY_CRITERIA: ReadonlySet<string> = new Set(['away_goals_for', 'away_wins']);

export interface TablesAroundInput {
  rules: Pick<CompetitionRules, 'standings' | 'league'>;
  /** Tabela atual de um grupo, já com este jogo e os posteriores. */
  current: readonly TableSnapshotRow[];
  /** O jogo encerrado (placar do tempo normal). */
  match: MatchResult;
  /**
   * Jogos encerrados que começaram no mesmo instante ou depois deste (sem ele). Jogos com time fora da
   * tabela (outro grupo) são ignorados.
   */
  later: readonly MatchResult[];
  /** Jogos encerrados antes deste (só para critérios de confronto direto). */
  earlier?: readonly MatchResult[];
  /**
   * A tabela soma também os jogos contra times de fora dela (zonas da Argentina, com a rodada
   * interzonal): um jogo posterior com um só lado na tabela é desfeito só desse lado.
   */
  crossGroup?: boolean;
}

export interface TablesAround {
  /** Classificação antes do jogo (rank = posição). */
  before: StandingRow[];
  /** Classificação depois do jogo (antes + este jogo). */
  after: StandingRow[];
}

/** Tabela antes e depois de um jogo encerrado, a partir da tabela atual. */
export function tablesAroundMatch(input: TablesAroundInput): TablesAround {
  const pr = input.rules.standings.points;
  const hasAway = input.current.every((r) => r.awayGoalsFor !== undefined && r.awayWon !== undefined);
  const hasCards = input.current.every((r) => r.yellowCards !== undefined && r.redCards !== undefined);
  // zerados, os gols/vitórias fora reordenariam os empates (Champions, Libertadores): melhor não ter tabela
  if (!hasAway && input.rules.standings.tieBreakers.some((tb) => AWAY_CRITERIA.has(tb.criterion)))
    throw new LeagueInputError(
      'A tabela atual não traz gols e vitórias como visitante, usados no desempate do regulamento.',
    );
  type Row = BaselineRow &
    Required<Pick<BaselineRow, 'awayGoalsFor' | 'awayWon' | 'yellowCards' | 'redCards'>> & { points: number };
  const rows = new Map<TeamId, Row>();
  for (const r of input.current) {
    if (rows.has(r.teamId)) throw new LeagueInputError(`Time ${r.teamId} repetido na tabela atual.`);
    rows.set(r.teamId, {
      teamId: r.teamId,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      points: r.points,
      awayGoalsFor: hasAway ? r.awayGoalsFor! : 0,
      awayWon: hasAway ? r.awayWon! : 0,
      yellowCards: hasCards ? r.yellowCards! : 0,
      redCards: hasCards ? r.redCards! : 0,
    });
  }
  if (!rows.has(input.match.homeId) || !rows.has(input.match.awayId))
    throw new LeagueInputError('Os times do jogo não estão na tabela atual.');
  // desfaz o jogo como `applyMatch` o somou (gols/vitórias fora e cartões só quando a tabela os traz)
  const undo = (m: MatchResult) => {
    const sides: { id: TeamId; gf: number; ga: number; away: boolean; yellow: number; red: number }[] = [
      {
        id: m.homeId,
        gf: m.homeGoals,
        ga: m.awayGoals,
        away: false,
        yellow: m.cards?.home?.yellow ?? 0,
        red: m.cards?.home?.red ?? 0,
      },
      {
        id: m.awayId,
        gf: m.awayGoals,
        ga: m.homeGoals,
        away: !m.neutral,
        yellow: m.cards?.away?.yellow ?? 0,
        red: m.cards?.away?.red ?? 0,
      },
    ];
    for (const { id, gf, ga, away, yellow, red } of sides) {
      const r = rows.get(id);
      if (!r) continue; // lado de fora da tabela (jogo entre grupos, só com `crossGroup`)
      r.played -= 1;
      r.goalsFor -= gf;
      r.goalsAgainst -= ga;
      if (gf > ga) {
        r.won -= 1;
        r.points -= pr.win;
      } else if (gf === ga) {
        r.drawn -= 1;
        r.points -= pr.draw;
      } else {
        r.lost -= 1;
        r.points -= pr.loss;
      }
      if (hasAway && away) {
        r.awayGoalsFor -= gf;
        if (gf > ga) r.awayWon -= 1;
      }
      if (hasCards) {
        r.yellowCards -= yellow;
        r.redCards -= red;
      }
      const counts = [r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst];
      if ([...counts, r.awayGoalsFor, r.awayWon, r.yellowCards, r.redCards].some((v) => v < 0))
        throw new LeagueInputError(
          `A tabela atual não contém o jogo ${m.id ?? `${m.homeId} x ${m.awayId}`} (time ${id}).`,
        );
    }
  };
  undo(input.match);
  const touches = (m: MatchResult) =>
    input.crossGroup ? rows.has(m.homeId) || rows.has(m.awayId) : rows.has(m.homeId) && rows.has(m.awayId);
  for (const m of input.later) if (touches(m)) undo(m);
  const baseline = [...rows.values()];
  const earlier = (input.earlier ?? []).filter((m) => rows.has(m.homeId) && rows.has(m.awayId));
  const base = { rules: input.rules, baseline, priorMatches: earlier };
  return {
    before: computeTable({ ...base, matches: [] }),
    after: computeTable({ ...base, matches: [input.match] }),
  };
}

/** Tabela no formato do motor de pontos corridos (na ordem de classificação). */
export function leagueInputOf(rows: readonly StandingRow[]): LeagueTeamInput[] {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => ({ teamId: r.teamId, points: r.points, played: r.played }));
}

// ─── códigos de resultado ────────────────────────────────────────────────────────────────────────

export interface LeagueResultInput {
  /** Tabela antes do jogo, na ordem de classificação. */
  before: readonly LeagueTeamInput[];
  /** Tabela depois do jogo, na ordem de classificação. */
  after: readonly LeagueTeamInput[];
  league: LeagueRules;
  points?: PointsRule;
  homeId: TeamId;
  awayId: TeamId;
}

const goodZones = (league: LeagueRules): Zone[] =>
  league.zones.filter((z) => !isBadZone(z)).sort((a, b) => a.to - b.to || a.from - b.from);

const goodZoneAt = (zones: readonly Zone[], rank: number) =>
  zones.find((z) => rank >= z.from && rank <= z.to);

/** Melhor zona boa garantida (mesma regra de `qualifies_for_zone`). */
const guaranteedZone = (zones: readonly Zone[], o: TeamOutlook) => zones.find((z) => o.worstRank <= z.to);

function sideResult(
  side: Exclude<StakeSide, 'both'>,
  id: TeamId,
  input: LeagueResultInput,
  outlooks: { before: Map<TeamId, TeamOutlook>; after: Map<TeamId, TeamOutlook> },
): Stake[] {
  const { league } = input;
  const out: Stake[] = [];
  const rb = input.before.findIndex((t) => t.teamId === id) + 1;
  const ra = input.after.findIndex((t) => t.teamId === id) + 1;
  if (rb < 1 || ra < 1) throw new LeagueInputError(`Time ${id} fora da tabela de antes ou de depois.`);
  const pointsAt = (rank: number) => input.after[rank - 1]?.points;
  const points = input.after[ra - 1]!.points;
  const zones = goodZones(league);

  // 1. posição
  if (ra < rb) out.push(makeStake(side, 'moved_up_to_n', { n: ra }));
  else if (ra > rb) out.push(makeStake(side, 'moved_down_to_n', { n: ra }));
  else out.push(makeStake(side, 'stayed_at_n', { n: ra }));

  // 2. entrou ou saiu de zona (pela posição na tabela de depois)
  if (league.title) {
    if (rb !== 1 && ra === 1) out.push(makeStake(side, 'took_the_lead'));
    if (rb === 1 && ra !== 1) out.push(makeStake(side, 'lost_the_lead'));
  }
  const zb = goodZoneAt(zones, rb);
  const za = goodZoneAt(zones, ra);
  if (zb?.id !== za?.id) {
    // subindo, só a zona nova ("passou a ocupar vaga para a pré-Libertadores"); descendo, só a perdida
    if (za && (!zb || za.to < zb.to)) out.push(makeStake(side, 'entered_zone', { zone: za.id }));
    if (zb && (!za || za.to > zb.to)) out.push(makeStake(side, 'left_zone', { zone: zb.id }));
  }
  for (const zone of league.zones) {
    if (zone.kind !== 'relegation' && zone.kind !== 'elimination') continue;
    const inB = rb >= zone.from && rb <= zone.to;
    const inA = ra >= zone.from && ra <= zone.to;
    const rel = zone.kind === 'relegation';
    if (!inB && inA) out.push(makeStake(side, rel ? 'dropped_into_relegation' : 'dropped_into_elimination'));
    if (inB && !inA)
      out.push(makeStake(side, rel ? 'climbed_out_of_relegation' : 'climbed_out_of_elimination'));
  }

  // 3. garantiu ou perdeu matematicamente
  const ob = outlooks.before.get(id)!;
  const oa = outlooks.after.get(id)!;
  if (league.title) {
    if (!ob.champion && oa.champion) out.push(makeStake(side, 'clinched_title'));
    if (ob.titlePossible && !oa.titlePossible) out.push(makeStake(side, 'lost_title_chance'));
  }
  const gb = guaranteedZone(zones, ob);
  const ga = guaranteedZone(zones, oa);
  if (ga && (!gb || ga.to < gb.to)) out.push(makeStake(side, 'clinched_zone', { zone: ga.id }));
  // perdeu o alcance: a pior zona que deixou de ser alcançável (implica as melhores)
  const lost = zones.filter((z) => ob.bestRank <= z.to && oa.bestRank > z.to).at(-1);
  if (lost) out.push(makeStake(side, 'lost_zone_chance', { zone: lost.id }));
  for (const zone of league.zones) {
    if (zone.kind !== 'relegation' && zone.kind !== 'elimination') continue;
    const sb = ob.zones.find((z) => z.zone === zone.id)!.status;
    const sa = oa.zones.find((z) => z.zone === zone.id)!.status;
    if (sb !== 'clinched' && sa === 'clinched')
      out.push(
        makeStake(side, zone.kind === 'relegation' ? 'relegation_confirmed' : 'elimination_confirmed'),
      );
    if (zone.kind === 'relegation' && sb === 'possible' && sa === 'impossible')
      out.push(makeStake(side, 'clinched_safety'));
  }

  // 4. distância depois do jogo: o alvo logo acima e, fora da zona de rebaixamento, a ameaça abaixo
  const relegation = league.zones.filter((z) => z.kind === 'relegation').sort((a, b) => a.from - b.from)[0];
  const inRelegation = !!relegation && ra >= relegation.from;
  // próxima zona boa acima: a imediatamente melhor que a atual; fora de zona, a pior acima da posição
  const current = goodZoneAt(zones, ra);
  const target = current
    ? zones.filter((z) => z.to < current.from).at(-1)
    : zones.filter((z) => z.to < ra).at(-1);
  if (inRelegation) {
    const safe = pointsAt(relegation.from - 1);
    if (safe !== undefined)
      out.push(makeStake(side, 'points_below_safety_n', { n: Math.max(0, safe - points) }));
  } else if (target) {
    const line = pointsAt(target.to);
    if (line !== undefined)
      out.push(makeStake(side, 'points_behind_zone_n', { zone: target.id, n: Math.max(0, line - points) }));
  } else if (league.title) {
    if (ra === 1) {
      const second = pointsAt(2);
      if (second !== undefined) out.push(makeStake(side, 'points_ahead_at_top_n', { n: points - second }));
    } else out.push(makeStake(side, 'points_behind_leader_n', { n: pointsAt(1)! - points }));
  }
  if (relegation && !inRelegation) {
    const first = pointsAt(relegation.from);
    if (first !== undefined)
      out.push(makeStake(side, 'points_above_relegation_n', { n: Math.max(0, points - first) }));
  }
  return out;
}

/**
 * Códigos de resultado de um jogo encerrado de pontos corridos, para os dois lados: posição, zona
 * (entrou/saiu), garantias e perdas matemáticas e distância para as zonas depois do jogo.
 * Determinístico; nenhum texto livre. A lista é completa: a camada de saliência escolhe o que mostrar.
 */
export function leagueResultStakes(input: LeagueResultInput): Stake[] {
  if (input.homeId === input.awayId) throw new LeagueInputError('Mandante e visitante devem ser diferentes.');
  const analyze = (table: readonly LeagueTeamInput[]) =>
    new Map(
      analyzeLeague({
        table,
        league: input.league,
        ...(input.points ? { points: input.points } : {}),
      }).map((o) => [o.teamId, o]),
    );
  const outlooks = { before: analyze(input.before), after: analyze(input.after) };
  return [
    ...sideResult('home', input.homeId, input, outlooks),
    ...sideResult('away', input.awayId, input, outlooks),
  ];
}

// ─── jogo encerrado: retrato de antes + resultado ────────────────────────────────────────────────

export interface FinishedLeagueMatchInput extends TablesAroundInput {
  rules: Pick<CompetitionRules, 'standings' | 'league'>;
  /**
   * Jogos da mesma rodada ainda em aberto no início deste jogo (sem ele), para os códigos "nesta rodada"
   * do retrato de antes. Sem eles, vale a regra de rodada desconhecida de `leagueMatchStakes`.
   */
  nextRound?: readonly Fixture[];
}

export interface FinishedLeagueMatch extends TablesAround {
  /** O que estava em jogo, com a tabela de antes (mesmos códigos do pré-jogo). */
  pre: Stake[];
  /** O que o resultado mudou (`RESULT_FAMILIES`). */
  result: Stake[];
}

/** Stakes de um jogo encerrado de pontos corridos: o retrato de antes do jogo e os códigos de resultado. */
export function finishedLeagueMatchStakes(input: FinishedLeagueMatchInput): FinishedLeagueMatch {
  const league = input.rules.league;
  if (!league) throw new LeagueInputError('Regulamento sem pontos corridos (league).');
  const tables = tablesAroundMatch(input);
  const before = leagueInputOf(tables.before);
  const after = leagueInputOf(tables.after);
  const points = input.rules.standings.points;
  const homeId = input.match.homeId;
  const awayId = input.match.awayId;
  const pre = { table: before, league, points, homeId, awayId };
  let preStakes: Stake[];
  try {
    preStakes = leagueMatchStakes(input.nextRound ? { ...pre, nextRound: input.nextRound } : pre);
  } catch (err) {
    // calendário da rodada inconsistente com a tabela de antes: tenta sem a rodada (limites seguros)
    if (!input.nextRound) throw err;
    preStakes = leagueMatchStakes(pre);
  }
  return {
    ...tables,
    pre: preStakes,
    result: leagueResultStakes({ before, after, league, points, homeId, awayId }),
  };
}

// ─── escolha da tabela ───────────────────────────────────────────────────────────────────────────

/**
 * Entre as tabelas (grupos) de uma temporada, a que contém os dois times. Com mais de uma candidata
 * (ex.: a mesma liga gravada sob dois rótulos de grupo, uma delas desatualizada), fica a com mais jogos
 * somados e, empatando, a atualizada por último. Sem candidata, undefined.
 */
export function pickGroupTable<R extends { participantId: string; played: number; updatedAt?: Date | null }>(
  groups: Iterable<readonly R[]>,
  homeId: string,
  awayId: string,
): readonly R[] | undefined {
  let best: readonly R[] | undefined;
  let bestPlayed = -1;
  let bestUpdated = -Infinity;
  for (const g of groups) {
    if (!g.some((r) => r.participantId === homeId) || !g.some((r) => r.participantId === awayId)) continue;
    const played = g.reduce((sum, r) => sum + r.played, 0);
    const updated = Math.max(...g.map((r) => r.updatedAt?.getTime() ?? -Infinity));
    if (played > bestPlayed || (played === bestPlayed && updated > bestUpdated)) {
      best = g;
      bestPlayed = played;
      bestUpdated = updated;
    }
  }
  return best;
}

// ─── preparação a partir do banco ────────────────────────────────────────────────────────────────

export interface PrepareFinishedInput {
  rules: Pick<CompetitionRules, 'standings' | 'league'>;
  /** Tabela atual do grupo. */
  current: readonly TableSnapshotRow[];
  /**
   * Jogos encerrados da temporada nas fases de pontos corridos, com `playedAt` (início) e `id`. Os de
   * times fora da tabela são ignorados.
   */
  results: readonly MatchResult[];
  /** Id do jogo encerrado. */
  matchId: string;
  /** Jogos da rodada ainda em aberto no início do jogo (ver `FinishedLeagueMatchInput.nextRound`). */
  nextRound?: readonly Fixture[];
  /**
   * A tabela soma os jogos contra times de fora dela (`cross_group_matches`): entram os resultados com
   * ao menos um lado na tabela, e só os lados dela contam na conferência.
   */
  crossGroup?: boolean;
}

/**
 * Monta a entrada de `finishedLeagueMatchStakes` a partir da tabela atual e dos resultados da
 * temporada: separa os jogos anteriores (confronto direto) dos simultâneos e posteriores (desfeitos na
 * tabela de antes). Recusa (LeagueInputError) quando a tabela atual não bate com os resultados — por
 * time, jogos, V/E/D ou gols somados na tabela ≠ os dos jogos encerrados entre os times dela (tabela
 * desatualizada, placar corrigido de um lado só) —, porque desfazer jogos de uma tabela que não os
 * contém daria uma tabela de antes errada. Os pontos não entram na conta: a diferença para V/E/D é
 * ajuste (punição), preservado. Sem gols/vitórias fora na tabela, eles saem dos resultados.
 */
export function prepareFinishedLeagueMatch(input: PrepareFinishedInput): FinishedLeagueMatchInput {
  const ids = new Set(input.current.map((r) => r.teamId));
  const cross = input.crossGroup === true;
  const sidesIn = (m: MatchResult) => Number(ids.has(m.homeId)) + Number(ids.has(m.awayId));
  const results = input.results.filter((m) => sidesIn(m) === 2 || (cross && sidesIn(m) === 1));
  const match = results.find((m) => m.id === input.matchId);
  if (!match || sidesIn(match) !== 2)
    throw new LeagueInputError('O jogo não está entre os resultados encerrados da tabela.');
  const played = input.current.reduce((sum, r) => sum + r.played, 0);
  const expected = results.reduce((sum, m) => sum + sidesIn(m), 0);
  if (played !== expected)
    throw new LeagueInputError(
      `A tabela atual (${played} participações) não bate com os resultados encerrados (${expected}).`,
    );
  const fromResults = accumulate({
    points: input.rules.standings.points,
    matches: results,
    teams: input.current.map((r) => ({ teamId: r.teamId })),
  });
  const fields = ['played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst'] as const;
  for (const r of input.current) {
    const t = fromResults.get(r.teamId)!;
    const diff = fields.find((f) => r[f] !== t[f]);
    if (diff)
      throw new LeagueInputError(
        `A tabela atual não bate com os resultados encerrados (time ${r.teamId}, ${diff}: ${r[diff]} × ${t[diff]}).`,
      );
  }
  const hasAway = input.current.every((r) => r.awayGoalsFor !== undefined && r.awayWon !== undefined);
  const current = hasAway
    ? input.current
    : input.current.map((r) => {
        const t = fromResults.get(r.teamId)!;
        return { ...r, awayGoalsFor: t.awayGoalsFor, awayWon: t.awayWon };
      });
  const at = (m: MatchResult) => (m.playedAt ? Date.parse(m.playedAt) : NaN);
  const kickoff = at(match);
  if (!Number.isFinite(kickoff)) throw new LeagueInputError('Jogo sem data de início.');
  const others = results.filter((m) => m.id !== match.id);
  const out: FinishedLeagueMatchInput = {
    rules: input.rules,
    current,
    match,
    later: others.filter((m) => !(at(m) < kickoff)),
    earlier: others.filter((m) => at(m) < kickoff),
  };
  if (cross) out.crossGroup = true;
  if (input.nextRound) out.nextRound = input.nextRound;
  return out;
}
