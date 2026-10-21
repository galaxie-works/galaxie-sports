import { asc, eq } from 'drizzle-orm';
import { competition, event, eventParticipant, participant, type Database } from '@galaxie/db';

/** Fatos do evento usados pelo agente (vêm do core — nunca do LLM). */
export interface EventInfo {
  id: string;
  sport: string;
  startsAt: Date;
  status: string;
  competition: { id: string; slug: string; name: string; tier: number; countryCode: string | null } | null;
  home: string | null;
  away: string | null;
  participants: string[];
}

export async function loadEventInfo(db: Database, eventId: string): Promise<EventInfo | null> {
  const [row] = await db
    .select({ e: event, c: competition })
    .from(event)
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .where(eq(event.id, eventId));
  if (!row) return null;
  const parts = await db
    .select({ side: eventParticipant.side, name: participant.name })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .where(eq(eventParticipant.eventId, eventId))
    .orderBy(asc(eventParticipant.position), asc(participant.name));
  return {
    id: row.e.id,
    sport: row.e.sport,
    startsAt: row.e.startsAt,
    status: row.e.status,
    competition: row.c
      ? {
          id: row.c.id,
          slug: row.c.slug,
          name: (row.c.labels as Record<string, string> | null)?.['pt-BR'] ?? row.c.name,
          tier: row.c.tier,
          countryCode: row.c.countryCode,
        }
      : null,
    home: parts.find((p) => p.side === 'home')?.name ?? null,
    away: parts.find((p) => p.side === 'away')?.name ?? null,
    participants: parts.map((p) => p.name),
  };
}

/** Rótulo "Mandante x Visitante" (ou participantes, em outros esportes). */
export function matchLabel(info: EventInfo, sep = 'x'): string {
  if (info.home && info.away) return `${info.home} ${sep} ${info.away}`;
  return info.participants.slice(0, 4).join(` ${sep} `) || info.competition?.name || 'evento';
}
