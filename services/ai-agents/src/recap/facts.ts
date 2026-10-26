import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { eventIncident, footballFixture, person, type Database } from '@galaxie/db';
import { teamStatisticValues, type TeamStatisticCode } from '@galaxie/providers';
import { knockoutStageRules, rulesStageKey, salientStakes, stakeText, type Stake } from '@galaxie/rules';
import type { AgentLocale } from '../guardrails/index.js';
import { competitionName, stageName, teamName, type EventCore } from '../context/event-core.js';
import { roundNumber } from '../context/scenario.js';
import {
  computeEventStakes,
  KNOCKOUT_STAGE_KINDS,
  LEAGUE_STAGE_KINDS,
  type EventStakes,
  type KnockoutContext,
} from '../context/stakes.js';

/**
 * Fatos do Resumo pós-jogo (issue #58): placar, timeline (`core.event_incident`) e estatísticas do
 * espelho da partida. Tudo vem do core; o placar parcial de cada gol é recalculado da timeline e
 * só é usado quando bate com o placar final.
 */

export type Side = 'home' | 'away';

export interface IncidentRow {
  sequence: number;
  minute: number | null;
  extra: number | null;
  type: string;
  detail: string | null;
  participantId: string | null;
  person: string | null;
  assist: string | null;
}

export interface RecapGoal {
  minute: number | null;
  extra: number | null;
  /** Time beneficiado pelo gol. */
  team: Side;
  scorer: string | null;
  assist: string | null;
  type: 'goal' | 'own_goal' | 'penalty';
  score_after?: { home: number; away: number };
}

export interface RecapPlayerEvent {
  minute: number | null;
  extra: number | null;
  team: Side;
  player: string | null;
}

/** Fase seguinte para quem passa (core.stage.kind → fase); `next_round` quando o nome não é conhecido. */
export const NEXT_STAGE: Record<string, RecapNextStage> = {
  semi_final: 'final',
  quarter_final: 'semi_final',
  round_of_16: 'quarter_final',
  round_of_32: 'round_of_16',
  round_of_64: 'round_of_32',
  round_of_128: 'round_of_64',
};
export type RecapNextStage =
  'final' | 'semi_final' | 'quarter_final' | 'round_of_16' | 'round_of_32' | 'round_of_64' | 'next_round';

/**
 * Desfecho do confronto de mata-mata (issue do resumo incompleto): agregado, quem passou e a
 * consequência (vaga na fase seguinte ou título). Calculado pelo motor de regras a partir do core —
 * nada é estimado; sem dados, `winner` fica null e o texto não afirma desfecho.
 */
export interface RecapTie {
  legs: 1 | 2;
  /** 1 = ida, 2 = volta, null = jogo único. */
  leg: 1 | 2 | null;
  /** Placar da ida pela ótica DESTE jogo (home = mandante deste jogo, que foi visitante na ida). */
  first_leg: { home: number; away: number } | null;
  /** Agregado pela ótica deste jogo (só na volta). */
  aggregate: { home: number; away: number } | null;
  /** Quem passou / foi campeão; null = confronto em aberto (ida) ou sem dados para afirmar. */
  winner: Side | null;
  /** Como a vaga foi decidida (`draw_advantage` = empate em jogo único com vantagem pelo regulamento). */
  decided_by: 'match' | 'aggregate' | 'away_goals' | 'extra_time' | 'penalties' | 'draw_advantage' | null;
  /** Consequência para o vencedor. */
  outcome: 'title' | 'advances' | 'third_place' | null;
  /** Fase alcançada quando `outcome = advances`. */
  next_stage: RecapNextStage | null;
}

/** Contexto de mata-mata do evento (motor de regras), entrada de `buildRecapTie`. */
export interface RecapKnockoutInput extends KnockoutContext {
  /** Gol fora desempata o agregado nesta fase/temporada. */
  awayGoals: boolean;
  /** Jogo único: quem avança com empate pelo regulamento (copa-do-brasil, 1ª fase: o visitante). */
  drawAdvantage?: Side | null;
  /** Títulos da competição antes deste jogo, por lado (só na final e com contagem confiável). */
  titlesBefore?: Partial<Record<Side, number>>;
}

/** Código do motor com o rótulo fixo por locale (o significado exato). */
export interface RecapStakeFact {
  team: Stake['team'];
  code: string;
  /** Parâmetros do código (posição, pontos, zona), para o validador. */
  params?: Stake['params'];
  labels: Partial<Record<AgentLocale, string>>;
}

/** Posição e pontos de um time antes e depois do jogo (pontos corridos). */
export interface RecapLeagueRow {
  rank_before: number;
  rank_after: number;
  points_before: number;
  points_after: number;
  /** Jogos restantes depois deste (null sem `matches_per_team`). */
  remaining: number | null;
}

/**
 * Pontos corridos (jogo encerrado): o que estava em jogo, com a tabela de antes, e o que o resultado
 * mudou, só os códigos salientes (até 3 por time e fase, docs/rules §3.5).
 */
export interface RecapLeague {
  teams_in_table: number;
  home: RecapLeagueRow;
  away: RecapLeagueRow;
  /** O que estava em jogo antes do jogo. */
  before: RecapStakeFact[];
  /** O que o resultado mudou (posição, zona, garantias, distância para as zonas). */
  result: RecapStakeFact[];
}

/**
 * Como o placar se construiu, a partir da timeline (só quando os placares parciais batem com o final):
 * virada, gol decisivo e se ele saiu no fim ou nos acréscimos.
 */
export interface RecapFlow {
  /** Vencedor (null = empate). */
  winner: Side | null;
  /** O vencedor esteve atrás no placar (virada) — maior desvantagem, em gols. 0 = nunca esteve atrás. */
  winner_max_deficit: number;
  /** Empate: o time que saiu atrás e buscou o empate (null sem isso). */
  came_back_to_draw: Side | null;
  /** Gol que decidiu: o que deu a vantagem final ao vencedor, ou o último gol do empate. */
  decisive_goal: {
    team: Side;
    minute: number | null;
    extra: number | null;
    scorer: string | null;
    /** Do 85' ao fim do tempo normal (acréscimos inclusive; prorrogação não conta). */
    late: boolean;
    /** Nos acréscimos do 2º tempo (90+N). Aos 90' sem acréscimo, false. */
    stoppage_time: boolean;
  } | null;
}

export interface RecapFacts {
  match: {
    competition: Partial<Record<AgentLocale, string>> | null;
    stage: Partial<Record<AgentLocale, string>> | null;
    round: number | null;
    venue: string | null;
    derby: string | null;
  };
  teams: {
    home: { names: Partial<Record<AgentLocale, string>> };
    away: { names: Partial<Record<AgentLocale, string>> };
  };
  final_score: { home: number; away: number };
  halftime: { home: number; away: number } | null;
  /** regular | extra_time | penalties */
  decided_by: 'regular' | 'extra_time' | 'penalties';
  penalties: { home: number; away: number } | null;
  aggregate: { home: number; away: number } | null;
  /** Mata-mata: agregado, quem passou e para onde (null fora do mata-mata). */
  tie: RecapTie | null;
  /**
   * Final decidida: o título conquistado é o de número `title_number` do campeão naquela competição
   * (títulos anteriores do Wikidata + 1). Ausente sem contagem confiável.
   */
  champion_titles?: { side: Side; title_number: number };
  goals: RecapGoal[];
  /** Virada e gol decisivo (ausente sem placares parciais confiáveis). */
  flow?: RecapFlow;
  /** Pontos corridos: o que estava em jogo e o que o resultado mudou (ausente fora deles). */
  league?: RecapLeague;
  missed_penalties: RecapPlayerEvent[];
  red_cards: RecapPlayerEvent[];
  statistics: { home: Record<string, number>; away: Record<string, number> } | null;
}

/** Virada, empate buscado e gol decisivo a partir dos placares parciais da timeline. */
export function buildRecapFlow(
  goals: readonly RecapGoal[],
  final: { home: number; away: number },
): RecapFlow | null {
  if (!goals.length || goals.some((g) => !g.score_after)) return null;
  const winner: Side | null = final.home === final.away ? null : final.home > final.away ? 'home' : 'away';
  const other = (x: Side): Side => (x === 'home' ? 'away' : 'home');
  let deficit = 0;
  let decisive: RecapGoal | null = null;
  if (winner) {
    for (const g of goals) {
      const sa = g.score_after!;
      deficit = Math.max(deficit, sa[other(winner)] - sa[winner]);
    }
    // o gol que pôs o vencedor na frente pela última vez (depois dele, nunca mais empatou)
    for (let i = goals.length - 1; i >= 0; i--) {
      const sa = goals[i]!.score_after!;
      const prev = i ? goals[i - 1]!.score_after! : { home: 0, away: 0 };
      if (
        goals[i]!.team === winner &&
        sa[winner] > sa[other(winner)] &&
        prev[winner] <= prev[other(winner)]
      ) {
        decisive = goals[i]!;
        break;
      }
    }
  } else decisive = goals.at(-1)!;
  // empate: quem saiu atrás e buscou (o último gol empatou o jogo)
  let cameBack: Side | null = null;
  if (!winner) {
    const last = goals.at(-1)!;
    const sa = last.score_after!;
    if (sa.home === sa.away) cameBack = last.team;
  }
  const minute = decisive?.minute ?? null;
  const extra = decisive?.extra ?? null;
  return {
    winner,
    winner_max_deficit: deficit,
    came_back_to_draw: cameBack,
    decisive_goal: decisive
      ? {
          team: decisive.team,
          minute,
          extra,
          scorer: decisive.scorer,
          // tempo normal: o fornecedor manda os acréscimos como 90 + extra; 91' em diante é prorrogação
          late: minute !== null && minute >= 85 && minute <= 90,
          stoppage_time: minute === 90 && !!extra,
        }
      : null,
  };
}

/**
 * Pontos corridos encerrado: o motor de regras calcula a tabela de antes e a de depois; só os códigos
 * salientes vão para o resumo. Null fora de pontos corridos ou sem dados confiáveis (tabela que não
 * bate com os resultados).
 */
export async function loadRecapLeague(
  db: Database,
  core: EventCore,
): Promise<Pick<EventStakes, 'stakes' | 'league' | 'result'> | null> {
  if (core.stage && !LEAGUE_STAGE_KINDS.has(core.stage.kind)) return null;
  const stakes = await computeEventStakes(db, core);
  return stakes.league && stakes.result ? stakes : null;
}

/** Fatos de pontos corridos do resumo (salientes, com rótulos fixos por locale). */
export function buildRecapLeague(
  core: Pick<EventCore, 'home' | 'away'>,
  input: Pick<EventStakes, 'stakes' | 'league' | 'result'>,
  locales: readonly AgentLocale[],
): RecapLeague | null {
  const lg = input.league;
  const res = input.result;
  if (!lg || !res) return null;
  const labels = (list: readonly Stake[]): RecapStakeFact[] =>
    list.map((s) => ({
      team: s.team,
      code: s.code,
      ...(s.params ? { params: { ...s.params } } : {}),
      labels: Object.fromEntries(locales.map((l) => [l, stakeText(s, l)])) as Partial<
        Record<AgentLocale, string>
      >,
    }));
  const row = (side: Side): RecapLeagueRow => {
    const id = side === 'home' ? core.home.id : core.away.id;
    const b = lg.rows.find((r) => r.teamId === id)!;
    const a = res.rows.find((r) => r.teamId === id)!;
    const remaining = lg.remaining[side];
    return {
      rank_before: b.rank,
      rank_after: a.rank,
      points_before: b.points,
      points_after: a.points,
      remaining: remaining === null ? null : Math.max(0, remaining - 1),
    };
  };
  return {
    teams_in_table: lg.teams,
    home: row('home'),
    away: row('away'),
    before: labels(salientStakes(input.stakes, lg.salience)),
    result: labels(salientStakes(res.stakes, res.salience)),
  };
}

/**
 * Estatísticas aproveitadas no resumo, pelos códigos estáveis da normalização compartilhada com a API
 * (`teamStatisticValues`, @galaxie/providers — os mesmos `code` de `GET /v1/events/{id}/stats`).
 */
const RECAP_STATS: readonly TeamStatisticCode[] = [
  'shots_on_goal',
  'shots_total',
  'possession_pct',
  'corners',
  'saves',
  'fouls',
  'offsides',
];

export async function loadIncidents(db: Database, eventId: string): Promise<IncidentRow[]> {
  const scorer = alias(person, 'scorer');
  const assist = alias(person, 'assist');
  return db
    .select({
      sequence: eventIncident.sequence,
      minute: eventIncident.minute,
      extra: eventIncident.extra,
      type: eventIncident.type,
      detail: eventIncident.detail,
      participantId: eventIncident.participantId,
      person: scorer.name,
      assist: assist.name,
    })
    .from(eventIncident)
    .leftJoin(scorer, eq(scorer.id, eventIncident.personId))
    .leftJoin(assist, eq(assist.id, eventIncident.assistPersonId))
    .where(eq(eventIncident.eventId, eventId))
    .orderBy(asc(eventIncident.sequence));
}

export async function loadStatistics(db: Database, core: EventCore): Promise<RecapFacts['statistics']> {
  const [row] = await db
    .select({ detail: footballFixture.detail, summary: footballFixture.summary })
    .from(footballFixture)
    .where(eq(footballFixture.eventId, core.id));
  const stats = (row?.detail as { statistics?: unknown } | null)?.statistics;
  if (!Array.isArray(stats) || stats.length !== 2) return null;
  const summaryTeams = (row?.summary as { teams?: { home?: { id?: number }; away?: { id?: number } } } | null)
    ?.teams;
  const out: { home: Record<string, number>; away: Record<string, number> } = { home: {}, away: {} };
  stats.forEach((entry: unknown, index) => {
    const e = entry as { team?: { id?: number }; statistics?: { type?: string; value?: unknown }[] };
    const side: Side =
      e.team?.id !== undefined && e.team.id === summaryTeams?.away?.id
        ? 'away'
        : e.team?.id !== undefined && e.team.id === summaryTeams?.home?.id
          ? 'home'
          : index === 0
            ? 'home'
            : 'away';
    const values = teamStatisticValues(e.statistics);
    for (const code of RECAP_STATS) {
      const n = values[code];
      if (n !== undefined) out[side][code] = n;
    }
  });
  return Object.keys(out.home).length || Object.keys(out.away).length ? out : null;
}

const GOAL_TYPES = new Set(['goal', 'own_goal']);

/**
 * Gols com o time beneficiado e o placar parcial. Em gol contra, o time do incidente pode ser o do
 * jogador ou o beneficiado (depende do provedor): testamos as duas convenções e ficamos com a que
 * reproduz o placar final; se nenhuma bater, os placares parciais são omitidos.
 */
export function buildGoals(
  incidents: readonly IncidentRow[],
  core: Pick<EventCore, 'home' | 'away'>,
  final: { home: number; away: number },
): RecapGoal[] {
  const sideOf = (participantId: string | null): Side | null =>
    participantId === core.home.id ? 'home' : participantId === core.away.id ? 'away' : null;
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  const total = final.home + final.away;
  const raw = incidents.filter((i) => GOAL_TYPES.has(i.type));

  const attempt = (ownGoalCountsForOpponent: boolean): RecapGoal[] | null => {
    const goals: RecapGoal[] = [];
    const score = { home: 0, away: 0 };
    for (const i of raw) {
      // gols além do total são da disputa de pênaltis (o provedor lista as cobranças como gols)
      if (score.home + score.away >= total) break;
      const s = sideOf(i.participantId);
      if (!s) return null;
      const own = i.type === 'own_goal';
      const team = own && ownGoalCountsForOpponent ? other(s) : s;
      score[team]++;
      goals.push({
        minute: i.minute,
        extra: i.extra,
        team,
        scorer: i.person,
        assist: own ? null : i.assist,
        type: own ? 'own_goal' : /penalty/i.test(i.detail ?? '') ? 'penalty' : 'goal',
        score_after: { ...score },
      });
    }
    return score.home === final.home && score.away === final.away ? goals : null;
  };
  const ok = attempt(true) ?? attempt(false);
  if (ok) return ok;
  // timeline incompleta/inconsistente: lista os gols sem placar parcial
  return raw.slice(0, total).flatMap((i) => {
    const s = sideOf(i.participantId);
    if (!s) return [];
    return [
      {
        minute: i.minute,
        extra: i.extra,
        team: i.type === 'own_goal' ? other(s) : s,
        scorer: i.person,
        assist: i.type === 'own_goal' ? null : i.assist,
        type:
          i.type === 'own_goal'
            ? ('own_goal' as const)
            : /penalty/i.test(i.detail ?? '')
              ? ('penalty' as const)
              : ('goal' as const),
      },
    ];
  });
}

function playerEvents(
  incidents: readonly IncidentRow[],
  core: Pick<EventCore, 'home' | 'away'>,
  match: (i: IncidentRow) => boolean,
): RecapPlayerEvent[] {
  return incidents.filter(match).flatMap((i) => {
    const team: Side | null =
      i.participantId === core.home.id ? 'home' : i.participantId === core.away.id ? 'away' : null;
    return team ? [{ minute: i.minute, extra: i.extra, team, player: i.person }] : [];
  });
}

/** Liga o evento ao motor de regras e devolve o contexto de mata-mata (null fora do mata-mata). */
export async function loadRecapKnockout(db: Database, core: EventCore): Promise<RecapKnockoutInput | null> {
  if (!core.stage || !KNOCKOUT_STAGE_KINDS.has(core.stage.kind)) return null;
  const stakes = await computeEventStakes(db, core, { titles: true });
  if (!stakes.knockout) return null;
  // fases numeradas de copa ("1st Round") pela chave do regulamento, como no motor e na API
  const rules = stakes.rules
    ? knockoutStageRules(stakes.rules, rulesStageKey(core.stage.kind, core.stage.providerLabel))
    : null;
  const titlesBefore: Partial<Record<Side, number>> = {};
  if (stakes.titles?.home) titlesBefore.home = stakes.titles.home.won;
  if (stakes.titles?.away) titlesBefore.away = stakes.titles.away.won;
  return {
    ...stakes.knockout,
    awayGoals: !!rules?.awayGoals && !rules.neutralVenue,
    ...(stakes.knockout.legs === 1 && rules?.drawAdvantage ? { drawAdvantage: rules.drawAdvantage } : {}),
    ...(Object.keys(titlesBefore).length ? { titlesBefore } : {}),
  };
}

const sideOfPair = (p: { home: number; away: number }): Side | null =>
  p.home === p.away ? null : p.home > p.away ? 'home' : 'away';

/**
 * Desfecho do confronto. Na volta, agregado = ida + este jogo (com prorrogação); empate no agregado
 * vai para gol fora (se o regulamento usa) e depois pênaltis. Sem a ida no core, usa o agregado do
 * fornecedor quando houver.
 */
export function buildRecapTie(
  core: Pick<EventCore, 'stage'>,
  final: { home: number; away: number },
  penalties: { home: number; away: number } | null,
  decidedBy: RecapFacts['decided_by'],
  ko: RecapKnockoutInput | null,
  providerAggregate: { home: number; away: number } | null = null,
): RecapTie | null {
  const kind = core.stage?.kind ?? null;
  const consequence = (winner: Side | null): Pick<RecapTie, 'outcome' | 'next_stage'> => {
    if (!winner) return { outcome: null, next_stage: null };
    if (kind === 'final' || ko?.decidesTitle) return { outcome: 'title', next_stage: null };
    if (kind === 'third_place') return { outcome: 'third_place', next_stage: null };
    return { outcome: 'advances', next_stage: (kind ? NEXT_STAGE[kind] : undefined) ?? 'next_round' };
  };
  const byPenalties = penalties ? sideOfPair(penalties) : null;

  if (ko && ko.legs === 2 && ko.leg === 1) {
    return {
      legs: 2,
      leg: 1,
      first_leg: null,
      aggregate: null,
      winner: null,
      decided_by: null,
      outcome: null,
      next_stage: null,
    };
  }
  if (ko && ko.legs === 1) {
    const byScore = sideOfPair(final);
    // empate sem pênaltis: passa quem tem a vantagem do empate no regulamento
    const byAdvantage = !byScore && !byPenalties ? (ko.drawAdvantage ?? null) : null;
    const winner = byScore ?? byPenalties ?? byAdvantage;
    return {
      legs: 1,
      leg: null,
      first_leg: null,
      aggregate: null,
      winner,
      decided_by: !winner
        ? null
        : byScore
          ? decidedBy === 'extra_time'
            ? 'extra_time'
            : 'match'
          : byPenalties
            ? 'penalties'
            : 'draw_advantage',
      ...consequence(winner),
    };
  }
  // volta (ida e volta): agregado pela ótica deste jogo
  let firstLeg: { home: number; away: number } | null = null;
  let aggregate = providerAggregate;
  if (ko?.aggregateBefore && ko.firstLeg) {
    firstLeg = { home: ko.firstLeg.awayGoals, away: ko.firstLeg.homeGoals };
    aggregate = { home: ko.aggregateBefore.home + final.home, away: ko.aggregateBefore.away + final.away };
  }
  if (!aggregate) return null;
  let winner = sideOfPair(aggregate);
  let how: RecapTie['decided_by'] = winner ? 'aggregate' : null;
  if (!winner && ko?.awayGoals && firstLeg) {
    // gols fora: o mandante deste jogo marcou fora na ida; o visitante marca fora agora
    winner = sideOfPair({ home: firstLeg.home, away: final.away });
    if (winner) how = 'away_goals';
  }
  if (!winner && byPenalties) {
    winner = byPenalties;
    how = 'penalties';
  }
  return { legs: 2, leg: 2, first_leg: firstLeg, aggregate, winner, decided_by: how, ...consequence(winner) };
}

export function buildRecapFacts(
  core: EventCore,
  incidents: readonly IncidentRow[],
  statistics: RecapFacts['statistics'],
  locales: readonly AgentLocale[],
  knockout: RecapKnockoutInput | null = null,
  league: Pick<EventStakes, 'stakes' | 'league' | 'result'> | null = null,
): RecapFacts | null {
  const s = core.score;
  if (!s || typeof s.home !== 'number' || typeof s.away !== 'number') return null;
  const final = { home: s.home, away: s.away };
  const pen =
    s.penalty && typeof s.penalty.home === 'number' && typeof s.penalty.away === 'number'
      ? { home: s.penalty.home, away: s.penalty.away }
      : null;
  const ht =
    s.halftime && typeof s.halftime.home === 'number' && typeof s.halftime.away === 'number'
      ? { home: s.halftime.home, away: s.halftime.away }
      : null;
  const decided: RecapFacts['decided_by'] =
    pen || core.statusDetail === 'PEN' ? 'penalties' : core.statusDetail === 'AET' ? 'extra_time' : 'regular';
  const tie =
    core.stage && KNOCKOUT_STAGE_KINDS.has(core.stage.kind)
      ? buildRecapTie(core, final, pen, decided, knockout, s.aggregate ?? null)
      : null;
  const per = <T>(fn: (l: AgentLocale) => T | null) =>
    Object.fromEntries(
      locales.flatMap((l) => {
        const v = fn(l);
        return v === null ? [] : [[l, v]];
      }),
    ) as Partial<Record<AgentLocale, T>>;
  const before = tie?.outcome === 'title' && tie.winner ? knockout?.titlesBefore?.[tie.winner] : undefined;
  const goals = buildGoals(incidents, core, final);
  const flow = buildRecapFlow(goals, final);
  const leagueFacts = league ? buildRecapLeague(core, league, locales) : null;
  return {
    ...(before !== undefined && tie?.winner
      ? { champion_titles: { side: tie.winner, title_number: before + 1 } }
      : {}),
    match: {
      competition: core.competition ? per((l) => competitionName(core, l)) : null,
      stage: core.stage ? per((l) => stageName(core, l)) : null,
      round: roundNumber(core),
      venue: core.venue?.name ?? null,
      derby: core.derby?.name ?? null,
    },
    teams: {
      home: { names: per((l) => teamName(core.home, l)) },
      away: { names: per((l) => teamName(core.away, l)) },
    },
    final_score: final,
    halftime: ht,
    decided_by: decided,
    penalties: pen,
    aggregate: tie?.aggregate ?? s.aggregate ?? null,
    tie,
    goals,
    ...(flow ? { flow } : {}),
    ...(leagueFacts ? { league: leagueFacts } : {}),
    missed_penalties: playerEvents(incidents, core, (i) => i.type === 'penalty_missed'),
    red_cards: playerEvents(
      incidents,
      core,
      (i) => i.type === 'card' && /red|second yellow/i.test(i.detail ?? ''),
    ),
    statistics,
  };
}
