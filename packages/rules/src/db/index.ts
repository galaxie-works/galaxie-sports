import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { event, eventIncident, eventParticipant, standing, type Database } from '@galaxie/db';
import { formString } from '../standings/accumulate.js';
import type { BaselineRow, MatchResult, StandingsTable } from '../standings/types.js';

/**
 * Integração com o banco: lê resultados/tabelas do `core` e grava tabelas calculadas em
 * `core.standing` com `source = 'computed'`. Os IDs de time são `core.participant.id`.
 */

export interface WriteStandingsOptions {
  /**
   * replace (padrão): a linha calculada substitui qualquer linha existente do time/grupo.
   * keep_provider: não sobrescreve linhas `source = 'provider'` (só atualiza calculadas).
   */
  mode?: 'replace' | 'keep_provider';
}

/** Upsert das tabelas calculadas em `core.standing`. Retorna quantas linhas foram gravadas. */
export async function writeComputedStandings(
  db: Database,
  seasonId: string,
  tables: readonly StandingsTable[],
  options: WriteStandingsOptions = {},
): Promise<number> {
  const values = tables.flatMap((t) =>
    t.rows.map((r) => ({
      seasonId,
      group: t.group,
      participantId: r.teamId,
      rank: r.rank,
      points: r.points,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      form: formString(r) || null,
      description: r.zone,
      source: 'computed',
    })),
  );
  if (values.length === 0) return 0;
  const excluded = (column: string) => sql.raw(`excluded."${column}"`);
  const config = {
    target: [standing.seasonId, standing.group, standing.participantId],
    set: {
      rank: excluded('rank'),
      points: excluded('points'),
      played: excluded('played'),
      won: excluded('won'),
      drawn: excluded('drawn'),
      lost: excluded('lost'),
      goalsFor: excluded('goals_for'),
      goalsAgainst: excluded('goals_against'),
      form: excluded('form'),
      description: excluded('description'),
      source: excluded('source'),
      updatedAt: sql`now()`,
    },
    ...(options.mode === 'keep_provider' ? { setWhere: sql`${standing.source} <> 'provider'` } : {}),
  };
  const written = await db.insert(standing).values(values).onConflictDoUpdate(config).returning({
    participantId: standing.participantId,
  });
  return written.length;
}

/** Tabela de partida a partir das linhas `source = 'provider'` (ex.: bootstrap Pro). */
export async function loadProviderBaseline(db: Database, seasonId: string): Promise<BaselineRow[]> {
  const rows = await db
    .select()
    .from(standing)
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'provider')));
  return rows.map((r) => {
    const row: BaselineRow = {
      teamId: r.participantId,
      group: r.group,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      points: r.points,
    };
    if (r.form) row.form = r.form;
    return row;
  });
}

export interface LoadResultsOptions {
  /** Restringe às fases informadas (ex.: só a fase de liga/grupos). */
  stageIds?: readonly string[];
  /** Conta cartões amarelos/vermelhos de `core.event_incident` (desempate da CBF e fair play). */
  includeCards?: boolean;
  /** Grupo de cada participante (fase de grupos); padrão: tabela única. */
  groupOf?: (participantId: string) => string | undefined;
}

/** Resultados encerrados da temporada (`status = 'finished'`), prontos para computeStandings. */
export async function loadSeasonResults(
  db: Database,
  seasonId: string,
  options: LoadResultsOptions = {},
): Promise<MatchResult[]> {
  const home = alias(eventParticipant, 'home_side');
  const away = alias(eventParticipant, 'away_side');
  const filters = [eq(event.seasonId, seasonId), eq(event.status, 'finished')];
  if (options.stageIds?.length) filters.push(inArray(event.stageId, [...options.stageIds]));
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      score: event.score,
      homeId: home.participantId,
      awayId: away.participantId,
    })
    .from(event)
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .where(and(...filters))
    .orderBy(event.startsAt, event.id);

  const cards = new Map<string, { yellow: number; red: number }>();
  if (options.includeCards && rows.length > 0) {
    const incidents = await db
      .select({
        eventId: eventIncident.eventId,
        participantId: eventIncident.participantId,
        detail: eventIncident.detail,
      })
      .from(eventIncident)
      .where(
        and(
          eq(eventIncident.type, 'card'),
          inArray(
            eventIncident.eventId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const inc of incidents) {
      if (!inc.participantId) continue;
      const key = `${inc.eventId}|${inc.participantId}`;
      const c = cards.get(key) ?? { yellow: 0, red: 0 };
      // "Second Yellow card" (segundo amarelo) resulta em expulsão: conta como vermelho.
      if (/red|second yellow/i.test(inc.detail ?? '')) c.red++;
      else if (/yellow/i.test(inc.detail ?? '')) c.yellow++;
      cards.set(key, c);
    }
  }

  const out: MatchResult[] = [];
  for (const r of rows) {
    if (r.score?.home === null || r.score?.home === undefined || r.score.away === null) continue;
    const m: MatchResult = {
      id: r.id,
      homeId: r.homeId,
      awayId: r.awayId,
      homeGoals: r.score.home,
      awayGoals: r.score.away,
      playedAt: r.startsAt.toISOString(),
    };
    const group = options.groupOf?.(r.homeId);
    if (group !== undefined) m.group = group;
    if (options.includeCards) {
      m.cards = {
        home: cards.get(`${r.id}|${r.homeId}`) ?? { yellow: 0, red: 0 },
        away: cards.get(`${r.id}|${r.awayId}`) ?? { yellow: 0, red: 0 },
      };
    }
    out.push(m);
  }
  return out;
}

export {
  computeEventStakes,
  loadLeagueResults,
  KNOCKOUT_STAGE_KINDS,
  LEAGUE_STAGE_KINDS,
  StakesCache,
  type EventStakes,
  type KnockoutContext,
  type LeagueContext,
  type LeagueResultContext,
  type StakesEventRef,
  type StakesOptions,
} from './stakes.js';
