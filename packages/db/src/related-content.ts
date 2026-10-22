import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  relatedContent,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedStatus,
} from './schema/index.js';

/** Tópico do change feed / webhook do conteúdo relacionado (docs/12 §7). */
export const RELATED_CONTENT_TOPIC = 'event.related_content_changed';

/** Tag de purge das respostas de conteúdo relacionado de um evento. */
export const relatedContentTag = (eventId: string) => `related_content:${eventId}`;

export type RelatedContentRow = typeof relatedContent.$inferSelect;

export interface ReadRelatedOptions {
  types?: readonly RelatedContentType[];
  format?: RelatedFormat;
  /** Padrão: só `published` (o que a API mostra). */
  statuses?: readonly RelatedStatus[];
  limit?: number;
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
  const filters = [...base];
  if (options.types?.length) filters.push(inArray(relatedContent.contentType, [...options.types]));
  if (options.format) filters.push(eq(relatedContent.format, options.format));
  const rows = await db
    .select()
    .from(relatedContent)
    .where(and(...filters))
    .orderBy(desc(relatedContent.rankScore), desc(relatedContent.publishedAt), relatedContent.id)
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
