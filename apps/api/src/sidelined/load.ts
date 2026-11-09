import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
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
/**
 * O histórico (`person_sidelined`) só vale se o fornecedor foi consultado há no máximo isso. Parado, ele mostraria
 * como atual uma lesão de quem já voltou; sem ele, o widget fica com a lista do jogo ou diz que ela não saiu.
 */
export const HISTORY_FRESH_DAYS = 14;

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
  const leagueCond = league
    ? sql`or (r.params->>'league' = ${league.id} and r.params->>'season' = ${league.season})`
    : sql``;
  // As requisições que cobrem o jogo: a do próprio jogo, a do dia dele (UTC, como o sync diário pede) e a da
  // liga na temporada. Vale só a resposta bem-sucedida mais recente entre elas, inteira: a lista refeita tira quem
  // voltou (a ausência do jogador é o sinal), então somar respostas antigas traria desfalques que já acabaram. Uma
  // resposta vazia só vale na requisição do próprio jogo (a lista saiu e não tem ninguém). As do dia e da liga não:
  // elas trazem só os jogos com lista (e só das ligas com cobertura de lesões), então sem nenhum item do jogo não
  // afirmam "ninguém fora". Mas a mais recente decide mesmo assim: sem o jogo, a lista mais antiga deixou de valer
  // e o jogo fica sem lista (desconhecido), em vez de mostrar como atual quem pode já ter voltado.
  const [snap] = await db.execute<{ id: number; listed: boolean }>(sql`
    select latest.id,
           (latest.params->>'fixture' is not null
            or exists (select 1 from jsonb_array_elements(latest.body->'response') x
                        where (x->'fixture'->>'id') = ${String(fixturePid)})) as listed
      from (select distinct on (r.request_hash) r.id, r.params, r.body,
                   coalesce(r.last_seen_at, r.fetched_at) as seen
              from raw.api_response r
             where r.provider = ${PROVIDER} and r.sport = 'football' and r.endpoint = '/injuries'
               and r.status_code between 200 and 299
               and (r.errors is null or r.errors in ('[]'::jsonb, '{}'::jsonb))
               and (r.params->>'fixture' = ${String(fixturePid)} or r.params->>'date' = ${eventDay}
                    ${leagueCond})
             order by r.request_hash, r.fetched_at desc) latest
     where jsonb_typeof(latest.body->'response') = 'array'
     order by latest.seen desc
     limit 1`);
  if (!snap?.listed) return { found: false, items: [] };
  const rows = await db.execute<{ item: ApiInjury }>(sql`
    select x as item
      from raw.api_response r
      cross join lateral jsonb_array_elements(r.body->'response') x
     where r.id = ${snap.id} and (x->'fixture'->>'id') = ${String(fixturePid)}`);
  const seen = new Set<string>();
  const items: ApiInjury[] = [];
  for (const r of rows) {
    const k = String(r.item.player?.id ?? r.item.player?.name ?? '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push(r.item);
  }
  return { found: true, items };
}

/** Última consulta de `sidelined` ao fornecedor está dentro de `HISTORY_FRESH_DAYS` de `now`? */
async function historyFresh(db: Database, now: Date): Promise<boolean> {
  const [row] = await db.execute<{ fresh: boolean }>(sql`
    select exists (
      select 1 from raw.api_response r
       where r.provider = ${PROVIDER} and r.sport = 'football' and r.endpoint = '/sidelined'
         and coalesce(r.last_seen_at, r.fetched_at) >= ${new Date(now.getTime() - HISTORY_FRESH_DAYS * 86_400_000).toISOString()}::timestamptz
    ) as fresh`);
  return row?.fresh === true;
}

/**
 * Afastamentos do histórico em aberto na data, dos jogadores do elenco atual. Histórico parado (sem consulta
 * recente ao fornecedor) não entra. Linha encerrada não é cobertura: não diz nada sobre o jogo nem sobre o elenco.
 */
async function historyOn(
  db: Database,
  personIds: string[],
  onDay: string,
  now: Date,
): Promise<{ personId: string; type: string; start: string | null; end: string | null }[]> {
  if (!personIds.length || !(await historyFresh(db, now))) return [];
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
  return [...best.values()];
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
    c.now,
  );
  const info = await peopleInfo(c, [
    ...new Set([...personByPid.values(), ...history.map((h) => h.personId)]),
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
  for (const h of history) {
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
  return new Map([...byTeam].map(([t, lists]) => [t, mergeSidelined(lists)]));
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
      teams: teams.map((s) => ({ team: teamRef(s), available: false, players: [] })),
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
  const players = await build(
    c,
    teams.map((s) => s.id),
    injuries.items,
    eventDay,
  );
  const playersOf = (id: string) => players.get(id) ?? [];
  // Cobertura real: a lista do fornecedor vale para os dois times do jogo; sem ela, só tem o que dizer o time com
  // afastamento em aberto. O adversário sem dado continua desconhecido, não "nenhum desfalque".
  const covered = (id: string) => injuries.found || playersOf(id).length > 0;
  return {
    event_id: head.id,
    available: teams.some((s) => covered(s.id)),
    teams: teams.map((s) => ({ team: teamRef(s), available: covered(s.id), players: playersOf(s.id) })),
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
  if (team.sport !== 'football') return { ...base, available: false, next_event_id: null, players: [] };

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
  let listed = false;
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
    listed = found.found;
    items = found.items.filter((i) => teamPid !== null && String(i.team?.id ?? '') === teamPid);
  }
  const players = (await build(c, [team.id], items, today)).get(team.id) ?? [];
  return {
    ...base,
    available: listed || players.length > 0,
    next_event_id: next?.id ?? null,
    players,
  };
}
