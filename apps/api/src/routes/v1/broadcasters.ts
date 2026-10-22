import type { FastifyInstance } from 'fastify';
import { BroadcasterParams, BroadcastersQuery, LocaleQuery, type Broadcaster } from '@galaxie/contracts';
import { listBroadcasters, type BroadcasterRow } from '@galaxie/where-to-watch';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { resolveLocale } from '../../i18n.js';
import { assetUrl, parseInput } from '../../util.js';

const MODULE = { module: 'where_to_watch' } as const;

/** Linha da biblioteca → contrato público (logo pelo nosso storage quando já espelhado). */
export function broadcasterDto(row: BroadcasterRow, assetsBaseUrl: string | undefined): Broadcaster {
  const url = assetUrl(assetsBaseUrl, row.logoStorageKey, row.logoSourceUrl);
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    kind: row.kind,
    countries: row.countries,
    channels: row.channels,
    website: row.website,
    logo:
      url && row.logoSourceUrl
        ? { url, source_url: row.logoSourceUrl, source_page: row.logoSourcePage, license: row.logoLicense }
        : null,
    markets: Object.entries(row.markets).map(([country, m]) => ({
      country,
      name: m.name,
      medium: m.medium,
      access_model: m.accessModel,
      channels: m.channels,
    })),
  };
}

/** GET /v1/broadcasters e /v1/broadcasters/{id} — biblioteca de emissoras do onde assistir. */
export async function broadcasterRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/broadcasters', { config: MODULE }, async (request, reply) => {
    const query = parseInput(BroadcastersQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale, query.country ?? ''],
      load: async () => {
        const rows = await listBroadcasters(requireDb(ctx), query.country ? { country: query.country } : {});
        return {
          body: { data: rows.map((r) => broadcasterDto(r, ctx.assetsBaseUrl)) },
          tags: ['broadcaster', 'asset'],
        };
      },
    });
  });

  app.get('/v1/broadcasters/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(BroadcasterParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const [row] = await listBroadcasters(requireDb(ctx), { ids: [params.id] });
        if (!row) throw problems.notFound('Emissora');
        return { body: broadcasterDto(row, ctx.assetsBaseUrl), tags: [`broadcaster:${row.id}`, 'asset'] };
      },
    });
  });
}
