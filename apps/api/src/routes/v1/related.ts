import type { FastifyInstance } from 'fastify';
import {
  EventParams,
  RelatedPlaybackErrorBody,
  RelatedQuery,
  type RelatedContent,
  type RelatedPlaybackErrorResult,
  type RelatedContentTypeName,
  type RelatedItem,
  type SupportedLocale,
} from '@galaxie/contracts';
import {
  readRelatedContent,
  recordPlaybackBlock,
  relatedContentTag,
  type RelatedContentRow,
  type RelatedPlaybackBlockCode,
} from '@galaxie/db';
import { assertSport } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { eventHead } from '../../events/queries.js';
import { resolveMarket } from '../../events/relevance.js';
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

const PT_COUNTRIES = new Set(['BR', 'PT']);
const ES_COUNTRIES = new Set([
  'AR',
  'MX',
  'CO',
  'CL',
  'PE',
  'UY',
  'EC',
  'PY',
  'BO',
  'VE',
  'ES',
  'CR',
  'GT',
  'HN',
  'SV',
  'PA',
  'DO',
  'CU',
  'NI',
  'PR',
]);

/** Idioma dos vídeos para o público do país; null (sem filtro) fora dos países lusófonos e hispânicos. */
export function relatedLanguageOf(country: string): 'pt' | 'es' | null {
  const c = country.toUpperCase();
  return PT_COUNTRIES.has(c) ? 'pt' : ES_COUNTRIES.has(c) ? 'es' : null;
}

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
    aspect_ratio: row.aspectRatio,
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

/**
 * GET /v1/events/{id}/related?type=&format=&aspect_ratio=&limit= (docs/12 §7) e o aviso de vídeo recusado
 * pelo player (POST /v1/related/playback-errors) — módulo related_content.
 */
export async function relatedRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/events/:id/related', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(RelatedQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const tz = query.tz ?? 'UTC';
    // público: o país pedido ou o mercado único do plano; vídeos no idioma dele, os do próprio país primeiro
    const country = resolveMarket(request, query.country);
    const language = country ? relatedLanguageOf(country) : null;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.related,
      vary: [locale, tz, country ?? '*'],
      check: (meta) => {
        if (request.tenant && meta.sport) assertSport(request.tenant, meta.sport);
      },
      load: async () => {
        const db = requireDb(ctx);
        const head = await eventHead(db, params.id);
        const page = await readRelatedContent(db, head.id, {
          ...(query.type?.length ? { types: query.type } : {}),
          ...(query.format ? { format: query.format } : {}),
          ...(query.aspect_ratio?.length ? { aspectRatios: query.aspect_ratio } : {}),
          ...(language ? { language, region: country! } : {}),
          ...(country ? { country } : {}),
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

  // O player oficial recusou o vídeo (onError 100/101/150): sai da vitrine de todos, em todos os jogos, e o
  // agente deixa de gastar cota com ele (a recusa de embed é do vídeo e do canal, não do cliente).
  app.post('/v1/related/playback-errors', { config: MODULE }, async (request, reply) => {
    const t = request.tenant;
    if (!t) throw problems.invalidKey();
    if (t.keyKind !== 'secret') throw problems.publishableKeyNotAllowed();
    const body = parseInput(RelatedPlaybackErrorBody, request.body ?? {});
    const db = requireDb(ctx);
    // o change feed purga o cache dos jogos e avisa SSE/webhook
    const result = await db.transaction((tx) =>
      recordPlaybackBlock(tx, {
        itemId: body.item_id,
        code: body.code as RelatedPlaybackBlockCode,
        tenantId: t.tenantId,
      }),
    );
    if (!result) throw problems.notFound('Item do conteúdo relacionado');
    // jogos em que o vídeo relatado saiu agora (os outros, no limiar, são do resto do canal)
    const removedFrom = result.removals.filter((r) => r.removed.includes(result.externalId)).length;
    request.log.info(
      {
        tenant: t.slug,
        video: result.externalId,
        code: body.code,
        first: result.first,
        events: removedFrom,
      },
      'vídeo relacionado recusado pelo player',
    );
    reply.header('cache-control', 'no-store');
    const out: RelatedPlaybackErrorResult = {
      item_id: body.item_id,
      external_id: result.externalId,
      removed_from_events: removedFrom,
    };
    return out;
  });
}
