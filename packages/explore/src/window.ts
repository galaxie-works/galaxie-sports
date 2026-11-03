import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { EXPLORE_WINDOW_DAYS } from '@galaxie/contracts';
import { competition, event, eventParticipant, participant, type Database } from '@galaxie/db';
import type { WindowEvent } from './choices.js';
import { actuallyLiveCond, IN_PLAY } from './live.js';

export const DAY_MS = 24 * 3600_000;

/** Janela de "próximos jogos" do resumo e da agenda: de agora até `EXPLORE_WINDOW_DAYS` dias depois (fim exclusivo). */
export function exploreWindow(now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + EXPLORE_WINDOW_DAYS * DAY_MS) };
}

/**
 * Jogos (uma linha por jogo) com o país da competição e dos participantes, no recorte do plano (`sports`). A
 * mesma consulta serve ao resumo (contadores) e à agenda (`/v1/explore/agenda`), para os dois contarem igual. O
 * nome da competição sai como está no catálogo (`name` e `labels`); quem mostra escolhe o idioma.
 */
export async function selectWindowEvents(
  db: Database,
  now: Date,
  where: SQL | undefined,
  sports: readonly string[] | null,
): Promise<WindowEvent[]> {
  const rows = await db
    .select({
      id: event.id,
      sport: event.sport,
      status: event.status,
      startsAt: event.startsAt,
      importance: event.importance,
      live: sql<boolean>`${actuallyLiveCond(now)}`,
      compId: competition.id,
      compSport: competition.sport,
      compSlug: competition.slug,
      compCountry: competition.countryCode,
      compName: competition.name,
      compLabels: competition.labels,
      participantIds: sql<(string | null)[]>`array_agg(${participant.id})`,
      countries: sql<(string | null)[]>`array_agg(${participant.countryCode})`,
    })
    .from(event)
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
    .leftJoin(participant, eq(participant.id, eventParticipant.participantId))
    .where(and(where, sports ? inArray(event.sport, [...sports]) : undefined))
    .groupBy(event.id, competition.id);
  return rows.map((r) => ({
    id: r.id,
    sport: r.sport,
    status: r.status,
    startsAt: r.startsAt,
    importance: r.importance,
    live: IN_PLAY.includes(r.status) && r.live,
    competition: r.compSlug
      ? {
          sport: r.compSport!,
          slug: r.compSlug,
          countryCode: r.compCountry,
          id: r.compId!,
          name: r.compName!,
          labels: (r.compLabels ?? null) as Record<string, string> | null,
        }
      : null,
    participantIds: (r.participantIds ?? []).filter((id): id is string => !!id),
    participantCountries: (r.countries ?? []).filter((c): c is string => !!c),
  }));
}
