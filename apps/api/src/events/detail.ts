import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { EventLineups, EventStats, EventTimeline } from '@galaxie/contracts';
import {
  asset,
  eventIncident,
  eventParticipant,
  footballFixture,
  participant,
  person,
  providerMap,
  type Database,
} from '@galaxie/db';
import { assetUrl } from '../util.js';

const PROVIDER = 'api-sports';

type TeamRef = { id: string | null; name: string | null; side: string | null; logo: string | null };
type PersonRef = { id: string | null; name: string; photo?: string | null };

/** Participantes do evento com lado e logo, indexados pelo nosso ID. */
async function eventTeams(db: Database, eventId: string, assetsBaseUrl: string | undefined) {
  const rows = await db
    .select({
      id: participant.id,
      name: participant.name,
      side: eventParticipant.side,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .leftJoin(asset, eq(asset.id, participant.logoAssetId))
    .where(eq(eventParticipant.eventId, eventId));
  return new Map(
    rows.map((r): [string, TeamRef] => [
      r.id,
      { id: r.id, name: r.name, side: r.side, logo: assetUrl(assetsBaseUrl, r.logoKey, r.logoUrl) },
    ]),
  );
}

/** Timeline a partir de `core.event_incident` (ordem do fornecedor). */
export async function buildTimeline(
  db: Database,
  eventId: string,
  assetsBaseUrl: string | undefined,
): Promise<EventTimeline> {
  const teams = await eventTeams(db, eventId, assetsBaseUrl);
  const player = alias(person, 'player');
  const assist = alias(person, 'assist');
  const rows = await db
    .select({
      i: eventIncident,
      player: { id: player.id, name: player.name },
      assist: { id: assist.id, name: assist.name },
    })
    .from(eventIncident)
    .leftJoin(player, eq(player.id, eventIncident.personId))
    .leftJoin(assist, eq(assist.id, eventIncident.assistPersonId))
    .where(eq(eventIncident.eventId, eventId))
    .orderBy(asc(eventIncident.sequence));
  return {
    event_id: eventId,
    incidents: rows.map((r) => {
      const data = (r.i.data ?? {}) as {
        comments?: string | null;
        team?: { name?: string | null } | null;
        player?: { name?: string | null } | null;
        assist?: { name?: string | null } | null;
      };
      const team = r.i.participantId ? teams.get(r.i.participantId) : undefined;
      const providerTeam = data.team?.name ?? null;
      const personRef = (
        p: { id: string | null; name: string | null } | null,
        fallback: string | null | undefined,
      ): PersonRef | null =>
        p?.id && p.name ? { id: p.id, name: p.name } : fallback ? { id: null, name: fallback } : null;
      return {
        sequence: r.i.sequence,
        minute: r.i.minute,
        extra: r.i.extra,
        type: r.i.type,
        detail: r.i.detail,
        comments: typeof data.comments === 'string' ? data.comments : null,
        team: team ?? (providerTeam ? { id: null, name: providerTeam, side: null, logo: null } : null),
        player: personRef(r.player, data.player?.name),
        assist: personRef(r.assist, data.assist?.name),
      };
    }),
  };
}

interface ApiRef {
  id?: number | null;
  name?: string | null;
  photo?: string | null;
}
interface LineupItem {
  team?: ApiRef;
  formation?: string | null;
  coach?: ApiRef | null;
  startXI?: { player?: ApiRef & { number?: number | null; pos?: string | null; grid?: string | null } }[];
  substitutes?: { player?: ApiRef & { number?: number | null; pos?: string | null; grid?: string | null } }[];
}
interface StatisticsItem {
  team?: ApiRef;
  statistics?: { type?: string; value?: number | string | null }[];
}
interface PlayersItem {
  team?: ApiRef;
  players?: { player?: ApiRef; statistics?: Record<string, unknown>[] }[];
}

/** Resolve IDs do fornecedor (times e pessoas) para os nossos, com nome e foto das pessoas. */
async function resolveProviderRefs(
  db: Database,
  sport: string,
  teamIds: number[],
  personIds: number[],
  assetsBaseUrl: string | undefined,
) {
  const lookup = async (entityType: string, ids: number[]) => {
    if (!ids.length) return new Map<string, string>();
    const rows = await db
      .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
      .from(providerMap)
      .where(
        and(
          eq(providerMap.provider, PROVIDER),
          eq(providerMap.sport, sport),
          eq(providerMap.entityType, entityType),
          inArray(providerMap.providerId, [...new Set(ids)].map(String)),
        ),
      );
    return new Map(rows.map((r) => [r.providerId, r.entityId]));
  };
  const teams = await lookup('participant', teamIds);
  const persons = await lookup('person', personIds);
  const personIdsOurs = [...new Set(persons.values())];
  const personRows = personIdsOurs.length
    ? await db
        .select({ id: person.id, name: person.name, key: asset.storageKey, url: asset.sourceUrl })
        .from(person)
        .leftJoin(asset, eq(asset.id, person.photoAssetId))
        .where(inArray(person.id, personIdsOurs))
    : [];
  const personInfo = new Map(
    personRows.map((p) => [p.id, { name: p.name, photo: assetUrl(assetsBaseUrl, p.key, p.url) }]),
  );
  return {
    team: (ref: ApiRef | undefined) => (ref?.id != null ? (teams.get(String(ref.id)) ?? null) : null),
    person: (ref: ApiRef | null | undefined): PersonRef | null => {
      if (!ref?.name && ref?.id == null) return null;
      const ours = ref?.id != null ? persons.get(String(ref.id)) : undefined;
      const info = ours ? personInfo.get(ours) : undefined;
      return {
        id: ours ?? null,
        name: info?.name ?? ref?.name ?? '',
        photo: info?.photo ?? ref?.photo ?? null,
      };
    },
  };
}

async function fixtureDetail(db: Database, eventId: string) {
  const [row] = await db
    .select({ detail: footballFixture.detail })
    .from(footballFixture)
    .where(eq(footballFixture.eventId, eventId))
    .limit(1);
  return (row?.detail ?? null) as {
    lineups?: LineupItem[];
    statistics?: StatisticsItem[];
    players?: PlayersItem[];
  } | null;
}

function teamRefFrom(ourId: string | null, ref: ApiRef | undefined, teams: Map<string, TeamRef>): TeamRef {
  const known = ourId ? teams.get(ourId) : undefined;
  return known ?? { id: ourId, name: ref?.name ?? null, side: null, logo: null };
}

/** Escalações a partir do detalhe da partida (`core.football_fixture.detail.lineups`). */
export async function buildLineups(
  db: Database,
  ev: { id: string; sport: string },
  assetsBaseUrl: string | undefined,
): Promise<EventLineups> {
  const detail = ev.sport === 'football' ? await fixtureDetail(db, ev.id) : null;
  const lineups = Array.isArray(detail?.lineups) ? detail.lineups : [];
  if (!lineups.length) return { event_id: ev.id, available: false, lineups: [] };
  const teams = await eventTeams(db, ev.id, assetsBaseUrl);
  const players = lineups.flatMap((l) => [...(l.startXI ?? []), ...(l.substitutes ?? [])]);
  const refs = await resolveProviderRefs(
    db,
    ev.sport,
    lineups.map((l) => l.team?.id).filter((x): x is number => typeof x === 'number'),
    [...players.map((p) => p.player?.id), ...lineups.map((l) => l.coach?.id)].filter(
      (x): x is number => typeof x === 'number',
    ),
    assetsBaseUrl,
  );
  const player = (p: NonNullable<LineupItem['startXI']>[number]) => ({
    person: refs.person(p.player) ?? { id: null, name: '' },
    number: p.player?.number ?? null,
    position: p.player?.pos ?? null,
    grid: p.player?.grid ?? null,
  });
  return {
    event_id: ev.id,
    available: true,
    lineups: lineups
      .map((l) => ({
        team: teamRefFrom(refs.team(l.team), l.team, teams),
        formation: l.formation ?? null,
        coach: refs.person(l.coach),
        start_xi: (l.startXI ?? []).map(player),
        substitutes: (l.substitutes ?? []).map(player),
      }))
      .sort((a, b) => sideRank(a.team.side) - sideRank(b.team.side)),
  };
}

const sideRank = (s: string | null) => (s === 'home' ? 0 : s === 'away' ? 1 : 2);

/** Estatísticas por time e por jogador (`detail.statistics` e `detail.players`). */
export async function buildStats(
  db: Database,
  ev: { id: string; sport: string },
  assetsBaseUrl: string | undefined,
): Promise<EventStats> {
  const detail = ev.sport === 'football' ? await fixtureDetail(db, ev.id) : null;
  const statistics = Array.isArray(detail?.statistics) ? detail.statistics : [];
  const players = Array.isArray(detail?.players) ? detail.players : [];
  if (!statistics.length && !players.length)
    return { event_id: ev.id, available: false, teams: [], players: [] };
  const teams = await eventTeams(db, ev.id, assetsBaseUrl);
  const refs = await resolveProviderRefs(
    db,
    ev.sport,
    [...statistics, ...players].map((t) => t.team?.id).filter((x): x is number => typeof x === 'number'),
    players
      .flatMap((t) => (t.players ?? []).map((p) => p.player?.id))
      .filter((x): x is number => typeof x === 'number'),
    assetsBaseUrl,
  );
  return {
    event_id: ev.id,
    available: true,
    teams: statistics
      .map((t) => ({
        team: teamRefFrom(refs.team(t.team), t.team, teams),
        statistics: (t.statistics ?? []).map((s) => ({
          type: String(s.type ?? ''),
          value: typeof s.value === 'number' || typeof s.value === 'string' ? s.value : null,
        })),
      }))
      .sort((a, b) => sideRank(a.team.side) - sideRank(b.team.side)),
    players: players
      .map((t) => ({
        team: teamRefFrom(refs.team(t.team), t.team, teams),
        players: (t.players ?? []).map((p) => ({
          person: refs.person(p.player) ?? { id: null, name: '' },
          statistics: (p.statistics?.[0] ?? {}) as Record<string, unknown>,
        })),
      }))
      .sort((a, b) => sideRank(a.team.side) - sideRank(b.team.side)),
  };
}
