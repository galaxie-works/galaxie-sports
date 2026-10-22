import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  competition,
  country,
  event,
  eventParticipant,
  participant,
  providerMap,
  teamProfile,
  venue,
  type Database,
} from '@galaxie/db';
import type { KnowledgeBase, LocatedTeam } from '@galaxie/knowledge';
import { normalizeText } from '../guardrails/index.js';

/**
 * Lacunas da base semântica detectadas de forma determinística (sem IA), a partir do core:
 * - `missing_team`: clube que joga competição do tier informado e não tem entrada no YAML
 *   (promovidos, novos participantes);
 * - `unresolved_id`: clube com entrada no YAML pelo nome, mas sem `api_sports.team_id`
 *   (resolver com `pnpm resolve:ids`, não com IA);
 * - `venue_mismatch`: estádio do provedor diferente do nome e dos apelidos do YAML (naming rights).
 */

export interface MissingTeamGap {
  kind: 'missing_team';
  participantId: string;
  name: string;
  countryCode: string | null;
  /** Nome do país em inglês, como o provedor usa em `api_sports.match.country`. */
  countryName: string | null;
  apiSportsTeamId: number | null;
  competitions: string[];
}

export interface UnresolvedIdGap {
  kind: 'unresolved_id';
  participantId: string;
  name: string;
  slug: string;
  file: string;
  apiSportsTeamId: number | null;
}

export interface VenueMismatchGap {
  kind: 'venue_mismatch';
  participantId: string;
  slug: string;
  file: string;
  index: number;
  reviewStatus: string;
  yamlStadium: string;
  yamlNicknames: string[];
  providerVenue: string;
  city: string | null;
}

export type KnowledgeGap = MissingTeamGap | UnresolvedIdGap | VenueMismatchGap;

export interface GapOptions {
  now?: Date;
  /** Tier máximo das competições consideradas (padrão 1). */
  maxTier?: number;
  /** Janela de jogos considerada: dias para trás e para frente (padrão 120 e 60). */
  daysBack?: number;
  daysAhead?: number;
}

/** Times do YAML indexados por api_sports.team_id. */
function byApiId(kb: KnowledgeBase): Map<number, LocatedTeam> {
  const out = new Map<number, LocatedTeam>();
  for (const t of kb.teams)
    if (typeof t.entry.api_sports?.team_id === 'number') out.set(t.entry.api_sports.team_id, t);
  return out;
}

function sameName(t: LocatedTeam, name: string, countryCode: string | null): boolean {
  const n = normalizeText(name);
  const names = [t.entry.names.short, t.entry.names.official, t.entry.api_sports?.match?.name].filter(
    (v): v is string => !!v,
  );
  const country = (t.countryCode ?? '').toUpperCase();
  return (
    names.some((x) => normalizeText(x) === n) &&
    (!countryCode || !country || country === countryCode.toUpperCase())
  );
}

const VENUE_NOISE = new Set([
  'estadio',
  'stadium',
  'stade',
  'stadio',
  'stadion',
  'de',
  'do',
  'da',
  'del',
  'the',
]);

/**
 * Mesmo estádio com grafias diferentes? Ignora acentos, pontuação, "Estádio"/"Stadium" e
 * conectores, e aceita iniciais ("Alberto J. Armando" = "Alberto José Armando").
 */
export function sameVenue(a: string, b: string): boolean {
  const tokens = (s: string) =>
    normalizeText(s)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((t) => t && !VENUE_NOISE.has(t));
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || x.length !== y.length) return x.join(' ') === y.join(' ');
  return x.every((t, i) => {
    const u = y[i]!;
    return t === u || (t.length === 1 && u.startsWith(t)) || (u.length === 1 && t.startsWith(u));
  });
}

export async function findKnowledgeGaps(
  db: Database,
  kb: KnowledgeBase,
  options: GapOptions = {},
): Promise<KnowledgeGap[]> {
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - (options.daysBack ?? 120) * 86_400_000);
  const to = new Date(now.getTime() + (options.daysAhead ?? 60) * 86_400_000);
  const rows = await db
    .selectDistinct({
      participantId: participant.id,
      name: participant.name,
      countryCode: participant.countryCode,
      countryName: country.name,
      homeVenueId: participant.homeVenueId,
      competition: competition.name,
    })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .leftJoin(country, eq(country.code, participant.countryCode))
    .where(
      and(
        eq(event.sport, 'football'),
        eq(participant.kind, 'club'),
        lte(competition.tier, options.maxTier ?? 1),
        gte(event.startsAt, from),
        lte(event.startsAt, to),
      ),
    );
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r) => r.participantId))];
  const maps = await db
    .select({ entityId: providerMap.entityId, providerId: providerMap.providerId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.provider, 'api-sports'),
        inArray(providerMap.entityId, ids),
      ),
    );
  const apiIdOf = new Map(maps.map((m) => [m.entityId, Number(m.providerId)]));
  const profiles = await db
    .select({ slug: teamProfile.slug, participantId: teamProfile.participantId })
    .from(teamProfile)
    .where(inArray(teamProfile.participantId, ids));
  const slugOf = new Map(profiles.map((p) => [p.participantId!, p.slug]));
  const venueIds = [...new Set(rows.map((r) => r.homeVenueId).filter((v): v is string => !!v))];
  const venues = venueIds.length
    ? await db
        .select({ id: venue.id, name: venue.name, city: venue.city })
        .from(venue)
        .where(inArray(venue.id, venueIds))
    : [];
  const venueOf = new Map(venues.map((v) => [v.id, v]));
  const kbByApi = byApiId(kb);
  const kbBySlug = new Map(kb.teams.map((t) => [t.entry.slug, t]));

  const grouped = new Map<string, { row: (typeof rows)[number]; competitions: Set<string> }>();
  for (const r of rows) {
    const g = grouped.get(r.participantId) ?? { row: r, competitions: new Set<string>() };
    g.competitions.add(r.competition);
    grouped.set(r.participantId, g);
  }

  const gaps: KnowledgeGap[] = [];
  for (const { row, competitions } of grouped.values()) {
    const apiId = apiIdOf.get(row.participantId) ?? null;
    const slug = slugOf.get(row.participantId);
    const entry =
      (slug ? kbBySlug.get(slug) : undefined) ??
      (apiId !== null ? kbByApi.get(apiId) : undefined) ??
      kb.teams.find((t) => sameName(t, row.name, row.countryCode));
    if (!entry) {
      gaps.push({
        kind: 'missing_team',
        participantId: row.participantId,
        name: row.name,
        countryCode: row.countryCode,
        countryName: (row.countryName as Partial<Record<string, string>> | null)?.['en'] ?? null,
        apiSportsTeamId: apiId,
        competitions: [...competitions].sort(),
      });
      continue;
    }
    if (entry.entry.api_sports?.team_id == null) {
      gaps.push({
        kind: 'unresolved_id',
        participantId: row.participantId,
        name: row.name,
        slug: entry.entry.slug,
        file: entry.file,
        apiSportsTeamId: apiId,
      });
    }
    const v = row.homeVenueId ? venueOf.get(row.homeVenueId) : undefined;
    const stadium = entry.entry.stadium;
    if (v && stadium?.name) {
      const known = [
        stadium.name,
        ...(stadium.nicknames ?? []),
        ...(stadium.former_names ?? []).map((f) => f.name),
      ];
      if (!known.some((k) => sameVenue(k, v.name)))
        gaps.push({
          kind: 'venue_mismatch',
          participantId: row.participantId,
          slug: entry.entry.slug,
          file: entry.file,
          index: entry.index,
          reviewStatus: entry.entry.review_status,
          yamlStadium: stadium.name,
          yamlNicknames: stadium.nicknames ?? [],
          providerVenue: v.name,
          city: v.city,
        });
    }
  }
  return gaps.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      ('name' in a ? a.name : a.slug).localeCompare('name' in b ? b.name : b.slug),
  );
}
