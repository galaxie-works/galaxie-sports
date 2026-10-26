import { and, eq, inArray } from 'drizzle-orm';
import {
  competition,
  competitionProfile,
  derby,
  event,
  eventParticipant,
  participant,
  season,
  stage,
  teamProfile,
  venue,
  venueDisplay,
  type Database,
  type EventScore,
  type I18nText,
} from '@galaxie/db';
import { languageOf, type AgentLocale } from '../guardrails/index.js';

/** Piso editorial do perfil da competição (`semantic.competition_profile`) no texto dos agentes. */
export const COMPETITION_PROFILE_MIN_REVIEW = 'approved' as const;

/**
 * Fatos básicos de um evento lidos do `core` (e rótulos da base semântica), comuns ao Cenário e
 * ao Resumo. Nada aqui vem de IA.
 */

export interface TeamRef {
  id: string;
  side: 'home' | 'away';
  name: string;
  shortName: string | null;
  /** Nomes oficiais/curtos e rótulos por locale da base semântica (quando o time está ligado). */
  aliases: string[];
  labels: Partial<Record<string, string>>;
}

export interface EventCore {
  id: string;
  sport: string;
  status: string;
  statusDetail: string | null;
  startsAt: Date;
  score: EventScore | null;
  competition: {
    id: string;
    slug: string;
    name: string;
    tier: number;
    labels: Partial<Record<string, string>>;
  } | null;
  season: { id: string; year: number; label: string } | null;
  stage: { id: string; kind: string; name: I18nText; providerLabel: string | null } | null;
  venue: { name: string; city: string | null } | null;
  derby: { name: string; labels: Partial<Record<string, string>> } | null;
  home: TeamRef;
  away: TeamRef;
}

function labelFor(labels: Partial<Record<string, string>>, locale: string): string | undefined {
  return (
    labels[locale] ?? labels[languageOf(locale)] ?? (languageOf(locale) === 'es' ? labels['es'] : undefined)
  );
}

/** Nome do time para o locale: rótulo da base semântica → nome curto → nome do provedor. */
export function teamName(team: TeamRef, locale: AgentLocale): string {
  return labelFor(team.labels, locale) ?? team.name;
}

export function competitionName(core: EventCore, locale: AgentLocale): string | null {
  if (!core.competition) return null;
  return labelFor(core.competition.labels, locale) ?? core.competition.name;
}

export function stageName(core: EventCore, locale: AgentLocale): string | null {
  if (!core.stage) return null;
  const name = core.stage.name as Partial<Record<string, string>>;
  return name[locale] ?? (languageOf(locale) === 'pt' ? name['pt-BR'] : name['es']) ?? name['en'] ?? null;
}

/** Todos os nomes próprios citáveis do evento (para o validador). */
export function eventNames(core: EventCore): string[] {
  const out: string[] = [];
  for (const t of [core.home, core.away])
    out.push(t.name, ...(t.shortName ? [t.shortName] : []), ...t.aliases);
  for (const t of [core.home, core.away])
    out.push(...Object.values(t.labels).filter((v): v is string => !!v));
  if (core.competition)
    out.push(
      core.competition.name,
      ...Object.values(core.competition.labels).filter((v): v is string => !!v),
    );
  if (core.stage) out.push(...Object.values(core.stage.name).filter((v): v is string => !!v));
  if (core.venue) out.push(core.venue.name, ...(core.venue.city ? [core.venue.city] : []));
  if (core.derby)
    out.push(core.derby.name, ...Object.values(core.derby.labels).filter((v): v is string => !!v));
  return [...new Set(out.filter(Boolean))];
}

/** Carrega o evento com competição, temporada, fase, estádio, clássico e os dois participantes. */
export async function loadEventCore(db: Database, eventId: string): Promise<EventCore | null> {
  const [row] = await db
    .select({
      id: event.id,
      sport: event.sport,
      status: event.status,
      statusDetail: event.statusDetail,
      startsAt: event.startsAt,
      score: event.score,
      competitionId: competition.id,
      competitionSlug: competition.slug,
      competitionName: competition.name,
      competitionTier: competition.tier,
      competitionLabels: competition.labels,
      profileLabels: competitionProfile.labels,
      seasonId: season.id,
      seasonYear: season.year,
      seasonLabel: season.label,
      stageId: stage.id,
      stageKind: stage.kind,
      stageName: stage.name,
      stageLabel: stage.providerLabel,
      venueName: venue.name,
      venueCity: venue.city,
      venueCurated: venue.curated,
      derbyName: derby.name,
      derbyLabels: derby.labels,
    })
    .from(event)
    .leftJoin(competition, eq(competition.id, event.competitionId))
    // perfil da competição só no piso editorial (approved, o padrão da API): rascunho não chega ao texto
    .leftJoin(
      competitionProfile,
      and(
        eq(competitionProfile.competitionId, event.competitionId),
        eq(competitionProfile.reviewStatus, COMPETITION_PROFILE_MIN_REVIEW),
      ),
    )
    .leftJoin(season, eq(season.id, event.seasonId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(venue, eq(venue.id, event.venueId))
    .leftJoin(derby, eq(derby.id, event.derbyId))
    .where(eq(event.id, eventId))
    .limit(1);
  if (!row) return null;

  const parts = await db
    .select({
      side: eventParticipant.side,
      id: participant.id,
      name: participant.name,
      shortName: participant.shortName,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .where(and(eq(eventParticipant.eventId, eventId), inArray(eventParticipant.side, ['home', 'away'])));
  const homeRow = parts.find((p) => p.side === 'home');
  const awayRow = parts.find((p) => p.side === 'away');
  if (!homeRow || !awayRow) return null;

  const profiles = await db
    .select({
      participantId: teamProfile.participantId,
      names: teamProfile.names,
      labels: teamProfile.labels,
    })
    .from(teamProfile)
    .where(inArray(teamProfile.participantId, [homeRow.id, awayRow.id]));
  const team = (p: typeof homeRow, side: 'home' | 'away'): TeamRef => {
    const profile = profiles.find((x) => x.participantId === p.id);
    const names = (profile?.names ?? {}) as { official?: string; short?: string };
    return {
      id: p.id,
      side,
      name: p.name,
      shortName: p.shortName,
      aliases: [names.official, names.short].filter((v): v is string => !!v),
      labels: (profile?.labels ?? {}) as Partial<Record<string, string>>,
    };
  };

  return {
    id: row.id,
    sport: row.sport,
    status: row.status,
    statusDetail: row.statusDetail,
    startsAt: row.startsAt,
    score: row.score,
    competition: row.competitionId
      ? {
          id: row.competitionId,
          slug: row.competitionSlug!,
          name: row.competitionName!,
          tier: row.competitionTier ?? 3,
          labels: { ...((row.profileLabels ?? {}) as object), ...((row.competitionLabels ?? {}) as object) },
        }
      : null,
    season: row.seasonId ? { id: row.seasonId, year: row.seasonYear!, label: row.seasonLabel! } : null,
    stage: row.stageId
      ? { id: row.stageId, kind: row.stageKind!, name: row.stageName ?? {}, providerLabel: row.stageLabel }
      : null,
    // nome curado da base semântica (ex.: "Nubank Parque") vence o do fornecedor
    venue: row.venueName
      ? venueDisplay({ name: row.venueName, city: row.venueCity, curated: row.venueCurated })
      : null,
    derby: row.derbyName
      ? { name: row.derbyName, labels: (row.derbyLabels ?? {}) as Partial<Record<string, string>> }
      : null,
    home: team(homeRow, 'home'),
    away: team(awayRow, 'away'),
  };
}
