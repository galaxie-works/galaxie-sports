import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { country, providerMap, type Database } from '@galaxie/db';
import { pickText } from '../i18n.js';
import type { FixturePlayerStat } from './stats.js';

const PROVIDER = 'api-sports';

/** País do catálogo (o `CountryRef` do contrato). */
type CountryRef = { code: string; name: string };

const inList = (col: SQL, values: string[]) =>
  sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/**
 * Partidas do time no ano, materializadas antes de abrir o JSON do detalhe: sem o `materialized`, o plano
 * genérico das consultas parametrizadas pode varrer `football_fixture` inteira em paralelo.
 */
const teamYearEvents = (teamId: string, year: number) => sql`
  evs as materialized (
    select e.id, e.starts_at
      from core.event_participant ep
      join core.event e on e.id = ep.event_id
      join core.season s on s.id = e.season_id and s.year = ${year}
     where ep.participant_id = ${teamId})`;

/** Todas as partidas dos times (os candidatos do perfil), materializadas pelo mesmo motivo. */
const teamsEvents = (teamIds: string[]) => sql`
  evs as materialized (
    select distinct ep.event_id as id
      from core.event_participant ep
     where ${inList(sql`ep.participant_id`, teamIds)})`;

/** IDs do fornecedor → IDs do core (`provider_map`) de um tipo de entidade. */
export async function coreIds(
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

/** IDs do core → IDs do fornecedor (o inverso de `coreIds`). */
export async function providerIds(
  db: Database,
  entityType: 'participant' | 'person',
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, PROVIDER),
        eq(providerMap.sport, 'football'),
        eq(providerMap.entityType, entityType),
        inArray(providerMap.entityId, [...new Set(ids)]),
      ),
    );
  return new Map(rows.map((r) => [r.entityId, r.providerId]));
}

/** Números de um jogador do time num ano, somados no banco (uma linha por jogador do fornecedor). */
export interface TeamSeasonPlayer {
  pid: string;
  apps: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  /** Posição mais usada nas escalações (G, D, M, F). */
  position: string | null;
  /** Número do jogo mais recente. */
  number: number | null;
}

/**
 * Jogadores que estiveram nas partidas do time no ano (`detail.players` do bloco do time), com os
 * números somados. Quem ficou no banco sem entrar aparece com `apps` 0.
 */
export async function teamSeasonPlayers(
  db: Database,
  teamId: string,
  teamPid: string,
  year: number,
): Promise<TeamSeasonPlayer[]> {
  const rows = await db.execute<{
    pid: string;
    apps: number;
    starts: number;
    minutes: number;
    goals: number;
    assists: number;
    position: string | null;
    number: number | null;
  }>(sql`
    with ${teamYearEvents(teamId, year)},
    lines as (
      select p->'player'->>'id' as pid, evs.starts_at,
             coalesce((p->'statistics'->0->'games'->>'minutes')::int, 0) as minutes,
             (p->'statistics'->0->'games'->>'substitute')::boolean as substitute,
             coalesce((p->'statistics'->0->'goals'->>'total')::int, 0) as goals,
             coalesce((p->'statistics'->0->'goals'->>'assists')::int, 0) as assists,
             p->'statistics'->0->'games'->>'position' as position,
             (p->'statistics'->0->'games'->>'number')::int as number
        from evs
        join core.football_fixture ff on ff.event_id = evs.id
        cross join lateral jsonb_array_elements(case when jsonb_typeof(ff.detail->'players') = 'array'
                                                     then ff.detail->'players' else '[]'::jsonb end) t
        cross join lateral jsonb_array_elements(case when jsonb_typeof(t->'players') = 'array'
                                                     then t->'players' else '[]'::jsonb end) p
       where t->'team'->>'id' = ${teamPid} and p->'player'->>'id' is not null
    )
    select pid,
           count(*) filter (where minutes > 0)::int as apps,
           count(*) filter (where minutes > 0 and substitute is false)::int as starts,
           sum(minutes)::int as minutes,
           sum(goals)::int as goals,
           sum(assists)::int as assists,
           mode() within group (order by position) filter (where position is not null) as position,
           (array_agg(number order by starts_at desc) filter (where number is not null))[1] as number
      from lines
     group by pid`);
  return [...rows];
}

/** Técnicos do time nas escalações do ano (`detail.lineups[].coach`), com o número de jogos. */
export async function teamSeasonCoaches(
  db: Database,
  teamId: string,
  teamPid: string,
  year: number,
): Promise<{ pid: string; games: number }[]> {
  const rows = await db.execute<{ pid: string; games: number }>(sql`
    with ${teamYearEvents(teamId, year)}
    select l->'coach'->>'id' as pid, count(distinct ff.event_id)::int as games
      from evs
      join core.football_fixture ff on ff.event_id = evs.id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(ff.detail->'lineups') = 'array'
                                                   then ff.detail->'lineups' else '[]'::jsonb end) l
     where l->'team'->>'id' = ${teamPid} and l->'coach'->>'id' is not null
     group by 1`);
  return [...rows];
}

/** Um jogo do jogador: a partida, a temporada e a linha de estatística dele. */
export type PlayerLine = {
  event_id: string;
  starts_at: string;
  year: number | null;
  season_label: string | null;
  competition_id: string | null;
  team_pid: string;
  stat: FixturePlayerStat | null;
};

/**
 * Jogos do jogador nas partidas dos times candidatos (elencos e transferências): a busca pelo ID dele no
 * JSON do detalhe só percorre as partidas desses times, não o acervo inteiro.
 */
export async function playerLines(db: Database, personPid: string, teamIds: string[]): Promise<PlayerLine[]> {
  if (!teamIds.length) return [];
  const rows = await db.execute<PlayerLine>(sql`
    with ${teamsEvents(teamIds)}
    select ff.event_id, e.starts_at, s.year, s.label as season_label, e.competition_id,
           t->'team'->>'id' as team_pid, p->'statistics'->0 as stat
      from evs
      join core.football_fixture ff on ff.event_id = evs.id
      join core.event e on e.id = ff.event_id
      left join core.season s on s.id = e.season_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(ff.detail->'players') = 'array'
                                                   then ff.detail->'players' else '[]'::jsonb end) t
      cross join lateral jsonb_array_elements(case when jsonb_typeof(t->'players') = 'array'
                                                   then t->'players' else '[]'::jsonb end) p
     where p->'player'->>'id' = ${personPid}
     order by e.starts_at desc`);
  return [...rows].map((r) => ({ ...r, starts_at: new Date(r.starts_at).toISOString() }));
}

/** Jogos do técnico (no banco, pelas escalações) nas partidas dos times candidatos. */
export async function coachLines(db: Database, personPid: string, teamIds: string[]): Promise<PlayerLine[]> {
  if (!teamIds.length) return [];
  const rows = await db.execute<PlayerLine>(sql`
    with ${teamsEvents(teamIds)}
    select ff.event_id, e.starts_at, s.year, s.label as season_label, e.competition_id,
           l->'team'->>'id' as team_pid, null::jsonb as stat
      from evs
      join core.football_fixture ff on ff.event_id = evs.id
      join core.event e on e.id = ff.event_id
      left join core.season s on s.id = e.season_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(ff.detail->'lineups') = 'array'
                                                   then ff.detail->'lineups' else '[]'::jsonb end) l
     where l->'coach'->>'id' = ${personPid}
     order by e.starts_at desc`);
  return [...rows].map((r) => ({ ...r, starts_at: new Date(r.starts_at).toISOString() }));
}

/** Times em que a pessoa aparece nos lances (gols, cartões, substituições), pelo índice de `person_id`. */
export async function incidentTeams(db: Database, personId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select distinct i.participant_id as id
      from core.event_incident i
     where (i.person_id = ${personId}) and i.participant_id is not null`);
  return [...rows].map((r) => r.id);
}

/** Times da carreira do técnico no `raw` (`coachs?team`: `career[].team.id`, IDs do fornecedor). */
export async function coachCareerTeams(db: Database, personPid: string): Promise<string[]> {
  const id = Number(personPid);
  if (!Number.isInteger(id)) return [];
  const rows = await db.execute<{ pid: string }>(sql`
    select distinct c->'team'->>'id' as pid
      from raw.api_response r
      cross join lateral jsonb_array_elements(r.body->'response') x
      cross join lateral jsonb_array_elements(case when jsonb_typeof(x->'career') = 'array'
                                                   then x->'career' else '[]'::jsonb end) c
     where r.provider = ${PROVIDER} and r.sport = 'football' and r.endpoint = '/coachs'
       and r.body->'response' @> ${JSON.stringify([{ id }])}::jsonb
       and (x->>'id')::int = ${id} and c->'team'->>'id' is not null`);
  return [...rows].map((r) => r.pid);
}

/** Uma transferência como a api-sports a escreve (`transfers?team`). */
export interface ApiTransfer {
  date?: string | null;
  type?: string | null;
  teams?: {
    in?: { id?: number | null; name?: string | null; logo?: string | null } | null;
    out?: { id?: number | null; name?: string | null; logo?: string | null } | null;
  } | null;
}

/**
 * Transferências do jogador no `raw` (`transfers?team=X` dos times dele; a resposta mais recente de cada
 * time). As listas de times diferentes se repetem: ficam as únicas por data e clubes.
 */
export async function playerTransfers(
  db: Database,
  personPid: string,
  teamPids: string[],
): Promise<ApiTransfer[]> {
  if (!teamPids.length) return [];
  const rows = await db.execute<{ transfers: ApiTransfer[] | null }>(sql`
    select x->'transfers' as transfers
      from (select distinct on (r.params->>'team') r.body
              from raw.api_response r
             where r.provider = ${PROVIDER} and r.sport = 'football' and r.endpoint = '/transfers'
               and ${inList(sql`r.params->>'team'`, teamPids)}
             order by r.params->>'team', r.fetched_at desc) latest
      cross join lateral jsonb_array_elements(case when jsonb_typeof(latest.body->'response') = 'array'
                                                   then latest.body->'response' else '[]'::jsonb end) x
     where x->'player'->>'id' = ${personPid}`);
  const seen = new Set<string>();
  const out: ApiTransfer[] = [];
  for (const r of rows)
    for (const t of Array.isArray(r.transfers) ? r.transfers : []) {
      const key = `${t.date ?? ''}|${t.teams?.out?.id ?? ''}|${t.teams?.in?.id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/**
 * Nacionalidade como o fornecedor escreve ("Brazil") → país do catálogo, com o nome no locale. Compara
 * com os nomes do país em todos os idiomas, sem acento nem caixa.
 */
export async function nationalityResolver(
  db: Database,
  locale: string,
): Promise<(nationality: string | null) => CountryRef | null> {
  const rows = await db.select({ code: country.code, name: country.name }).from(country);
  const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const byName = new Map<string, CountryRef>();
  for (const r of rows) {
    if (r.code === 'WORLD') continue;
    const names = (r.name ?? {}) as Record<string, string>;
    const ref = { code: r.code, name: pickText(names, locale, r.code)! };
    for (const n of Object.values(names)) if (n && !byName.has(plain(n))) byName.set(plain(n), ref);
  }
  return (nationality) => (nationality ? (byName.get(plain(nationality)) ?? null) : null);
}
