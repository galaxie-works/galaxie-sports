/**
 * Persistência do Conteúdo relacionado em `enrich.related_content` (docs/12 §5.8–10): uma versão por
 * mudança material, `last_checked_at`/estatísticas renovados sem versão nova, vídeo fora do ar →
 * versão `retracted`, e expiração em 30 dias (política de dados da plataforma). Mudança visível →
 * `event.related_content_changed` no change feed (purge de cache, SSE, webhook).
 */
import { and, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  publishChange,
  RELATED_CONTENT_TOPIC,
  relatedContent,
  relatedContentTag,
  type Database,
  type RelatedContentRow,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedSourceTier,
  type RelatedStatistics,
  type RelatedStatus,
} from '@galaxie/db';

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
  durationSeconds: number | null;
  publishedAt: Date;
  thumbnailUrl: string | null;
  language: string | null;
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

/**
 * Expira o que não foi atualizado em `days` dias: título, trecho, miniatura e estatísticas apagados
 * em TODAS as versões (inclusive o histórico); a versão vigente vira `expired`. O id do vídeo e a
 * classificação ficam. Devolve os eventos afetados.
 */
export async function expireStaleRelated(
  db: Database,
  options: { now?: Date; days?: number } = {},
): Promise<{ events: string[]; rows: number }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.days ?? 30) * 86_400_000);
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({
        eventId: relatedContent.eventId,
        externalId: relatedContent.externalId,
        status: relatedContent.status,
      })
      .from(relatedContent)
      .where(
        and(
          isNull(relatedContent.supersededBy),
          lt(relatedContent.lastCheckedAt, cutoff),
          ne(relatedContent.status, 'expired'),
        ),
      );
    if (!stale.length) return { events: [], rows: 0 };
    let rows = 0;
    const byEvent = new Map<string, { ids: string[]; visible: boolean }>();
    for (const s of stale) {
      const e = byEvent.get(s.eventId) ?? { ids: [], visible: false };
      e.ids.push(s.externalId);
      e.visible ||= s.status === 'published';
      byEvent.set(s.eventId, e);
    }
    for (const [eventId, { ids, visible }] of byEvent) {
      const cleared = await tx
        .update(relatedContent)
        .set({ title: '', descriptionExcerpt: null, thumbnailUrl: null, statistics: null })
        .where(and(eq(relatedContent.eventId, eventId), inArray(relatedContent.externalId, ids)))
        .returning({ id: relatedContent.id });
      rows += cleared.length;
      await tx
        .update(relatedContent)
        .set({ status: 'expired' })
        .where(
          and(
            eq(relatedContent.eventId, eventId),
            inArray(relatedContent.externalId, ids),
            isNull(relatedContent.supersededBy),
          ),
        );
      if (visible)
        await publishChange(tx, {
          topic: RELATED_CONTENT_TOPIC,
          entityType: 'related_content',
          entityId: eventId,
          payload: {
            event_id: eventId,
            changed: ['related_content'],
            data: { added: [], removed: ids, changed: [] },
            tags: [relatedContentTag(eventId), `event:${eventId}`],
          },
        });
    }
    return { events: [...byEvent.keys()], rows };
  });
}

/** Unidades da cota do YouTube já gastas no dia (ledger em enrich.related_run). */
export async function quotaUnitsUsed(db: Pick<Database, 'execute'>, quotaDay: string): Promise<number> {
  const rows = await db.execute<{ total: string | null }>(
    sql`select sum(quota_units)::text as total from enrich.related_run where quota_day = ${quotaDay}`,
  );
  return Number(rows[0]?.total ?? 0);
}
