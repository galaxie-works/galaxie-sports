import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { WikimediaClient } from './commons/client.js';
import type { TeamResolution, TeamTarget } from './wikidata-teams.js';

/**
 * Mapa de canais oficiais do Conteúdo relacionado (docs/12 §3.2) a partir do Wikidata: o P2397 ("YouTube channel
 * ID") do QID do time e da competição. O QID vem do casamento estrito já gravado em `core.provider_map`
 * (`wikidata`, CLI `pessoas:wikidata-por-time`) ou, com `--resolver`, do mesmo `resolveTeams` (clube de futebol
 * do mesmo país e da mesma categoria, nome e liga como desempate; ambíguo não liga). O da competição vem do
 * `core.competition_title_coverage` (CLI `titulos:wikidata`). Grava em `enrich.related_channel` com a fonte
 * (`wikidata`) e o QID; o agente lê os uploads desses canais antes de gastar a busca.
 */

export const YOUTUBE_CHANNEL_PROP = 'P2397';
const CHANNEL_ID = /^UC[\w-]{22}$/;
/** Canais por entidade, no máximo (um clube às vezes lista o canal principal e o da base). */
export const MAX_CHANNELS_PER_ENTITY = 2;

interface Claim {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown[]>;
}

/**
 * Ids de canal de uma lista de afirmações P2397: sem as depreciadas e as encerradas (P582, data de fim); havendo
 * afirmação preferida, só as preferidas. Só ids no formato do YouTube (UC + 22).
 */
export function youtubeChannelIds(claims: readonly unknown[] | undefined): string[] {
  const valid = ((claims ?? []) as Claim[]).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582);
  const preferred = valid.filter((c) => c.rank === 'preferred');
  const ids = (preferred.length ? preferred : valid)
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v): v is string => typeof v === 'string' && CHANNEL_ID.test(v));
  return [...new Set(ids)].slice(0, MAX_CHANNELS_PER_ENTITY);
}

export interface ChannelTargetTeam {
  participantId: string;
  /** Id do time na api-sports (para o `resolveTeams`). */
  providerId: string;
  name: string;
  qid: string | null;
}

export interface ChannelTargets {
  teams: ChannelTargetTeam[];
  /** Times sem QID, no formato do `resolveTeams`. */
  unresolved: TeamTarget[];
  competitions: { competitionId: string; slug: string; qid: string }[];
}

/** Times e competições de futebol (tier ≤ `maxTier`) com jogos entre `since` e `until`. */
export async function channelTargets(
  db: Database,
  opts: { since: Date; until: Date; maxTier: number },
): Promise<ChannelTargets> {
  const teams = await db.execute<{
    participant_id: string;
    provider_id: string;
    name: string;
    qid: string | null;
    country: string | null;
    leagues: string[] | null;
  }>(sql`
    with ev as (
      select e.id, e.competition_id from core.event e join core.competition c on c.id = e.competition_id
       where e.sport = 'football' and c.tier <= ${opts.maxTier}
         and e.starts_at >= ${opts.since.toISOString()}::timestamptz and e.starts_at < ${opts.until.toISOString()}::timestamptz
    ), t as (
      select distinct ep.participant_id from core.event_participant ep join ev on ev.id = ep.event_id
    )
    select pa.id as participant_id, m.provider_id, pa.name, w.provider_id as qid, co.name->>'en' as country,
           (select array_agg(distinct c.name) from core.event_participant ep2 join core.event e2 on e2.id = ep2.event_id
              join core.competition c on c.id = e2.competition_id
             where ep2.participant_id = pa.id and c.type = 'league') as leagues
      from t join core.participant pa on pa.id = t.participant_id
      join core.provider_map m on m.entity_id = pa.id and m.provider = 'api-sports' and m.sport = 'football'
        and m.entity_type = 'participant'
      left join core.provider_map w on w.entity_id = pa.id and w.provider = 'wikidata' and w.entity_type = 'participant'
      left join core.country co on co.code = pa.country_code
  `);
  const comps = await db.execute<{ competition_id: string; slug: string; qid: string }>(sql`
    select distinct c.id as competition_id, c.slug, coalesce(w.provider_id, cov.competition_qid) as qid
      from core.competition c
      left join core.provider_map w on w.entity_id = c.id and w.provider = 'wikidata' and w.entity_type = 'competition'
      left join core.competition_title_coverage cov on cov.competition_id = c.id
     where c.sport = 'football' and c.tier <= ${opts.maxTier}
       and coalesce(w.provider_id, cov.competition_qid) is not null
       and exists (select 1 from core.event e where e.competition_id = c.id
                    and e.starts_at >= ${opts.since.toISOString()}::timestamptz and e.starts_at < ${opts.until.toISOString()}::timestamptz)
  `);
  const rows = [...teams];
  return {
    teams: rows.map((r) => ({
      participantId: r.participant_id,
      providerId: r.provider_id,
      name: r.name,
      qid: r.qid,
    })),
    unresolved: rows
      .filter((r) => !r.qid)
      .map((r) => ({
        providerId: r.provider_id,
        name: r.name,
        country: r.country,
        leagues: r.leagues ?? [],
      })),
    competitions: [...comps].map((c) => ({ competitionId: c.competition_id, slug: c.slug, qid: c.qid })),
  };
}

export interface ChannelLinkRow {
  kind: 'club' | 'competition';
  participantId?: string;
  competitionId?: string;
  channelId: string;
  qid: string;
}

/** P2397 dos QIDs → linhas do mapa (clube e competição). */
export async function wikidataChannelLinks(
  client: Pick<WikimediaClient, 'claims'>,
  targets: {
    teams: { participantId: string; qid: string }[];
    competitions: { competitionId: string; qid: string }[];
  },
): Promise<ChannelLinkRow[]> {
  const qids = [...new Set([...targets.teams.map((t) => t.qid), ...targets.competitions.map((c) => c.qid)])];
  const claims = await client.claims(qids, [YOUTUBE_CHANNEL_PROP]);
  const of = (qid: string) => youtubeChannelIds(claims.get(qid)?.[YOUTUBE_CHANNEL_PROP]);
  return [
    ...targets.teams.flatMap((t) =>
      of(t.qid).map((channelId) => ({
        kind: 'club' as const,
        participantId: t.participantId,
        channelId,
        qid: t.qid,
      })),
    ),
    ...targets.competitions.flatMap((c) =>
      of(c.qid).map((channelId) => ({
        kind: 'competition' as const,
        competitionId: c.competitionId,
        channelId,
        qid: c.qid,
      })),
    ),
  ];
}

/** QIDs resolvidos agora (`--resolver`) → `core.provider_map` (`wikidata`/`participant`), como o fluxo dos jogadores. */
export async function saveTeamQids(db: Database, resolved: Map<string, TeamResolution>): Promise<number> {
  let n = 0;
  for (const [providerId, r] of resolved) {
    if (!('qid' in r)) continue;
    const rows = await db.execute(sql`
      insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
      select 'participant', m.entity_id, 'wikidata', 'football', ${r.qid}
      from core.provider_map m
      where m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'participant' and m.provider_id = ${providerId}
      on conflict do nothing
      returning entity_id
    `);
    n += [...rows].length;
  }
  return n;
}

export interface SaveLinksReport {
  inserted: number;
  kept: number;
  deactivated: number;
}

/**
 * Grava o mapa (fonte `wikidata`): insere o que é novo, reativa o que voltou e desativa os canais do Wikidata das
 * mesmas entidades que saíram do P2397 (nunca apaga: o histórico de vídeos aponta para o canal).
 */
export async function saveChannelLinks(
  db: Database,
  links: readonly ChannelLinkRow[],
  /** Entidades consultadas no Wikidata (as que ficaram sem P2397 também perdem o canal antigo). */
  checked: { club: string[]; competition: string[] },
): Promise<SaveLinksReport> {
  const report: SaveLinksReport = { inserted: 0, kept: 0, deactivated: 0 };
  return db.transaction(async (tx) => {
    for (const l of links) {
      const rows = await tx.execute<{ inserted: boolean }>(sql`
        insert into enrich.related_channel (channel_id, kind, participant_id, competition_id, source, source_ref)
        values (${l.channelId}, ${l.kind}, ${l.participantId ?? null}, ${l.competitionId ?? null}, 'wikidata', ${l.qid})
        on conflict on constraint related_channel_uq do update
          set active = true, source_ref = excluded.source_ref, updated_at = now()
        returning (xmax = 0) as inserted
      `);
      if ([...rows][0]?.inserted) report.inserted++;
      else report.kept++;
    }
    for (const kind of ['club', 'competition'] as const) {
      const ids = [...new Set(checked[kind])];
      if (!ids.length) continue;
      const keep = links
        .filter((l) => l.kind === kind)
        .map((l) => `${l.participantId ?? l.competitionId}|${l.channelId}`);
      const col = kind === 'club' ? sql.raw('participant_id') : sql.raw('competition_id');
      const notKept = keep.length
        ? sql`and (${col}::text || '|' || channel_id) not in (${sql.join(
            keep.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql``;
      const off = await tx.execute(sql`
        update enrich.related_channel set active = false, updated_at = now()
         where source = 'wikidata' and kind = ${kind} and active
           and ${col}::text in (${sql.join(
             ids.map((i) => sql`${i}`),
             sql`, `,
           )}) ${notKept}
        returning id
      `);
      report.deactivated += [...off].length;
    }
    return report;
  });
}
