/**
 * Persistência do Conteúdo relacionado em `enrich.related_content` (docs/12 §5.8–10): uma versão por
 * mudança material, `last_checked_at`/estatísticas renovados sem versão nova, vídeo fora do ar →
 * versão `retracted`, e expiração em 30 dias (política de dados da plataforma). Mudança visível →
 * `event.related_content_changed` no change feed (purge de cache, SSE, webhook).
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import {
  promoteRefusedChannels,
  publishChange,
  RELATED_CONTENT_TOPIC,
  relatedBudget,
  relatedChannelRule,
  relatedContent,
  relatedContentTag,
  relatedPlaybackBlock,
  relatedPlaybackReport,
  youtubeChannel,
  type Database,
  type RelatedContentRow,
  type RelatedAspectRatio,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedSkippedGame,
  type RelatedSourceTier,
  type RelatedStatistics,
  type RelatedStatus,
  type RelatedUpcomingGame,
} from '@galaxie/db';
import type { CompetitionYieldRow } from './budget.js';

export interface RelatedItemInput {
  externalId: string;
  url: string;
  embedUrl: string | null;
  title: string;
  descriptionExcerpt: string | null;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  sourceTier: RelatedSourceTier;
  contentType: RelatedContentType;
  format: RelatedFormat;
  aspectRatio: RelatedAspectRatio;
  durationSeconds: number | null;
  publishedAt: Date;
  thumbnailUrl: string | null;
  language: string | null;
  regionAllowed: string[] | null;
  regionBlocked: string[];
  statistics: RelatedStatistics | null;
  rankScore: number;
  confidence: number;
  classifiedBy: string;
  status: RelatedStatus;
  flags: string[];
  queries: string[];
}

export interface SaveRelatedInput {
  eventId: string;
  provider: 'youtube';
  items: readonly RelatedItemInput[];
  /** Ids que a plataforma não devolveu mais (removidos/privados) → `retracted`. */
  gone?: readonly string[];
  runId: string;
  /** Esporte e competição do evento (filtros de SSE/webhook). */
  sport?: string;
  competitionId?: string | null;
  now?: Date;
}

export interface SaveRelatedResult {
  inserted: number;
  versioned: number;
  refreshed: number;
  retracted: number;
  /** Publicados visíveis que entraram, mudaram ou saíram. */
  visibleChanges: number;
  changeId: number | null;
}

const material = (
  r: Pick<RelatedItemInput, 'contentType' | 'format' | 'status' | 'title' | 'flags' | 'sourceTier'>,
) => JSON.stringify([r.contentType, r.format, r.status, r.title, [...r.flags].sort(), r.sourceTier]);

export async function currentRelatedRows(
  db: Pick<Database, 'select'>,
  eventId: string,
  provider = 'youtube',
): Promise<RelatedContentRow[]> {
  return db
    .select()
    .from(relatedContent)
    .where(
      and(
        eq(relatedContent.eventId, eventId),
        eq(relatedContent.provider, provider),
        isNull(relatedContent.supersededBy),
      ),
    );
}

export async function saveRelatedContent(db: Database, input: SaveRelatedInput): Promise<SaveRelatedResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const current = new Map(
      (await currentRelatedRows(tx, input.eventId, input.provider)).map((r) => [r.externalId, r]),
    );
    const res: SaveRelatedResult = {
      inserted: 0,
      versioned: 0,
      refreshed: 0,
      retracted: 0,
      visibleChanges: 0,
      changeId: null,
    };
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    const insertVersion = async (
      values: typeof relatedContent.$inferInsert,
      previous?: RelatedContentRow,
    ) => {
      // aposenta a anterior antes de inserir (índice único da versão vigente); o id real vem depois
      if (previous)
        await tx
          .update(relatedContent)
          .set({ supersededBy: previous.id, supersededAt: now })
          .where(eq(relatedContent.id, previous.id));
      const [row] = await tx.insert(relatedContent).values(values).returning({ id: relatedContent.id });
      if (previous)
        await tx
          .update(relatedContent)
          .set({ supersededBy: row!.id })
          .where(eq(relatedContent.id, previous.id));
    };

    for (const item of input.items) {
      const prev = current.get(item.externalId);
      const values = {
        eventId: input.eventId,
        provider: input.provider,
        ...item,
        rankScore: item.rankScore.toFixed(3),
        confidence: item.confidence.toFixed(2),
        runId: input.runId,
        lastCheckedAt: now,
        createdAt: now,
        firstSeenAt: prev?.firstSeenAt ?? now,
      };
      if (!prev) {
        await insertVersion(values);
        res.inserted++;
        if (item.status === 'published') added.push(item.externalId);
        continue;
      }
      if (material(prev) === material(item)) {
        await tx
          .update(relatedContent)
          .set({
            lastCheckedAt: now,
            statistics: item.statistics,
            rankScore: values.rankScore,
            thumbnailUrl: item.thumbnailUrl,
            // proporção vem das dimensões do player: atualiza sem criar versão nova
            aspectRatio: item.aspectRatio,
            // a restrição de país filtra na leitura, por país do público: também sem versão nova
            regionAllowed: item.regionAllowed,
            regionBlocked: item.regionBlocked,
            queries: [...new Set([...prev.queries, ...item.queries])],
            runId: input.runId,
          })
          .where(eq(relatedContent.id, prev.id));
        res.refreshed++;
        continue;
      }
      await insertVersion({ ...values, queries: [...new Set([...prev.queries, ...item.queries])] }, prev);
      res.versioned++;
      if (prev.status === 'published' && item.status !== 'published') removed.push(item.externalId);
      else if (prev.status !== 'published' && item.status === 'published') added.push(item.externalId);
      else if (item.status === 'published') changed.push(item.externalId);
    }

    for (const id of input.gone ?? []) {
      const prev = current.get(id);
      if (!prev || prev.status === 'retracted' || prev.status === 'expired') continue;
      const { id: _id, supersededBy: _s, supersededAt: _a, ...rest } = prev;
      await insertVersion(
        { ...rest, status: 'retracted', runId: input.runId, createdAt: now, lastCheckedAt: now },
        prev,
      );
      res.retracted++;
      if (prev.status === 'published') removed.push(id);
    }

    res.visibleChanges = added.length + removed.length + changed.length;
    if (res.visibleChanges)
      res.changeId = await publishChange(tx, {
        topic: RELATED_CONTENT_TOPIC,
        entityType: 'related_content',
        entityId: input.eventId,
        payload: {
          event_id: input.eventId,
          sport: input.sport ?? null,
          competition_id: input.competitionId ?? null,
          changed: ['related_content'],
          data: { added, removed, changed },
          tags: [relatedContentTag(input.eventId), `event:${input.eventId}`],
        },
      });
    return res;
  });
}

/** Dias que um dado obtido da API do YouTube fica guardado (docs/12 §2.1, política III.E.4). */
export const YOUTUBE_RETENTION_DAYS = 30;

export interface YoutubeRetentionResult {
  /** Canais no limiar de recusas que viraram regra `block` do automático antes de os ids saírem. */
  promoted: string[];
  /** Linhas de `related_content` apagadas (todas as versões) e os jogos avisados. */
  rows: number;
  events: string[];
  /** Canais do cache do `channels.list` (`youtube_channel`) apagados. */
  channels: number;
  /** Recusas do player (`related_playback_block`) e registros de quem relatou apagados. */
  blocks: number;
  reports: number;
  /** Regras de canal que perderam o título (`channel_title`, dado da API). */
  ruleTitles: number;
}

/**
 * Retenção do que vem da API do YouTube: apaga 30 dias depois de obtido, sem renovação. A revalidação não
 * estende o prazo: o vídeo sai `YOUTUBE_RETENTION_DAYS` depois do `first_seen_at`, com todas as versões
 * (título, trecho, miniatura, estatísticas, canal, handle e o próprio id). O cache de canais sai pelo
 * `fetched_at`; a recusa do player e o registro de quem relatou, pelo primeiro relato; a regra de canal perde
 * o título. Antes, o canal no limiar de recusas vira regra `block` do automático: o id do canal fica como
 * configuração nossa, e o bloqueio (e a economia de cota) continua. Idempotente; roda a cada execução do
 * agente.
 */
export async function purgeYoutubeData(
  db: Database,
  options: { now?: Date; days?: number } = {},
): Promise<YoutubeRetentionResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.days ?? YOUTUBE_RETENTION_DAYS) * 86_400_000);
  return db.transaction(async (tx) => {
    const promoted = await promoteRefusedChannels(tx, { now });

    // vídeos: o que estava na vitrine some dela (aviso por jogo); as versões antigas saem junto
    const visible = await tx
      .select({ eventId: relatedContent.eventId, externalId: relatedContent.externalId })
      .from(relatedContent)
      .where(
        and(
          lt(relatedContent.firstSeenAt, cutoff),
          isNull(relatedContent.supersededBy),
          eq(relatedContent.status, 'published'),
        ),
      );
    const deleted = await tx
      .delete(relatedContent)
      .where(lt(relatedContent.firstSeenAt, cutoff))
      .returning({ eventId: relatedContent.eventId });
    const removed = new Map<string, string[]>();
    for (const v of visible) removed.set(v.eventId, [...(removed.get(v.eventId) ?? []), v.externalId]);

    const channels = await tx
      .delete(youtubeChannel)
      .where(lt(youtubeChannel.fetchedAt, cutoff))
      .returning({ id: youtubeChannel.id });
    const blocks = await tx
      .delete(relatedPlaybackBlock)
      .where(lt(relatedPlaybackBlock.firstReportedAt, cutoff))
      .returning({ externalId: relatedPlaybackBlock.externalId });
    const reports = await tx
      .delete(relatedPlaybackReport)
      .where(lt(relatedPlaybackReport.firstReportedAt, cutoff))
      .returning({ externalId: relatedPlaybackReport.externalId });
    const ruleTitles = await tx
      .update(relatedChannelRule)
      .set({ channelTitle: null })
      .where(and(lt(relatedChannelRule.updatedAt, cutoff), isNotNull(relatedChannelRule.channelTitle)))
      .returning({ channelId: relatedChannelRule.channelId });

    // vídeo que saiu da lista de recusas e ainda está num jogo mais novo volta à vitrine dele (o canal no limiar
    // continua fora pela regra): o cache desse jogo também é purgado
    const unblocked = blocks.length
      ? await tx
          .selectDistinct({ eventId: relatedContent.eventId })
          .from(relatedContent)
          .where(
            and(
              inArray(
                relatedContent.externalId,
                blocks.map((b) => b.externalId),
              ),
              isNull(relatedContent.supersededBy),
              eq(relatedContent.status, 'published'),
            ),
          )
      : [];
    const events = [...new Set([...removed.keys(), ...unblocked.map((u) => u.eventId)])];
    for (const eventId of events)
      await publishChange(tx, {
        topic: RELATED_CONTENT_TOPIC,
        entityType: 'related_content',
        entityId: eventId,
        payload: {
          event_id: eventId,
          changed: ['related_content'],
          data: { added: [], removed: removed.get(eventId) ?? [], changed: [] },
          tags: [relatedContentTag(eventId), `event:${eventId}`],
        },
      });
    return {
      promoted,
      rows: deleted.length,
      events,
      channels: channels.length,
      blocks: blocks.length,
      reports: reports.length,
      ruleTitles: ruleTitles.length,
    };
  });
}

/**
 * Cota do YouTube já gasta no dia (ledger em enrich.related_run), nos dois baldes: consultas `search.list`
 * e unidades do balde geral (videos, channels, playlistItems).
 */
export async function quotaUsage(
  db: Pick<Database, 'execute'>,
  quotaDay: string,
): Promise<{ search: number; api: number }> {
  const rows = await db.execute<{ search: string | null; api: string | null }>(
    sql`select sum(searches)::text as search, sum(api_units)::text as api
          from enrich.related_run where quota_day = ${quotaDay}`,
  );
  return { search: Number(rows[0]?.search ?? 0), api: Number(rows[0]?.api ?? 0) };
}

/** Rótulo de `queries` dos vídeos achados num canal conhecido (`channel:club`, `channel:competition`…). */
export const CHANNEL_QUERY_PREFIX = 'channel:';

/**
 * Rendimento por competição desde `since` (prioridade e painel): jogos com busca completa, consultas, unidades
 * do balde geral e vídeos publicados (versão vigente) achados pela busca e pelos canais conhecidos.
 */
export async function competitionYields(
  db: Pick<Database, 'execute'>,
  since: Date,
): Promise<CompetitionYieldRow[]> {
  const rows = await db.execute<{
    competition_id: string;
    slug: string;
    games: number;
    searches: string;
    api_units: string;
    search_videos: number;
    channel_videos: number;
  }>(sql`
    with runs as (
      select e.competition_id, count(distinct r.event_id) filter (where r.mode = 'full')::int as games,
             sum(r.searches) as searches, sum(r.api_units) as api_units
        from enrich.related_run r join core.event e on e.id = r.event_id
       where r.started_at >= ${since.toISOString()}::timestamptz and e.competition_id is not null
       group by e.competition_id
    ), vids as (
      select e.competition_id,
             (count(*) filter (where exists (select 1 from unnest(rc.queries) q where q not like ${`${CHANNEL_QUERY_PREFIX}%`})))::int as search_videos,
             (count(*) filter (where exists (select 1 from unnest(rc.queries) q where q like ${`${CHANNEL_QUERY_PREFIX}%`})))::int as channel_videos
        from enrich.related_content rc join core.event e on e.id = rc.event_id
       where rc.superseded_by is null and rc.status = 'published'
         and rc.first_seen_at >= ${since.toISOString()}::timestamptz
       group by e.competition_id
    )
    select runs.competition_id::text, c.slug, runs.games, runs.searches::text, runs.api_units::text,
           coalesce(vids.search_videos, 0) as search_videos, coalesce(vids.channel_videos, 0) as channel_videos
      from runs join core.competition c on c.id = runs.competition_id
      left join vids on vids.competition_id = runs.competition_id
  `);
  return [...rows].map((r) => ({
    competitionId: r.competition_id,
    slug: r.slug,
    games: Number(r.games),
    searches: Number(r.searches ?? 0),
    apiUnits: Number(r.api_units ?? 0),
    searchVideos: Number(r.search_videos),
    channelVideos: Number(r.channel_videos),
  }));
}

/**
 * Grava o orçamento do dia de cota (painel de Operação). Os pulados por cota somam-se aos já gravados no dia
 * (um por jogo, o motivo mais recente; até 100).
 */
export async function saveRelatedBudget(
  db: Database,
  input: {
    quotaDay: string;
    searchLimit: number;
    searchUsed: number;
    searchReserved: number;
    apiLimit: number;
    apiUsed: number;
    skipped: RelatedSkippedGame[];
    upcoming: RelatedUpcomingGame[];
    now: Date;
  },
): Promise<void> {
  const [prev] = await db
    .select({ skipped: relatedBudget.skipped })
    .from(relatedBudget)
    .where(eq(relatedBudget.quotaDay, input.quotaDay));
  const merged = new Map<string, RelatedSkippedGame>();
  for (const s of [...(prev?.skipped ?? []), ...input.skipped]) merged.set(s.eventId, s);
  const skipped = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 100);
  const values = {
    quotaDay: input.quotaDay,
    searchLimit: input.searchLimit,
    searchUsed: input.searchUsed,
    searchReserved: input.searchReserved,
    apiLimit: input.apiLimit,
    apiUsed: input.apiUsed,
    skipped,
    upcoming: input.upcoming,
    updatedAt: input.now,
  };
  await db
    .insert(relatedBudget)
    .values(values)
    .onConflictDoUpdate({ target: relatedBudget.quotaDay, set: values });
}
