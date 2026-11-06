import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { EventSidelined, SidelinedPlayer, TeamSidelined } from '@galaxie/contracts';
import {
  asset,
  event,
  eventParticipant,
  footballFixture,
  participant,
  person,
  personSidelined,
  providerMap,
  roster,
  type Database,
} from '@galaxie/db';
import { teamLogoId } from '../assets/custom-logos.js';
import { problems } from '../errors.js';
import { loadTeamNames, type TeamNameOptions } from '../teams/display-name.js';
import { assetUrl } from '../util.js';
import {
  isActiveOn,
  mergeSidelined,
  sidelinedCategory,
  sidelinedReasonLabel,
  sidelinedStatus,
} from './classify.js';

/**
 * Desfalques (issue #830): a lista do fornecedor para o jogo (`injuries`, que só fica no `raw`) e o histórico de
 * afastamentos dos jogadores (`core.person_sidelined`, de `sidelined?players`) em aberto na data. Nada chama o
 * fornecedor: o ingestor já busca `injuries?date=` no sync diário e `injuries?league&season` na carga das temporadas.
 */

const PROVIDER = 'api-sports';
/** Janela do "próximo jogo" na rota do time. */
const NEXT_EVENT_DAYS = 10;

export interface SidelinedContext {
  db: Database;
  assetsBaseUrl: string | undefined;
  customLogos: boolean;
  names: TeamNameOptions;
  now: Date;
}

type TeamRef = EventSidelined['teams'][number]['team'];

/** Item de `injuries` como a api-sports escreve. */
interface ApiInjury {
  player?: {
    id?: number | null;
    name?: string | null;
    photo?: string | null;
    type?: string | null;
    reason?: string | null;
  };
  team?: { id?: number | null; name?: string | null; logo?: string | null };
  fixture?: { id?: number | null };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return day(x);
};
const inList = (col: SQL, values: string[]) =>
  sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/** Times com nome de exibição e logo. */
async function teamRefs(c: SidelinedContext, ids: string[]): Promise<Map<string, Omit<TeamRef, 'side'>>> {
  if (!ids.length) return new Map();
  const rows = await c.db
    .select({ id: participant.id, name: participant.name, key: asset.storageKey, url: asset.sourceUrl })
    .from(participant)
    .leftJoin(asset, eq(asset.id, teamLogoId(c.customLogos)))
    .where(inArray(participant.id, ids));
  const names = await loadTeamNames(
    c.db,
    rows.map((r) => r.id),
    c.names,
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: names.name(r.id, r.name), logo: assetUrl(c.assetsBaseUrl, r.key, r.url) },
    ]),
  );
}

async function mapIds(
  db: Database,
  entityType: 'participant' | 'person',
  providerIds: string[],
): Promise<Map<string, string>> {
  if (!providerIds.length) return new Map();
  const rows = await db
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, PROVIDER),
        eq(providerMap.sport, 'football'),
        eq(providerMap.entityType, entityType),
        inArray(providerMap.providerId, [...new Set(providerIds)]),
      ),
    );
  return new Map(rows.map((r) => [r.providerId, r.entityId]));
}

async function providerIdOf(db: Database, entityId: string): Promise<string | null> {
  const [row] = await db
    .select({ providerId: providerMap.providerId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, PROVIDER),
        eq(providerMap.sport, 'football'),
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.entityId, entityId),
      ),
    )
    .limit(1);
  return row?.providerId ?? null;
}

/** Pessoas do core (nome, foto) e o que o elenco atual do time diz delas (camisa, posição). */
async function peopleInfo(c: SidelinedContext, personIds: string[]) {
  if (!personIds.length) return new Map<string, { name: string; photo: string | null }>();
  const rows = await c.db
    .select({ id: person.id, name: person.name, key: asset.storageKey, url: asset.sourceUrl })
    .from(person)
    .leftJoin(asset, eq(asset.id, person.photoAssetId))
    .where(inArray(person.id, personIds));
  return new Map(rows.map((r) => [r.id, { name: r.name, photo: assetUrl(c.assetsBaseUrl, r.key, r.url) }]));
}

/** Elenco atual (jogadores) dos times: pessoa → time, camisa e posição. */
async function currentPlayers(db: Database, teamIds: string[]) {
  if (!teamIds.length) return [];
  return db
    .select({
      teamId: roster.participantId,
      personId: roster.personId,
      number: roster.number,
      position: roster.position,
    })
    .from(roster)
    .where(and(inArray(roster.participantId, teamIds), isNull(roster.seasonId), eq(roster.role, 'player')));
}

/** Lista do fornecedor para o jogo: a resposta mais recente de cada requisição de `injuries` que cobre o jogo. */
async function fixtureInjuries(
  db: Database,
  fixturePid: number,
  eventDay: string,
  league: { id: string; season: string } | null,
): Promise<{ found: boolean; items: ApiInjury[] }> {
  const days = [addDays(eventDay, -1), eventDay, addDays(eventDay, 1)];
  const leagueCond = league
    ? sql`or (r.params->>'league' = ${league.id} and r.params->>'season' = ${league.season})`
    : sql``;
  const rows = await db.execute<{ item: ApiInjury; seen: string }>(sql`
    select x as item, latest.seen
      from (select distinct on (r.request_hash) r.body, coalesce(r.last_seen_at, r.fetched_at) as seen
              from raw.api_response r
             where r.provider = ${PROVIDER} and r.sport = 'football' and r.endpoint = '/injuries'
               and (r.params->>'fixture' = ${String(fixturePid)} or ${inList(sql`r.params->>'date'`, days)}
                    ${leagueCond})
             order by r.request_hash, r.fetched_at desc) latest
      cross join lateral jsonb_array_elements(case when jsonb_typeof(latest.body->'response') = 'array'
                                                   then latest.body->'response' else '[]'::jsonb end) x
     where (x->'fixture'->>'id') = ${String(fixturePid)}
     order by latest.seen desc`);
  // a mais recente vence: a lista do dia é refeita a cada sync e pode tirar quem voltou
  const seen = new Set<string>();
  const items: ApiInjury[] = [];
  for (const r of rows) {
    const k = String(r.item.player?.id ?? r.item.player?.name ?? '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push(r.item);
  }
  return { found: rows.length > 0, items };
}

/** Afastamentos do histórico em aberto na data, dos jogadores do elenco atual; e se há histórico para eles. */
async function historyOn(
  db: Database,
  personIds: string[],
  onDay: string,
): Promise<{
  covered: boolean;
  rows: { personId: string; type: string; start: string | null; end: string | null }[];
}> {
  if (!personIds.length) return { covered: false, rows: [] };
  const all = await db
    .select({
      personId: personSidelined.personId,
      type: personSidelined.type,
      start: personSidelined.startDate,
      end: personSidelined.endDate,
    })
    .from(personSidelined)
    .where(inArray(personSidelined.personId, personIds));
  const rows = all.filter((r) => isActiveOn(r.start, r.end, onDay));
  // o mesmo jogador com dois registros abertos (lesão e suspensão): o que termina por último
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = best.get(r.personId);
    if (!prev || (r.end ?? '9999') > (prev.end ?? '9999')) best.set(r.personId, r);
  }
  return { covered: all.length > 0, rows: [...best.values()] };
}

/**
 * Monta as duas listas (jogo e histórico) por time e junta. `teamPids` liga o id do fornecedor ao nosso time.
 */
async function build(c: SidelinedContext, teamIds: string[], injuries: ApiInjury[], onDay: string) {
  const roster = await currentPlayers(c.db, teamIds);
  const rosterOf = new Map(roster.map((r) => [r.personId, r]));
  const teamByPid = new Map<string, string>();
  for (const [pid, id] of await mapIds(
    c.db,
    'participant',
    injuries.map((i) => String(i.team?.id ?? '')).filter(Boolean),
  ))
    teamByPid.set(pid, id);
  const personByPid = await mapIds(
    c.db,
    'person',
    injuries.map((i) => String(i.player?.id ?? '')).filter(Boolean),
  );
  const history = await historyOn(
    c.db,
    roster.map((r) => r.personId),
    onDay,
  );
  const info = await peopleInfo(c, [
    ...new Set([...personByPid.values(), ...history.rows.map((h) => h.personId)]),
  ]);
  const lang = c.names.locale;

  const byTeam = new Map<string, SidelinedPlayer[][]>(teamIds.map((t) => [t, [[], []]]));
  for (const i of injuries) {
    const teamId = teamByPid.get(String(i.team?.id ?? ''));
    if (!teamId || !byTeam.has(teamId)) continue;
    const personId = personByPid.get(String(i.player?.id ?? '')) ?? null;
    const p = personId ? info.get(personId) : undefined;
    const r = personId ? rosterOf.get(personId) : undefined;
    const reason = i.player?.reason?.trim() || null;
    byTeam.get(teamId)![0]!.push({
      person: {
        id: personId,
        name: p?.name ?? i.player?.name ?? '',
        photo: p?.photo ?? i.player?.photo ?? null,
      },
      position: r?.position ?? null,
      number: r?.number ?? null,
      status: sidelinedStatus(i.player?.type),
      category: sidelinedCategory(reason),
      reason,
      reason_label: sidelinedReasonLabel(reason, lang),
      since: null,
      until: null,
      source: 'match',
    });
  }
  for (const h of history.rows) {
    const r = rosterOf.get(h.personId);
    const p = info.get(h.personId);
    if (!r || !p) continue;
    byTeam.get(r.teamId)?.[1]!.push({
      person: { id: h.personId, name: p.name, photo: p.photo },
      position: r.position,
      number: r.number,
      status: 'out',
      category: sidelinedCategory(h.type),
      reason: h.type,
      reason_label: sidelinedReasonLabel(h.type, lang),
      since: h.start,
      until: h.end,
      source: 'history',
    });
  }
  return {
    covered: history.covered,
    players: new Map([...byTeam].map(([t, lists]) => [t, mergeSidelined(lists)])),
  };
}

/** `GET /v1/events/{id}/sidelined`. */
export async function loadEventSidelined(
  c: SidelinedContext,
  head: { id: string; sport: string; startsAt: Date },
): Promise<EventSidelined> {
  const sides = await c.db
    .select({ id: eventParticipant.participantId, side: eventParticipant.side })
    .from(eventParticipant)
    .where(eq(eventParticipant.eventId, head.id));
  const refs = await teamRefs(
    c,
    sides.map((s) => s.id),
  );
  const order = (s: string | null) => (s === 'home' ? 0 : s === 'away' ? 1 : 2);
  const teams = [...sides].sort((a, b) => order(a.side) - order(b.side));
  const teamRef = (s: (typeof sides)[number]): TeamRef => ({
    id: s.id,
    name: refs.get(s.id)?.name ?? null,
    logo: refs.get(s.id)?.logo ?? null,
    side: s.side === 'home' || s.side === 'away' ? s.side : null,
  });
  if (head.sport !== 'football')
    return {
      event_id: head.id,
      available: false,
      teams: teams.map((s) => ({ team: teamRef(s), players: [] })),
    };

  const [fx] = await c.db
    .select({ pid: footballFixture.providerFixtureId, summary: footballFixture.summary })
    .from(footballFixture)
    .where(eq(footballFixture.eventId, head.id))
    .limit(1);
  const eventDay = day(head.startsAt);
  const league = (fx?.summary as { league?: { id?: number | null; season?: number | null } } | undefined)
    ?.league;
  const injuries = fx
    ? await fixtureInjuries(
        c.db,
        fx.pid,
        eventDay,
        league?.id != null && league.season != null
          ? { id: String(league.id), season: String(league.season) }
          : null,
      )
    : { found: false, items: [] };
  const built = await build(
    c,
    teams.map((s) => s.id),
    injuries.items,
    eventDay,
  );
  return {
    event_id: head.id,
    available: injuries.found || built.covered,
    teams: teams.map((s) => ({ team: teamRef(s), players: built.players.get(s.id) ?? [] })),
  };
}

/** `GET /v1/teams/{id}/sidelined`. */
export async function loadTeamSidelined(
  c: SidelinedContext,
  teamId: string,
): Promise<TeamSidelined & { sport: string }> {
  const [team] = await c.db
    .select({ id: participant.id, sport: participant.sport })
    .from(participant)
    .where(eq(participant.id, teamId))
    .limit(1);
  if (!team) throw problems.notFound('Time');
  const ref = (await teamRefs(c, [team.id])).get(team.id);
  const today = day(c.now);
  const base = {
    team: { id: team.id, name: ref?.name ?? null, logo: ref?.logo ?? null, side: null },
    as_of: today,
    sport: team.sport,
  };
  if (team.sport !== 'football') return { ...base, next_event_id: null, players: [] };

  const until = new Date(c.now.getTime() + NEXT_EVENT_DAYS * 86_400_000);
  const [next] = await c.db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      pid: footballFixture.providerFixtureId,
      summary: footballFixture.summary,
    })
    .from(eventParticipant)
    .innerJoin(event, eq(event.id, eventParticipant.eventId))
    .innerJoin(footballFixture, eq(footballFixture.eventId, event.id))
    .where(
      and(
        eq(eventParticipant.participantId, team.id),
        gte(event.startsAt, new Date(c.now.getTime() - 3 * 3_600_000)),
        lte(event.startsAt, until),
        inArray(event.status, ['scheduled', 'starting', 'live', 'break']),
      ),
    )
    .orderBy(event.startsAt)
    .limit(1);
  let items: ApiInjury[] = [];
  if (next) {
    const league = (next.summary as { league?: { id?: number | null; season?: number | null } }).league;
    const teamPid = await providerIdOf(c.db, team.id);
    const found = await fixtureInjuries(
      c.db,
      next.pid,
      day(next.startsAt),
      league?.id != null && league.season != null
        ? { id: String(league.id), season: String(league.season) }
        : null,
    );
    items = found.items.filter((i) => teamPid !== null && String(i.team?.id ?? '') === teamPid);
  }
  const built = await build(c, [team.id], items, today);
  return { ...base, next_event_id: next?.id ?? null, players: built.players.get(team.id) ?? [] };
}
