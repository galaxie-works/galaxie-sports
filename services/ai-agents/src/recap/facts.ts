import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { eventIncident, footballFixture, person, type Database } from '@galaxie/db';
import type { AgentLocale } from '../guardrails/index.js';
import { competitionName, stageName, teamName, type EventCore } from '../context/event-core.js';
import { roundNumber } from '../context/scenario.js';

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
  goals: RecapGoal[];
  missed_penalties: RecapPlayerEvent[];
  red_cards: RecapPlayerEvent[];
  statistics: { home: Record<string, number>; away: Record<string, number> } | null;
}

/** Estatísticas aproveitadas do espelho (tipo do fornecedor → chave). */
const STAT_KEYS: Record<string, string> = {
  'Shots on Goal': 'shots_on_goal',
  'Total Shots': 'total_shots',
  'Ball Possession': 'possession_pct',
  'Corner Kicks': 'corners',
  'Goalkeeper Saves': 'saves',
  Fouls: 'fouls',
  Offsides: 'offsides',
};

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
    for (const s of e.statistics ?? []) {
      const key = s.type ? STAT_KEYS[s.type] : undefined;
      if (!key) continue;
      const n =
        typeof s.value === 'number'
          ? s.value
          : typeof s.value === 'string'
            ? Number.parseFloat(s.value)
            : NaN;
      if (Number.isFinite(n)) out[side][key] = n;
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

export function buildRecapFacts(
  core: EventCore,
  incidents: readonly IncidentRow[],
  statistics: RecapFacts['statistics'],
  locales: readonly AgentLocale[],
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
  const per = <T>(fn: (l: AgentLocale) => T | null) =>
    Object.fromEntries(
      locales.flatMap((l) => {
        const v = fn(l);
        return v === null ? [] : [[l, v]];
      }),
    ) as Partial<Record<AgentLocale, T>>;
  return {
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
    aggregate: s.aggregate ?? null,
    goals: buildGoals(incidents, core, final),
    missed_penalties: playerEvents(incidents, core, (i) => i.type === 'penalty_missed'),
    red_cards: playerEvents(
      incidents,
      core,
      (i) => i.type === 'card' && /red|second yellow/i.test(i.detail ?? ''),
    ),
    statistics,
  };
}
