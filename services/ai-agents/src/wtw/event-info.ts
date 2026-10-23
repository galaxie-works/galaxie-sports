import { asc, eq, inArray } from 'drizzle-orm';
import { competition, event, eventParticipant, participant, season, stage, type Database } from '@galaxie/db';
import type { MatchFacts } from '@galaxie/where-to-watch';

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
  /** País de cada participante (relevância por mercado). */
  participantCountries?: (string | null)[];
  /** Rótulo da rodada no fornecedor (ex.: "Regular Season - 32"). */
  round?: string | null;
  /** Ano de início da temporada (chave dos direitos pesquisados). */
  season?: number | null;
  importance?: number;
  /**
   * `false` em jogo provisório sem horário anunciado: só a data é oficial (`startsAt` guarda o meio-dia
   * local, que não deve ir ao prompt como horário).
   */
  timeConfirmed?: boolean;
}

/** Carrega vários eventos de uma vez (rodada inteira), na ordem de início. */
export async function loadEventInfos(db: Database, eventIds: string[]): Promise<Map<string, EventInfo>> {
  const out = new Map<string, EventInfo>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({ e: event, c: competition, round: stage.providerLabel, seasonYear: season.year })
    .from(event)
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(inArray(event.id, eventIds));
  const parts = await db
    .select({
      eventId: eventParticipant.eventId,
      side: eventParticipant.side,
      name: participant.name,
      country: participant.countryCode,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .where(inArray(eventParticipant.eventId, eventIds))
    .orderBy(asc(eventParticipant.position), asc(participant.name));
  for (const row of rows) {
    const mine = parts.filter((p) => p.eventId === row.e.id);
    out.set(row.e.id, {
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
      home: mine.find((p) => p.side === 'home')?.name ?? null,
      away: mine.find((p) => p.side === 'away')?.name ?? null,
      participants: mine.map((p) => p.name),
      participantCountries: mine.map((p) => p.country),
      round: row.round,
      season: row.seasonYear ?? row.e.startsAt.getUTCFullYear(),
      importance: row.e.importance,
      timeConfirmed: !(row.e.isProvisional && row.e.provisional?.timeConfirmed === false),
    });
  }
  return out;
}

export async function loadEventInfo(db: Database, eventId: string): Promise<EventInfo | null> {
  return (await loadEventInfos(db, [eventId])).get(eventId) ?? null;
}

/** Rótulo "Mandante x Visitante" (ou participantes, em outros esportes). */
export function matchLabel(info: EventInfo, sep = 'x'): string {
  if (info.home && info.away) return `${info.home} ${sep} ${info.away}`;
  return info.participants.slice(0, 4).join(` ${sep} `) || info.competition?.name || 'evento';
}

/** Fatos do jogo para as regras de direitos. */
export function matchFacts(info: EventInfo): MatchFacts {
  return {
    home: info.home,
    away: info.away,
    participants: info.participants,
    round: info.round ?? null,
  };
}
