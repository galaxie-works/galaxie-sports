import type { LeagueRules, PointsRule, Zone, ZoneKind } from '../config/types.js';
import type { TeamId } from '../standings/types.js';
import { makeStake, type Stake, type StakeSide } from './codes.js';

/**
 * Matemática de pontos corridos (liga, grupo ou fase de liga).
 *
 * Os limites são **seguros**: um time só é dado como campeão/rebaixado/classificado quando
 * nenhuma combinação de resultados restantes muda isso, contando empate em pontos como
 * ameaça (critérios de desempate futuros são desconhecidos). Por isso `bestRank`/`worstRank`
 * delimitam um superconjunto das posições alcançáveis, e "possível" é condição necessária.
 */

export interface LeagueTeamInput {
  teamId: TeamId;
  points: number;
  played: number;
}

export interface Fixture {
  homeId: TeamId;
  awayId: TeamId;
}

export interface LeagueOutlookInput {
  /** Tabela atual, na ordem de classificação (rank = índice + 1). */
  table: readonly LeagueTeamInput[];
  league: LeagueRules;
  points?: PointsRule;
  /** Calendário restante; sem ele, usa `league.matchesPerTeam − played`. */
  remainingFixtures?: readonly Fixture[];
}

export type ZoneStatus = 'clinched' | 'possible' | 'impossible';

export interface TeamOutlook {
  teamId: TeamId;
  rank: number;
  points: number;
  played: number;
  remaining: number;
  maxPoints: number;
  /** Melhor e pior posição ainda matematicamente possíveis (limites seguros). */
  bestRank: number;
  worstRank: number;
  /** null quando a tabela não define campeão. */
  champion: boolean | null;
  titlePossible: boolean | null;
  /**
   * Zonas boas (vaga, acesso): clinched = garante ao menos esta zona; possible = ainda alcança.
   * Zonas ruins (rebaixamento, eliminação): clinched = confirmado nela ou abaixo; impossible = a salvo.
   */
  zones: { zone: string; kind: ZoneKind; status: ZoneStatus }[];
}

export class LeagueInputError extends Error {
  override readonly name = 'LeagueInputError';
}

const DEFAULT_POINTS: PointsRule = { win: 3, draw: 1, loss: 0 };
const BAD_KINDS: ReadonlySet<ZoneKind> = new Set(['relegation', 'relegation_playoff', 'elimination']);

export function isBadZone(zone: Zone): boolean {
  return BAD_KINDS.has(zone.kind);
}

interface TeamState {
  teamId: TeamId;
  rank: number;
  points: number;
  played: number;
  remaining: number;
  maxPoints: number;
}

function buildStates(input: LeagueOutlookInput): Map<TeamId, TeamState> {
  const pr = input.points ?? DEFAULT_POINTS;
  const remainingByTeam = new Map<TeamId, number>();
  if (input.remainingFixtures) {
    for (const f of input.remainingFixtures) {
      for (const id of [f.homeId, f.awayId]) remainingByTeam.set(id, (remainingByTeam.get(id) ?? 0) + 1);
    }
  }
  const states = new Map<TeamId, TeamState>();
  input.table.forEach((t, i) => {
    if (states.has(t.teamId)) throw new LeagueInputError(`Time ${t.teamId} repetido na tabela.`);
    let remaining: number;
    if (input.remainingFixtures) remaining = remainingByTeam.get(t.teamId) ?? 0;
    else if (input.league.matchesPerTeam !== null) remaining = input.league.matchesPerTeam - t.played;
    else {
      throw new LeagueInputError(
        'Sem calendário restante, o regulamento precisa de league.matches_per_team.',
      );
    }
    if (remaining < 0) {
      throw new LeagueInputError(`Time ${t.teamId} tem mais jogos (${t.played}) do que o regulamento prevê.`);
    }
    states.set(t.teamId, {
      teamId: t.teamId,
      rank: i + 1,
      points: t.points,
      played: t.played,
      remaining,
      maxPoints: t.points + remaining * pr.win,
    });
  });
  for (const id of remainingByTeam.keys()) {
    if (!states.has(id)) throw new LeagueInputError(`Jogo restante com time fora da tabela: ${id}.`);
  }
  return states;
}

/** `o` termina, com certeza, à frente de `x`? (empate final entre times encerrados usa a tabela atual). */
function certainlyAbove(o: TeamState, x: TeamState): boolean {
  if (o.points > x.maxPoints) return true;
  return o.remaining === 0 && x.remaining === 0 && o.points === x.points && o.rank < x.rank;
}

/** `o` pode terminar à frente de (ou empatado com) `x`? */
function possiblyAbove(o: TeamState, x: TeamState): boolean {
  if (o.remaining === 0 && x.remaining === 0 && o.points === x.points) return o.rank < x.rank;
  return o.maxPoints >= x.points;
}

function zoneStatus(zone: Zone, best: number, worst: number): ZoneStatus {
  if (isBadZone(zone)) return best >= zone.from ? 'clinched' : worst >= zone.from ? 'possible' : 'impossible';
  return worst <= zone.to ? 'clinched' : best <= zone.to ? 'possible' : 'impossible';
}

function outlookOf(x: TeamState, states: Map<TeamId, TeamState>, league: LeagueRules): TeamOutlook {
  let above = 0;
  let threats = 0;
  for (const o of states.values()) {
    if (o.teamId === x.teamId) continue;
    if (certainlyAbove(o, x)) above++;
    if (possiblyAbove(o, x)) threats++;
  }
  const bestRank = 1 + above;
  const worstRank = 1 + threats;
  return {
    teamId: x.teamId,
    rank: x.rank,
    points: x.points,
    played: x.played,
    remaining: x.remaining,
    maxPoints: x.maxPoints,
    bestRank,
    worstRank,
    champion: league.title ? worstRank === 1 : null,
    titlePossible: league.title ? bestRank === 1 : null,
    zones: league.zones.map((z) => ({
      zone: z.id,
      kind: z.kind,
      status: zoneStatus(z, bestRank, worstRank),
    })),
  };
}

/** Situação matemática de cada time: pontos máximos, posições alcançáveis, título e zonas. */
export function analyzeLeague(input: LeagueOutlookInput): TeamOutlook[] {
  const states = buildStates(input);
  return [...states.values()].map((x) => outlookOf(x, states, input.league));
}

// ─── projeção de uma rodada ──────────────────────────────────────────────────────────────────────

type Result = 'W' | 'D' | 'L';
const RESULTS: readonly Result[] = ['W', 'D', 'L'];
const INVERSE: Record<Result, Result> = { W: 'L', D: 'D', L: 'W' };

interface Delta {
  dp: number;
  dmax: number;
}

function delta(r: Result, pr: PointsRule): Delta {
  const dp = r === 'W' ? pr.win : r === 'D' ? pr.draw : pr.loss;
  return { dp, dmax: dp - pr.win };
}

/** Unidade independente da rodada: um jogo (dois times) ou um time de rodada desconhecida. */
type Unit = { kind: 'pair'; homeId: TeamId; awayId: TeamId } | { kind: 'single'; teamId: TeamId };

/**
 * Indicador por adversário `o` dado o estado projetado de X:
 * - threat: `o` ainda pode terminar empatado ou à frente de X;
 * - above: `o` certamente termina à frente de X.
 */
type Indicator = 'threat' | 'above';

interface RoundModel {
  states: Map<TeamId, TeamState>;
  units: Unit[];
  pr: PointsRule;
}

function indicator(kind: Indicator, o: TeamState, d: Delta, xp: number, xmax: number): number {
  if (kind === 'threat') return o.maxPoints + d.dmax >= xp ? 1 : 0;
  return o.points + d.dp > xmax ? 1 : 0;
}

/** Contagem extrema (máxima ou mínima) do indicador sobre todos os resultados da rodada, com X fixo. */
function extremeCount(
  model: RoundModel,
  x: TeamState,
  xResult: Result,
  kind: Indicator,
  mode: 'max' | 'min',
): number {
  const xd = delta(xResult, model.pr);
  const xp = x.points + xd.dp;
  const xmax = x.maxPoints + xd.dmax;
  const pick = mode === 'max' ? Math.max : Math.min;
  const zero: Delta = { dp: 0, dmax: 0 };
  const covered = new Set<TeamId>([x.teamId]);
  let total = 0;
  for (const u of model.units) {
    if (u.kind === 'pair') {
      covered.add(u.homeId);
      covered.add(u.awayId);
      if (u.homeId === x.teamId || u.awayId === x.teamId) {
        const opp = model.states.get(u.homeId === x.teamId ? u.awayId : u.homeId)!;
        total += indicator(kind, opp, delta(INVERSE[xResult], model.pr), xp, xmax);
        continue;
      }
      const h = model.states.get(u.homeId)!;
      const a = model.states.get(u.awayId)!;
      total += pick(
        ...RESULTS.map(
          (r) =>
            indicator(kind, h, delta(r, model.pr), xp, xmax) +
            indicator(kind, a, delta(INVERSE[r], model.pr), xp, xmax),
        ),
      );
    } else {
      if (u.teamId === x.teamId) continue;
      covered.add(u.teamId);
      const o = model.states.get(u.teamId)!;
      total += pick(...RESULTS.map((r) => indicator(kind, o, delta(r, model.pr), xp, xmax)));
    }
  }
  for (const o of model.states.values()) {
    if (!covered.has(o.teamId)) total += indicator(kind, o, zero, xp, xmax);
  }
  return total;
}

/** "X termina entre os K primeiros" para todo (forall) ou algum (exists) resultado dos demais jogos. */
function topK(model: RoundModel, x: TeamState, r: Result, k: number, q: 'forall' | 'exists'): boolean {
  return extremeCount(model, x, r, 'threat', q === 'forall' ? 'max' : 'min') <= k - 1;
}

/** "X termina na posição `from` ou abaixo" para todo/algum resultado dos demais jogos. */
function atOrBelow(
  model: RoundModel,
  x: TeamState,
  r: Result,
  from: number,
  q: 'forall' | 'exists',
): boolean {
  return extremeCount(model, x, r, 'above', q === 'forall' ? 'min' : 'max') >= from - 1;
}

function buildRoundModel(
  states: Map<TeamId, TeamState>,
  pr: PointsRule,
  match: Fixture,
  nextRound: readonly Fixture[] | undefined,
): RoundModel {
  const seen = new Set<TeamId>();
  const units: Unit[] = [];
  const addPair = (f: Fixture) => {
    for (const id of [f.homeId, f.awayId]) {
      const s = states.get(id);
      if (!s) throw new LeagueInputError(`Jogo da rodada com time fora da tabela: ${id}.`);
      if (s.remaining < 1) throw new LeagueInputError(`Time ${id} não tem jogos restantes.`);
      if (seen.has(id)) throw new LeagueInputError(`Time ${id} aparece duas vezes na mesma rodada.`);
      seen.add(id);
    }
    units.push({ kind: 'pair', homeId: f.homeId, awayId: f.awayId });
  };
  const sameMatch = (f: Fixture) =>
    (f.homeId === match.homeId && f.awayId === match.awayId) ||
    (f.homeId === match.awayId && f.awayId === match.homeId);
  addPair(match);
  if (nextRound) {
    for (const f of nextRound) if (!sameMatch(f)) addPair(f);
  } else {
    // Rodada desconhecida: qualquer time com jogos restantes pode vencer, empatar ou perder.
    for (const s of states.values()) {
      if (!seen.has(s.teamId) && s.remaining > 0) units.push({ kind: 'single', teamId: s.teamId });
    }
  }
  return { states, units, pr };
}

// ─── stakes de uma partida de liga ───────────────────────────────────────────────────────────────

export interface LeagueMatchInput extends LeagueOutlookInput {
  homeId: TeamId;
  awayId: TeamId;
  /** Jogos da mesma rodada (aumenta a precisão de can_clinch / can_be_relegated). */
  nextRound?: readonly Fixture[];
  /**
   * Inclui códigos de mera possibilidade (in_title_race, can_qualify_for_*, at_risk_of_*,
   * safe_from_relegation). Padrão: só na reta final (jogos restantes ≤ max(3, ¼ da fase)).
   */
  includePossibilities?: boolean;
}

function possibilityWindow(league: LeagueRules, remaining: number): boolean {
  const quarter = league.matchesPerTeam === null ? 3 : Math.ceil(league.matchesPerTeam / 4);
  return remaining <= Math.max(3, quarter);
}

function sideStakes(
  side: StakeSide,
  x: TeamState,
  outlook: TeamOutlook,
  model: RoundModel,
  input: LeagueMatchInput,
): Stake[] {
  const { league } = input;
  const teams = model.states.size;
  const out: Stake[] = [];
  const showPossible = input.includePossibilities ?? possibilityWindow(league, x.remaining);

  // Título.
  if (league.title) {
    if (outlook.champion) out.push(makeStake(side, 'mathematically_champion'));
    else if (outlook.titlePossible) {
      if (topK(model, x, 'D', 1, 'forall')) out.push(makeStake(side, 'clinches_title_with_draw'));
      else if (topK(model, x, 'W', 1, 'forall')) out.push(makeStake(side, 'clinches_title_with_win'));
      else if (RESULTS.some((r) => topK(model, x, r, 1, 'exists')))
        out.push(makeStake(side, 'can_clinch_title'));
      else if (showPossible) out.push(makeStake(side, 'in_title_race'));
    }
  }

  // Zonas boas: a melhor garantida e a melhor ainda em disputa.
  const good = league.zones.filter((z) => !isBadZone(z)).sort((a, b) => a.to - b.to);
  const guaranteed = good.find((z) => outlook.worstRank <= z.to);
  if (guaranteed) out.push(makeStake(side, 'qualifies_for_zone', { zone: guaranteed.id }));
  const better = good.filter((z) => (guaranteed ? z.to < guaranteed.to : true) && outlook.bestRank <= z.to);
  const clinchable = better.find((z) => RESULTS.some((r) => topK(model, x, r, z.to, 'exists')));
  if (clinchable) {
    if (topK(model, x, 'D', clinchable.to, 'forall'))
      out.push(makeStake(side, 'clinches_zone_with_draw', { zone: clinchable.id }));
    else if (topK(model, x, 'W', clinchable.to, 'forall'))
      out.push(makeStake(side, 'clinches_zone_with_win', { zone: clinchable.id }));
    else out.push(makeStake(side, 'can_clinch_zone', { zone: clinchable.id }));
  }
  const target = better[0];
  if (target && showPossible && target.id !== clinchable?.id) {
    out.push(makeStake(side, 'can_qualify_for_zone', { zone: target.id }));
  }

  // Zonas ruins: rebaixamento e eliminação (a de playoff de rebaixamento só descreve a tabela).
  for (const zone of league.zones) {
    if (zone.kind !== 'relegation' && zone.kind !== 'elimination') continue;
    const rel = zone.kind === 'relegation';
    const status = outlook.zones.find((z) => z.zone === zone.id)!.status;
    if (status === 'clinched') {
      out.push(makeStake(side, rel ? 'mathematically_relegated' : 'mathematically_eliminated'));
      continue;
    }
    if (status === 'impossible') {
      if (rel && showPossible && x.rank > teams / 2) out.push(makeStake(side, 'safe_from_relegation'));
      continue;
    }
    if (atOrBelow(model, x, 'D', zone.from, 'forall')) {
      out.push(makeStake(side, rel ? 'relegated_unless_wins' : 'eliminated_unless_wins'));
    } else if (atOrBelow(model, x, 'L', zone.from, 'forall')) {
      out.push(makeStake(side, rel ? 'relegated_if_loses' : 'eliminated_if_loses'));
    } else if (atOrBelow(model, x, 'L', zone.from, 'exists')) {
      out.push(makeStake(side, rel ? 'can_be_relegated' : 'can_be_eliminated'));
    } else if (showPossible) {
      out.push(makeStake(side, rel ? 'at_risk_of_relegation' : 'at_risk_of_elimination'));
    }
    if (rel) {
      const safeTop = zone.from - 1;
      if (topK(model, x, 'D', safeTop, 'forall')) out.push(makeStake(side, 'secures_safety_with_draw'));
      else if (topK(model, x, 'W', safeTop, 'forall')) out.push(makeStake(side, 'secures_safety_with_win'));
      else if (RESULTS.some((r) => topK(model, x, r, safeTop, 'exists')))
        out.push(makeStake(side, 'can_secure_safety'));
    }
  }
  return out;
}

/**
 * Stakes de uma partida de pontos corridos (liga, grupo, fase de liga) para os dois lados,
 * a partir da tabela atual e do regulamento. Determinístico; nenhum texto livre.
 */
export function leagueMatchStakes(input: LeagueMatchInput): Stake[] {
  if (input.homeId === input.awayId) throw new LeagueInputError('Mandante e visitante devem ser diferentes.');
  const states = buildStates(input);
  const pr = input.points ?? DEFAULT_POINTS;
  const model = buildRoundModel(states, pr, { homeId: input.homeId, awayId: input.awayId }, input.nextRound);
  const out: Stake[] = [];
  for (const [side, id] of [
    ['home', input.homeId],
    ['away', input.awayId],
  ] as const) {
    const x = states.get(id)!;
    out.push(...sideStakes(side, x, outlookOf(x, states, input.league), model, input));
  }
  return out;
}
