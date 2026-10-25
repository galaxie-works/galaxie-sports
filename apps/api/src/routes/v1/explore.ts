import type { FastifyInstance } from 'fastify';
import { ExploreAgendaQuery, ExploreSummaryQuery } from '@galaxie/contracts';
import { loadGeoConfig, type GeoConfig } from '@galaxie/geo';
import { sendCached } from '../../cache/http.js';
import type { AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { sportScope } from '../../events/queries.js';
import { resolveMarket } from '../../events/relevance.js';
import { loadExploreAgenda } from '../../explore/agenda.js';
import { loadExploreSummary } from '../../explore/summary.js';
import { parseInput } from '../../util.js';
import { buildCtx, localeOf } from './events.js';

const MODULE = { module: 'core_data' } as const;

/**
 * 60 s: os contadores de jogos e de ao vivo envelhecem no máximo um minuto. Sem a tag `event` de propósito:
 * cada placar purgaria o resumo inteiro, que é o mais caro de montar.
 */
export const EXPLORE_TTL = 60;

export interface ExploreRoutesOptions {
  /** Configuração geográfica (padrão: config/geo, carregada na primeira requisição). */
  geo?: GeoConfig;
}

/** Resumo da home "Explorar" (docs/05 §3.1.2) — módulo core_data. */
export async function exploreRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: ExploreRoutesOptions = {},
): Promise<void> {
  let geo = options.geo;
  const geoConfig = (): GeoConfig => {
    try {
      return (geo ??= loadGeoConfig());
    } catch (err) {
      app.log.error({ err }, 'config/geo inválida ou ausente');
      throw problems.degraded('Configuração geográfica (config/geo) indisponível.');
    }
  };

  app.get('/v1/explore/summary', { config: MODULE }, async (request, reply) => {
    const query = parseInput(ExploreSummaryQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const sports = sportScope(request);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: EXPLORE_TTL,
      vary: [locale, tz, ...(sports ?? [])],
      load: async () => {
        const body = await loadExploreSummary(
          buildCtx(ctx, locale, tz),
          geoConfig(),
          sports,
          ctx.assetsBaseUrl,
        );
        return { body, tags: ['sport', 'competition', 'country', 'asset'] };
      },
    });
  });

  // ─── /v1/explore/agenda ──────────────────────────────────────────────────────────────────────
  app.get('/v1/explore/agenda', { config: MODULE }, async (request, reply) => {
    const query = parseInput(ExploreAgendaQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    // o recorte do plano é o mesmo do resumo; o esporte pedido é só um filtro (e precisa estar no plano)
    const sports = sportScope(request);
    if (query.sport) sportScope(request, query.sport);
    const market = resolveMarket(request, query.market);
    const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: EXPLORE_TTL,
      vary: [locale, tz, `market:${market ?? ''}`, ...(sports ?? [])],
      load: async () => {
        const body = await loadExploreAgenda(buildCtx(ctx, locale, tz), {
          sports,
          filters: { sport: query.sport, country: query.country, competition: query.competition },
          countries: geoConfig().navigationCountries,
          market,
          day: query.day,
          limit: query.limit,
          offset,
        });
        return { body, tags: ['sport', 'competition', 'country'] };
      },
    });
  });
}
