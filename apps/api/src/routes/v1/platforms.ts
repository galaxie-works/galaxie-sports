import type { FastifyInstance } from 'fastify';
import { LocaleQuery, PlatformParams, PlatformsQuery } from '@galaxie/contracts';
import { assertMarket } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { resolveLocale } from '../../i18n.js';
import { lineupDto, lineupTags, loadLogoBook, operatorVary, visibleTo } from '../../lineup/availability.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'where_to_watch' } as const;

/**
 * GET /v1/platforms?country= e /v1/platforms/{id}/lineup — operadoras e streamings da grade de canais e
 * ofertas, com o mesmo módulo e o mesmo piso editorial (LINEUP_MIN_REVIEW_STATUS) do onde assistir. O
 * tenant com operadora própria e `show_other_operators = false` vê só a dele e os streamings.
 */
export async function platformRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/platforms', { config: MODULE }, async (request, reply) => {
    const query = parseInput(PlatformsQuery, request.query);
    if (request.tenant && query.country) assertMarket(request.tenant, query.country);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    const db = requireDb(ctx);
    const operator = await ctx.lineup.operatorOf(db, request.tenant?.tenantId);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale, query.country ?? '', ...operatorVary(operator)],
      load: async () => {
        const rows = (
          await ctx.lineup.source.listPlatforms(db, {
            ...(query.country ? { country: query.country } : {}),
            minReview: ctx.lineup.minReview,
          })
        ).filter((p) => visibleTo(operator, p));
        const logos = await loadLogoBook(db, ctx.assetsBaseUrl, [], rows);
        return {
          body: { data: rows.map((p) => logos.platform(p)) },
          // a plataforma sem logo próprio mostra o da entrada dela na biblioteca
          tags: [...lineupTags(rows.map((p) => p.id)), 'broadcaster', 'asset'],
        };
      },
    });
  });

  app.get('/v1/platforms/:id/lineup', { config: MODULE }, async (request, reply) => {
    const params = parseInput(PlatformParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    const db = requireDb(ctx);
    const operator = await ctx.lineup.operatorOf(db, request.tenant?.tenantId);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale, ...operatorVary(operator)],
      // país da plataforma fora dos mercados do tenant: 403 também quando a resposta vem do cache
      check: (meta) => {
        if (request.tenant && meta.country) assertMarket(request.tenant, meta.country);
      },
      load: async () => {
        const row = await ctx.lineup.source.getPlatformLineup(db, params.id, {
          minReview: ctx.lineup.minReview,
        });
        // operadora concorrente escondida do tenant: o mesmo 404 de uma plataforma que não existe
        if (!row || !visibleTo(operator, row.platform)) throw problems.notFound('Plataforma');
        const ids = row.plans.flatMap((p) => [
          ...p.channels.map((c) => c.channelId),
          ...p.services.map((s) => s.serviceId),
        ]);
        const logos = await loadLogoBook(db, ctx.assetsBaseUrl, ids, [row.platform]);
        return {
          body: lineupDto(row, logos),
          tags: [...lineupTags([row.platform.id]), 'broadcaster', 'asset'],
          meta: { country: row.platform.country },
        };
      },
    });
  });
}
