import type { FastifyInstance } from 'fastify';
import { WhereToWatchParams, WhereToWatchQuery, type WhereToWatch } from '@galaxie/contracts';
import { getPublicWhereToWatch, matchChannelHeadline, unknownMessage } from '@galaxie/where-to-watch';
import { assertMarket } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { channelListVary } from '../../channel-list/lists.js';
import { buildAvailability, lineupTags, operatorVary } from '../../lineup/availability.js';
import { assetUrl, parseInput } from '../../util.js';

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
    // a operadora do tenant muda `availability` (a dele em `your_operator`; sem as concorrentes, se pedir)
    const operator = ctx.db ? await ctx.lineup.operatorOf(ctx.db, request.tenant?.tenantId) : null;
    // a lista de canais confirmada do tenant acrescenta `client_channels` (os canais dele com a emissora)
    const tenantId = request.tenant?.tenantId;
    const channels = ctx.db ? await ctx.channelLists.confirmedOf(ctx.db, tenantId) : null;
    const clientChannels = (broadcasterId: string | null, channel?: string | null) =>
      channels ? { client_channels: channels.forBroadcaster(query.country, broadcasterId, channel) } : {};
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.whereToWatch,
      vary: [locale, tz, ...operatorVary(operator), ...channelListVary(tenantId, channels)],
      load: async () => {
        const db = requireDb(ctx);
        const data = await getPublicWhereToWatch(
          db,
          { eventId: params.id, country: query.country, region: query.region ?? null },
          ctx.wtwConfig?.() ?? null,
        );
        if (!data) throw problems.notFound('Evento');
        const logo = (l: { storageKey: string | null; sourceUrl: string | null } | null) =>
          l ? assetUrl(ctx.assetsBaseUrl, l.storageKey, l.sourceUrl) : null;
        const logoDark = (l: { darkStorageKey: string | null } | null) =>
          l?.darkStorageKey ? assetUrl(ctx.assetsBaseUrl, l.darkStorageKey, null) : null;
        // canal do jogo por momento: "Passa em X", "Ao vivo em X", "Transmitido por X" ou o aviso
        const mc = data.matchChannel;
        const names = mc.channels.map((c) => c.option.row.channelName ?? c.option.row.providerName);
        const matchChannel = {
          phase: mc.phase,
          state: mc.state,
          ...matchChannelHeadline(mc.state, mc.phase, names, locale),
          channels: mc.channels.map((c) => ({
            id: c.option.row.broadcasterId ?? c.option.row.id,
            name: c.option.row.channelName ?? c.option.row.providerName,
            channel: c.option.row.channelName,
            medium: c.option.row.medium,
            logo: logo(c.option.logo),
            logo_dark: logoDark(c.option.logo),
            confirmed_at: formatInstant(c.confirmedAt, tz),
            post_match: c.postMatch,
            source: c.source,
          })),
        };
        const { availability, platformIds } = await buildAvailability({
          db,
          lineup: ctx.lineup,
          assetsBaseUrl: ctx.assetsBaseUrl,
          country: data.country,
          options: data.options,
          optionLogo: (o) => ({ logo: logo(o.logo), logo_dark: logoDark(o.logo) }),
          operator,
          matchChannel,
          // canal a confirmar: as plataformas dos detentores dos direitos no país
          toConfirm: [
            ...data.toConfirm.map(({ row, logo: l }) => ({
              broadcasterId: row.broadcasterId,
              name: row.channelName ?? row.providerName,
              medium: row.medium,
              logo: logo(l),
              logo_dark: logoDark(l),
            })),
            ...data.fromRights.map((r) => ({
              broadcasterId: r.broadcasterId,
              name: r.providerName,
              medium: r.medium,
              logo: logo(r.logo),
              logo_dark: logoDark(r.logo),
            })),
          ],
        });
        const body: WhereToWatch = {
          event_id: data.eventId,
          country: data.country,
          status: data.status,
          // escolha por rodada sem canal confirmado: "Canal deste jogo a confirmar", não "sem informações"
          message:
            data.status !== 'unknown'
              ? null
              : data.channelPerRound
                ? [matchChannel.headline, matchChannel.hint].filter(Boolean).join('. ')
                : unknownMessage(locale),
          options: data.options.map(({ row, sources, ...o }) => ({
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
            logo: logo(o.logo),
            logo_dark: logoDark(o.logo),
            ...clientChannels(row.broadcasterId, row.channelName),
          })),
          to_confirm: [
            ...data.toConfirm.map(({ row, sources, logo: l }) => ({
              provider: row.providerName,
              provider_id: row.broadcasterId,
              medium: row.medium,
              access_model: row.accessModel,
              logo: logo(l),
              logo_dark: logoDark(l),
              sources,
              ...clientChannels(row.broadcasterId, row.channelName),
            })),
            // país sem nenhuma opção gravada: os detentores da curadoria/pesquisa, "a confirmar"
            ...data.fromRights.map((r) => ({
              provider: r.providerName,
              provider_id: r.broadcasterId,
              medium: r.medium,
              access_model: r.accessModel,
              logo: logo(r.logo),
              logo_dark: logoDark(r.logo),
              sources: r.sources,
              ...clientChannels(r.broadcasterId),
            })),
          ],
          availability,
          updated_at: data.updatedAt ? formatInstant(data.updatedAt, tz) : null,
        };
        // `broadcaster`: logos de canais e streamings da biblioteca (um logo enviado no painel purga isto)
        return {
          body,
          tags: [wtwTag(params.id), `event:${params.id}`, ...lineupTags(platformIds), 'broadcaster'],
        };
      },
    });
  });
}
