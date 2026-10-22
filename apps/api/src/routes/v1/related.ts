import type { FastifyInstance } from 'fastify';
import {
  EventParams,
  RelatedQuery,
  type RelatedContent,
  type RelatedContentTypeName,
  type RelatedItem,
  type SupportedLocale,
} from '@galaxie/contracts';
import { readRelatedContent, relatedContentTag, type RelatedContentRow } from '@galaxie/db';
import { assertSport } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { eventHead } from '../../events/queries.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'related_content' } as const;

/** Rótulo do tipo de conteúdo por idioma (docs/12 §4.1). */
export const RELATED_TYPE_LABELS: Record<'pt' | 'es', Record<RelatedContentTypeName, string>> = {
  pt: {
    highlights: 'Melhores momentos',
    goal: 'Gol',
    penalties: 'Pênaltis',
    press_conference: 'Coletiva',
    interview: 'Entrevista',
    behind_the_scenes: 'Bastidores',
    fan_reaction: 'Reação da torcida',
    analysis: 'Análise',
    full_match: 'Jogo completo',
    other: 'Outros',
  },
  es: {
    highlights: 'Resumen',
    goal: 'Gol',
    penalties: 'Penales',
    press_conference: 'Conferencia de prensa',
    interview: 'Entrevista',
    behind_the_scenes: 'Detrás de cámaras',
    fan_reaction: 'Reacción de la hinchada',
    analysis: 'Análisis',
    full_match: 'Partido completo',
    other: 'Otros',
  },
};

export function relatedTypeLabel(type: RelatedContentTypeName, locale: SupportedLocale): string {
  return RELATED_TYPE_LABELS[locale.startsWith('pt') ? 'pt' : 'es'][type];
}

function toItem(row: RelatedContentRow, locale: SupportedLocale, tz: string): RelatedItem {
  return {
    id: row.id,
    provider: 'youtube',
    external_id: row.externalId,
    url: row.url,
    embed_url: row.embedUrl,
    title: row.title,
    content_type: row.contentType,
    content_type_label: relatedTypeLabel(row.contentType, locale),
    format: row.format,
    duration_seconds: row.durationSeconds,
    published_at: formatInstant(row.publishedAt, tz),
    thumbnail_url: row.thumbnailUrl,
    language: row.language,
    channel: {
      id: row.channelId,
      title: row.channelTitle,
      handle: row.channelHandle,
      source_tier: row.sourceTier,
    },
    views: row.statistics?.views ?? null,
    confidence: Number(row.confidence),
    classified_by: row.classifiedBy,
    last_checked_at: formatInstant(row.lastCheckedAt, tz),
  };
}

/** GET /v1/events/{id}/related?type=&format=&limit= (docs/12 §7) — módulo related_content. */
export async function relatedRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/events/:id/related', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(RelatedQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.related,
      vary: [locale, tz],
      check: (meta) => {
        if (request.tenant && meta.sport) assertSport(request.tenant, meta.sport);
      },
      load: async () => {
        const db = requireDb(ctx);
        const head = await eventHead(db, params.id);
        const page = await readRelatedContent(db, head.id, {
          ...(query.type?.length ? { types: query.type } : {}),
          ...(query.format ? { format: query.format } : {}),
          limit: query.limit,
        });
        const body: RelatedContent = {
          event_id: head.id,
          data: page.rows.map((r) => toItem(r, locale, tz)),
          counts: page.counts,
          updated_at: page.updatedAt ? formatInstant(page.updatedAt, tz) : null,
        };
        return {
          body,
          tags: [relatedContentTag(head.id), `event:${head.id}`],
          meta: { sport: head.sport },
        };
      },
    });
  });
}
