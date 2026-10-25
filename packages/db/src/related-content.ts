import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  relatedChannelRule,
  relatedContent,
  relatedPlaybackBlock,
  type RelatedAspectRatio,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedPlaybackBlockCode,
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
