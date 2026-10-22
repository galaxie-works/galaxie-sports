import type { FastifyInstance } from 'fastify';
import { ExploreSummaryQuery } from '@galaxie/contracts';
import { loadGeoConfig, type GeoConfig } from '@galaxie/geo';
import { sendCached } from '../../cache/http.js';
import type { AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { sportScope } from '../../events/queries.js';
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
}
