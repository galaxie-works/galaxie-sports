import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
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
  /** Placar com os nomes como no core (mandante daquela final primeiro; na de ida e volta, o da volta). */
  home: string;
  away: string;
  home_goals: number;
  away_goals: number;
  /** Lado DESTE jogo que ganhou aquela final (null = sem `winner` no core). */
  winner: 'home' | 'away' | null;
  /** 2 = final em ida e volta: o placar é o agregado dos dois jogos. */
  legs?: 2;
}

/**
 * Última final encerrada entre os dois times na competição, de uma temporada anterior (a ida desta final não é
 * "a última final"). Final em ida e volta: o agregado dos jogos daquela temporada e quem ficou com o título.
 */
export async function loadLastFinalBetween(db: Database, core: EventCore): Promise<LastFinal | null> {
  if (!core.competition) return null;
  const a = alias(eventParticipant, 'side_a');
  const b = alias(eventParticipant, 'side_b');
  const ids = [core.home.id, core.away.id];
  const rows = await db
    .select({
      id: event.id,
      seasonId: event.seasonId,
      stageId: event.stageId,
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
        core.season ? ne(event.seasonId, core.season.id) : undefined,
      ),
    )
    .orderBy(desc(event.startsAt))
    .limit(4);
  const r = rows[0];
  if (!r || r.aId === r.bId) return null;
  // os jogos da mesma final (mesma temporada e fase): ida e volta, do mais recente para o mais antigo
  const legs = rows.filter((x) => x.seasonId === r.seasonId && x.stageId === r.stageId && x.aId !== x.bId);
  const goals = new Map<string, number>();
  for (const leg of legs) {
    const h = leg.score?.home;
    const w = leg.score?.away;
    if (typeof h !== 'number' || typeof w !== 'number') return null;
    goals.set(leg.aId, (goals.get(leg.aId) ?? 0) + h);
    goals.set(leg.bId, (goals.get(leg.bId) ?? 0) + w);
  }
  const h = goals.get(r.aId)!;
  const w = goals.get(r.bId)!;
  const nameOf = (id: string) => (id === core.home.id ? core.home.name : core.away.name);
  // no agregado empatado (ou em jogo único), vale o `winner` do último jogo (pênaltis, gol fora)
  const homeWon = (r.aResult as { winner?: unknown } | null)?.winner;
  const winnerId =
    legs.length > 1 && h !== w
      ? h > w
        ? r.aId
        : r.bId
      : homeWon === true
        ? r.aId
        : homeWon === false
          ? r.bId
          : null;
  return {
    season: r.year,
    home: nameOf(r.aId),
    away: nameOf(r.bId),
    home_goals: h,
    away_goals: w,
    winner: winnerId === null ? null : winnerId === core.home.id ? 'home' : 'away',
    ...(legs.length > 1 ? { legs: 2 as const } : {}),
  };
}
