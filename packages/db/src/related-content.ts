import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { publishChange } from './change-feed.js';
import type { Database } from './client.js';
import {
  relatedChannelRule,
  relatedContent,
  relatedPlaybackBlock,
  type RelatedAspectRatio,
  type RelatedChannelRuleMode,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedPlaybackBlockCode,
  type RelatedSourceTier,
  type RelatedStatus,
} from './schema/index.js';

/** Tópico do change feed / webhook do conteúdo relacionado (docs/12 §7). */
export const RELATED_CONTENT_TOPIC = 'event.related_content_changed';

/**
 * Canal com este número de vídeos recusados pelo player sai inteiro da vitrine e da pesquisa (ex.: o
 * detentor de direitos que bloqueia o embed de tudo o que tem imagem do jogo).
 */
export const RELATED_CHANNEL_BLOCK_THRESHOLD = 3;

/** Tag de purge das respostas de conteúdo relacionado de um evento. */
export const relatedContentTag = (eventId: string) => `related_content:${eventId}`;

export type RelatedContentRow = typeof relatedContent.$inferSelect;

export interface ReadRelatedOptions {
  types?: readonly RelatedContentType[];
  format?: RelatedFormat;
  /** Proporções do quadro aceitas (ex.: só `9:16`, ou `16:9` e `9:16`). */
  aspectRatios?: readonly RelatedAspectRatio[];
  /** Padrão: só `published` (o que a API mostra). */
  statuses?: readonly RelatedStatus[];
  limit?: number;
  /**
   * Localização: só vídeos deste idioma (`pt`, `es`), com os do país `region` primeiro (es-AR antes de
   * es-MX). Vídeo sem idioma conhecido fica de fora — melhor nada do que o vídeo do país errado.
   */
  language?: string;
  region?: string;
  /** País do público: tira os vídeos que o YouTube não toca nele (`regionRestriction`). */
  country?: string;
}

export interface RelatedContentPage {
  rows: RelatedContentRow[];
  /** Total publicado por tipo, antes dos filtros de tipo/formato (para as abas da vitrine). */
  counts: Partial<Record<RelatedContentType, number>>;
  /** Última verificação entre as linhas vigentes publicadas. */
  updatedAt: Date | null;
}

/**
 * Versões vigentes do conteúdo relacionado de um evento, ordenadas por `rank_score` (desempate por
 * data e id). Leitura compartilhada pelo agente e pela rota `GET /v1/events/{id}/related`.
 */
export async function readRelatedContent(
  db: Pick<Database, 'select'>,
  eventId: string,
  options: ReadRelatedOptions = {},
): Promise<RelatedContentPage> {
  const statuses = options.statuses ?? ['published'];
  const base = [
    eq(relatedContent.eventId, eventId),
    isNull(relatedContent.supersededBy),
    inArray(relatedContent.status, [...statuses]),
  ];
  // fora da vitrine: o vídeo que o player oficial recusou (lista de bloqueios, em qualquer jogo)
  base.push(
    sql`not exists (select 1 from ${relatedPlaybackBlock} b where b.provider = ${relatedContent.provider} and b.external_id = ${relatedContent.externalId})`,
    // o canal bloqueado no painel, ou o que já acumulou recusas (todos os formatos) sem ter sido liberado
    sql`coalesce(
      (select r.mode = 'allow' from ${relatedChannelRule} r where r.provider = ${relatedContent.provider} and r.channel_id = ${relatedContent.channelId}),
      (select count(*) from ${relatedPlaybackBlock} b where b.provider = ${relatedContent.provider} and b.channel_id = ${relatedContent.channelId}) < ${RELATED_CHANNEL_BLOCK_THRESHOLD}
    )`,
  );
  if (options.country) {
    const c = options.country.toUpperCase();
    base.push(
      sql`(${relatedContent.regionAllowed} is null or ${c} = any(${relatedContent.regionAllowed}))`,
      sql`not (${c} = any(${relatedContent.regionBlocked}))`,
    );
  }
  if (options.language) {
    const lang = options.language.slice(0, 2).toLowerCase();
    base.push(sql`split_part(${relatedContent.language}, '-', 1) = ${lang}`);
  }
  const filters = [...base];
  if (options.types?.length) filters.push(inArray(relatedContent.contentType, [...options.types]));
  if (options.format) filters.push(eq(relatedContent.format, options.format));
  if (options.aspectRatios?.length)
    filters.push(inArray(relatedContent.aspectRatio, [...options.aspectRatios]));
  const region = options.language && options.region ? options.region.toUpperCase() : null;
  const rows = await db
    .select()
    .from(relatedContent)
    .where(and(...filters))
    .orderBy(
      ...(region ? [sql`(split_part(${relatedContent.language}, '-', 2) = ${region}) desc`] : []),
      desc(relatedContent.rankScore),
      desc(relatedContent.publishedAt),
      relatedContent.id,
    )
    .limit(options.limit ?? 50);
  const agg = await db
    .select({
      type: relatedContent.contentType,
      n: sql<number>`count(*)::int`,
      checked: sql<Date | null>`max(${relatedContent.lastCheckedAt})`,
    })
    .from(relatedContent)
    .where(and(...base))
    .groupBy(relatedContent.contentType);
  const counts: Partial<Record<RelatedContentType, number>> = {};
  let updatedAt: Date | null = null;
  for (const a of agg) {
    counts[a.type] = Number(a.n);
    const checked = a.checked ? new Date(a.checked) : null;
    if (checked && (!updatedAt || checked > updatedAt)) updatedAt = checked;
  }
  return { rows, counts, updatedAt };
}

export interface PlaybackBlockInput {
  /** Linha do conteúdo relacionado que o player recusou (`RelatedItem.id`). */
  itemId: string;
  code: RelatedPlaybackBlockCode;
  tenantId?: string | null;
  now?: Date;
}

export interface PlaybackBlockResult {
  externalId: string;
  /** Jogos com o vídeo na vitrine: o cache de cada um precisa ser purgado. */
  eventIds: string[];
  /** Primeiro relato deste vídeo (antes só somava `reports`). */
  first: boolean;
}

/**
 * Registra o vídeo que o player oficial recusou (erro 100, 101 ou 150) e devolve os jogos em que ele
 * aparece. null quando o item não existe.
 */
export async function recordPlaybackBlock(
  db: Pick<Database, 'select' | 'selectDistinct' | 'insert'>,
  input: PlaybackBlockInput,
): Promise<PlaybackBlockResult | null> {
  const [row] = await db
    .select({
      provider: relatedContent.provider,
      externalId: relatedContent.externalId,
      channelId: relatedContent.channelId,
      format: relatedContent.format,
      contentType: relatedContent.contentType,
    })
    .from(relatedContent)
    .where(eq(relatedContent.id, input.itemId))
    .limit(1);
  if (!row) return null;
  const now = input.now ?? new Date();
  const [saved] = await db
    .insert(relatedPlaybackBlock)
    .values({
      ...row,
      code: input.code,
      tenantId: input.tenantId ?? null,
      firstReportedAt: now,
      lastReportedAt: now,
    })
    .onConflictDoUpdate({
      target: [relatedPlaybackBlock.provider, relatedPlaybackBlock.externalId],
      set: {
        code: input.code,
        reports: sql`${relatedPlaybackBlock.reports} + 1`,
        lastReportedAt: now,
      },
    })
    .returning({ reports: relatedPlaybackBlock.reports });
  const events = await db
    .selectDistinct({ eventId: relatedContent.eventId })
    .from(relatedContent)
    .where(
      and(
        eq(relatedContent.provider, row.provider),
        eq(relatedContent.externalId, row.externalId),
        isNull(relatedContent.supersededBy),
        eq(relatedContent.status, 'published'),
      ),
    );
  return { externalId: row.externalId, eventIds: events.map((e) => e.eventId), first: saved?.reports === 1 };
}

/** Bloqueios por canal e formato (o vídeo recusado e quantos do mesmo canal e formato já foram). */
export interface PlaybackBlockIndex {
  videos: Set<string>;
  /** Canais fora da pesquisa: bloqueados no painel, ou com `RELATED_CHANNEL_BLOCK_THRESHOLD` recusas e não liberados. */
  channels: Set<string>;
  /** `${channelId}|${format}` → vídeos bloqueados. */
  byChannelFormat: Map<string, number>;
}

export async function readPlaybackBlocks(
  db: Pick<Database, 'select'>,
  provider = 'youtube',
): Promise<PlaybackBlockIndex> {
  const rows = await db
    .select({
      externalId: relatedPlaybackBlock.externalId,
      channelId: relatedPlaybackBlock.channelId,
      format: relatedPlaybackBlock.format,
    })
    .from(relatedPlaybackBlock)
    .where(eq(relatedPlaybackBlock.provider, provider));
  const rules = await db
    .select({ channelId: relatedChannelRule.channelId, mode: relatedChannelRule.mode })
    .from(relatedChannelRule)
    .where(eq(relatedChannelRule.provider, provider));
  const allowed = new Set(rules.filter((r) => r.mode === 'allow').map((r) => r.channelId));
  const index: PlaybackBlockIndex = { videos: new Set(), channels: new Set(), byChannelFormat: new Map() };
  const perChannel = new Map<string, number>();
  for (const r of rows) {
    index.videos.add(r.externalId);
    if (r.channelId) {
      const n = (perChannel.get(r.channelId) ?? 0) + 1;
      perChannel.set(r.channelId, n);
      if (n >= RELATED_CHANNEL_BLOCK_THRESHOLD && !allowed.has(r.channelId)) index.channels.add(r.channelId);
    }
    if (!r.channelId || !r.format) continue;
    const key = `${r.channelId}|${r.format}`;
    index.byChannelFormat.set(key, (index.byChannelFormat.get(key) ?? 0) + 1);
  }
  for (const r of rules) if (r.mode === 'block') index.channels.add(r.channelId);
  return index;
}

// ─── controle por canal (Ajustes → Vídeos relacionados) ─────────────────────────────────────────

export interface RelatedChannelSummary {
  channelId: string;
  title: string;
  handle: string | null;
  sourceTier: RelatedSourceTier | null;
  /** Vídeos publicados (versão vigente) do canal, em todos os jogos. */
  published: number;
  /** Vídeos do canal que o player recusou. */
  refused: number;
  lastRefusedAt: Date | null;
  rule: RelatedChannelRuleMode | null;
  ruleBy: string | null;
  ruleAt: Date | null;
  note: string | null;
  /** Fora dos relacionados agora: regra `block`, ou as recusas do automático sem `allow`. */
  blocked: boolean;
}

export interface ListRelatedChannelsOptions {
  provider?: string;
  /** Busca no nome ou no @ do canal. */
  q?: string;
  /** `blocked` = fora dos relacionados; `refused` = com recusas do player. */
  only?: 'blocked' | 'refused';
  limit?: number;
}

/**
 * Canais dos vídeos relacionados com as recusas do player e a regra manual: os bloqueados e os com
 * recusas primeiro, depois os com mais vídeos na vitrine.
 */
export async function listRelatedChannels(
  db: Pick<Database, 'execute'>,
  options: ListRelatedChannelsOptions = {},
): Promise<RelatedChannelSummary[]> {
  const provider = options.provider ?? 'youtube';
  const q = options.q?.trim() ? `%${options.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db.execute<{
    channel_id: string;
    title: string | null;
    handle: string | null;
    source_tier: RelatedSourceTier | null;
    published: number;
    refused: number;
    last_refused_at: string | null;
    rule: RelatedChannelRuleMode | null;
    rule_by: string | null;
    rule_at: string | null;
    note: string | null;
  }>(sql`
    with vids as (
      select channel_id, max(channel_title) as title, max(channel_handle) as handle,
             max(source_tier) as source_tier,
             count(*) filter (where status = 'published')::int as published
      from ${relatedContent}
      where provider = ${provider} and superseded_by is null
      group by channel_id
    ), blk as (
      select channel_id, count(*)::int as refused, max(last_reported_at) as last_refused_at
      from ${relatedPlaybackBlock}
      where provider = ${provider} and channel_id is not null
      group by channel_id
    ), rules as (
      select channel_id, mode, channel_title, note, updated_by, updated_at
      from ${relatedChannelRule}
      where provider = ${provider}
    ), ids as (
      select channel_id from vids union select channel_id from blk union select channel_id from rules
    )
    select ids.channel_id, coalesce(vids.title, rules.channel_title) as title, vids.handle, vids.source_tier,
           coalesce(vids.published, 0) as published, coalesce(blk.refused, 0) as refused,
           blk.last_refused_at, rules.mode as rule, rules.updated_by as rule_by, rules.updated_at as rule_at,
           rules.note
    from ids
    left join vids on vids.channel_id = ids.channel_id
    left join blk on blk.channel_id = ids.channel_id
    left join rules on rules.channel_id = ids.channel_id
    where (${q}::text is null or coalesce(vids.title, rules.channel_title, '') ilike ${q} or coalesce(vids.handle, '') ilike ${q})
  `);
  const out = [...rows].map((r) => {
    const refused = Number(r.refused);
    const blocked = r.rule === 'block' || (r.rule !== 'allow' && refused >= RELATED_CHANNEL_BLOCK_THRESHOLD);
    return {
      channelId: r.channel_id,
      title: r.title ?? r.channel_id,
      handle: r.handle,
      sourceTier: r.source_tier,
      published: Number(r.published),
      refused,
      lastRefusedAt: r.last_refused_at ? new Date(r.last_refused_at) : null,
      rule: r.rule,
      ruleBy: r.rule_by,
      ruleAt: r.rule_at ? new Date(r.rule_at) : null,
      note: r.note,
      blocked,
    } satisfies RelatedChannelSummary;
  });
  return out
    .filter((c) =>
      options.only === 'blocked' ? c.blocked : options.only === 'refused' ? c.refused > 0 : true,
    )
    .sort(
      (a, b) =>
        Number(b.blocked) - Number(a.blocked) ||
        b.refused - a.refused ||
        b.published - a.published ||
        a.title.localeCompare(b.title),
    )
    .slice(0, options.limit ?? 200);
}

/** Avisa os jogos com vídeo do canal (purga do cache da API, SSE e webhook). */
async function announceChannel(
  tx: Pick<Database, 'selectDistinct' | 'execute'>,
  provider: string,
  channelId: string,
) {
  const events = await tx
    .selectDistinct({ eventId: relatedContent.eventId })
    .from(relatedContent)
    .where(
      and(
        eq(relatedContent.provider, provider),
        eq(relatedContent.channelId, channelId),
        isNull(relatedContent.supersededBy),
        eq(relatedContent.status, 'published'),
      ),
    );
  for (const { eventId } of events)
    await publishChange(tx, {
      topic: RELATED_CONTENT_TOPIC,
      entityType: 'related_content',
      entityId: eventId,
      payload: {
        event_id: eventId,
        changed: ['related_content'],
        tags: [relatedContentTag(eventId), `event:${eventId}`],
      },
    });
  return events.length;
}

export interface SetRelatedChannelRuleInput {
  provider?: string;
  channelId: string;
  /** null = volta ao automático (apaga a regra). */
  mode: RelatedChannelRuleMode | null;
  channelTitle?: string | null;
  note?: string | null;
  by: string;
}

/** Grava (ou apaga) a regra manual do canal e devolve quantos jogos foram avisados. */
export async function setRelatedChannelRule(
  db: Database,
  input: SetRelatedChannelRuleInput,
): Promise<number> {
  const provider = input.provider ?? 'youtube';
  return db.transaction(async (tx) => {
    const key = and(
      eq(relatedChannelRule.provider, provider),
      eq(relatedChannelRule.channelId, input.channelId),
    );
    if (input.mode === null) await tx.delete(relatedChannelRule).where(key);
    else
      await tx
        .insert(relatedChannelRule)
        .values({
          provider,
          channelId: input.channelId,
          mode: input.mode,
          channelTitle: input.channelTitle ?? null,
          note: input.note ?? null,
          updatedBy: input.by,
        })
        .onConflictDoUpdate({
          target: [relatedChannelRule.provider, relatedChannelRule.channelId],
          set: {
            mode: input.mode,
            note: input.note ?? null,
            updatedBy: input.by,
            updatedAt: new Date(),
            ...(input.channelTitle ? { channelTitle: input.channelTitle } : {}),
          },
        });
    return announceChannel(tx, provider, input.channelId);
  });
}

/**
 * Apaga as recusas do player do canal (ex.: o detentor liberou o embed): os vídeos voltam à vitrine e o
 * automático recomeça a contar. Devolve quantas recusas saíram.
 */
export async function clearRelatedChannelRefusals(
  db: Database,
  input: { provider?: string; channelId: string },
): Promise<number> {
  const provider = input.provider ?? 'youtube';
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(relatedPlaybackBlock)
      .where(
        and(eq(relatedPlaybackBlock.provider, provider), eq(relatedPlaybackBlock.channelId, input.channelId)),
      )
      .returning({ id: relatedPlaybackBlock.externalId });
    await announceChannel(tx, provider, input.channelId);
    return removed.length;
  });
}
