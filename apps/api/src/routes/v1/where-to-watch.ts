import type { FastifyInstance } from 'fastify';
import { WhereToWatchParams, WhereToWatchQuery, type WhereToWatch } from '@galaxie/contracts';
import { getPublicWhereToWatch, unknownMessage } from '@galaxie/where-to-watch';
import { assertMarket } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'where_to_watch' } as const;

/** Tag de purge da resposta (o change feed `where_to_watch.changed` purga `where_to_watch:<evento>`). */
export const wtwTag = (eventId: string) => `where_to_watch:${eventId}`;

/** GET /v1/events/{id}/where-to-watch?country=&region= (docs/05 §4). */
export async function whereToWatchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/events/:id/where-to-watch', { config: MODULE }, async (request, reply) => {
    const params = parseInput(WhereToWatchParams, request.params);
    const query = parseInput(WhereToWatchQuery, request.query);
    if (request.tenant) assertMarket(request.tenant, query.country);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.whereToWatch,
      vary: [locale, tz],
      load: async () => {
        const db = requireDb(ctx);
        const data = await getPublicWhereToWatch(db, {
          eventId: params.id,
          country: query.country,
          region: query.region ?? null,
        });
        if (!data) throw problems.notFound('Evento');
        const body: WhereToWatch = {
          event_id: data.eventId,
          country: data.country,
          status: data.status,
          message: data.status === 'unknown' ? unknownMessage(locale) : null,
          options: data.options.map(({ row, sources }) => ({
            id: row.id,
            provider: row.providerName,
            provider_id: row.broadcasterId,
            channel: row.channelName,
            medium: row.medium,
            access_model: row.accessModel,
            region: row.region,
            watch_url: row.url,
            confidence: Number(row.confidence),
            status: 'confirmed' as const,
            last_verified_at: formatInstant(row.lastVerifiedAt, tz),
            sources,
          })),
          updated_at: data.updatedAt ? formatInstant(data.updatedAt, tz) : null,
        };
        return { body, tags: [wtwTag(params.id), `event:${params.id}`] };
      },
    });
  });
}
