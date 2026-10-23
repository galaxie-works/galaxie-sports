/**
 * Futebol australiano (AFL): o placar por quarto vem de `games/quarters` (um complemento por jogo, guardado em
 * `core.sport_event_detail.detail.quarters`) e os gols/behinds do placar final, de `core.event.score.breakdown`.
 */
import type { ScorePeriod, SideGoalsBehinds } from '@galaxie/contracts';
import { sportEventDetail, type Database, type EventScore } from '@galaxie/db';
import { aflQuarters } from '@galaxie/providers';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Quartos da AFL por evento (só os que já têm `games/quarters`). */
export async function loadAflQuarters(db: Database, ids: string[]): Promise<Map<string, ScorePeriod[]>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      eventId: sportEventDetail.eventId,
      quarters: sql<unknown>`${sportEventDetail.detail}->'quarters'`,
    })
    .from(sportEventDetail)
    .where(
      and(
        inArray(sportEventDetail.eventId, ids),
        eq(sportEventDetail.sport, 'afl'),
        sql`${sportEventDetail.detail} ? 'quarters'`,
      ),
    );
  const out = new Map<string, ScorePeriod[]>();
  for (const r of rows) {
    const periods = aflQuarters(r.quarters).map((q): ScorePeriod => ({
      code: q.code,
      home: q.home.points,
      away: q.away.points,
      goals_behinds: {
        home: { goals: q.home.goals, behinds: q.home.behinds },
        away: { goals: q.away.goals, behinds: q.away.behinds },
      },
    }));
    if (periods.length) out.set(r.eventId, periods);
  }
  return out;
}

/** Gols e behinds do placar final (`score.breakdown` gravado pela normalização da AFL). */
export function aflGoalsBehinds(score: EventScore | null | undefined): SideGoalsBehinds | null {
  const b = score?.breakdown;
  if (!b) return null;
  const side = (s: Record<string, number | null>) => ({ goals: s.goals ?? null, behinds: s.behinds ?? null });
  const out = { home: side(b.home), away: side(b.away) };
  return out.home.goals == null && out.away.goals == null ? null : out;
}
