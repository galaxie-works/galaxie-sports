import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { event, eventParticipant, season, stage, type Database } from '@galaxie/db';
import type { EventCore } from './event-core.js';

/**
 * Fatos históricos do Cenário que não vêm do motor de regras: a última final entre os dois times na mesma
 * competição (core). Os títulos anteriores vêm de `computeEventStakes(..., { titles: true })`.
 */

export interface LastFinal {
  /** Ano da temporada no core. */
  season: number;
  /** Placar com os nomes como no core (mandante daquela final primeiro). */
  home: string;
  away: string;
  home_goals: number;
  away_goals: number;
  /** Lado DESTE jogo que ganhou aquela final (null = sem `winner` no core). */
  winner: 'home' | 'away' | null;
}

/** Última final encerrada entre os dois times na competição, antes desta partida (jogo único ou volta). */
export async function loadLastFinalBetween(db: Database, core: EventCore): Promise<LastFinal | null> {
  if (!core.competition) return null;
  const a = alias(eventParticipant, 'side_a');
  const b = alias(eventParticipant, 'side_b');
  const ids = [core.home.id, core.away.id];
  const rows = await db
    .select({
      id: event.id,
      year: season.year,
      score: event.score,
      aId: a.participantId,
      aSide: a.side,
      aResult: a.result,
      bId: b.participantId,
    })
    .from(event)
    .innerJoin(stage, and(eq(stage.id, event.stageId), eq(stage.kind, 'final')))
    .innerJoin(season, eq(season.id, event.seasonId))
    .innerJoin(a, and(eq(a.eventId, event.id), eq(a.side, 'home'), inArray(a.participantId, ids)))
    .innerJoin(b, and(eq(b.eventId, event.id), eq(b.side, 'away'), inArray(b.participantId, ids)))
    .where(
      and(
        eq(event.competitionId, core.competition.id),
        eq(event.status, 'finished'),
        lt(event.startsAt, core.startsAt),
      ),
    )
    .orderBy(desc(event.startsAt))
    .limit(1);
  const r = rows[0];
  if (!r || r.aId === r.bId) return null;
  const h = r.score?.home;
  const w = r.score?.away;
  if (typeof h !== 'number' || typeof w !== 'number') return null;
  const nameOf = (id: string) => (id === core.home.id ? core.home.name : core.away.name);
  const homeWon = (r.aResult as { winner?: unknown } | null)?.winner;
  const winnerId = homeWon === true ? r.aId : homeWon === false ? r.bId : null;
  return {
    season: r.year,
    home: nameOf(r.aId),
    away: nameOf(r.bId),
    home_goals: h,
    away_goals: w,
    winner: winnerId === null ? null : winnerId === core.home.id ? 'home' : 'away',
  };
}
