import { and, eq, gte, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ChannelGuideParams, ChannelGuideQuery, type ChannelGuide } from '@galaxie/contracts';
import { broadcastOption, event, getWidget, matchChannel, type Database, type Widget } from '@galaxie/db';
import { assertMarket, assertSport } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import {
  guideChannelNames,
  guideChannelsByEvent,
  parseGuideChannels,
  parseGuideSports,
} from '../../channel-guide/grid.js';
import { channelListVary } from '../../channel-list/lists.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { buildEvents } from '../../events/builder.js';
import { civilDate, dayRange } from '../../time.js';
import { parseInput } from '../../util.js';
import { buildCtx, localeOf } from './events.js';

const MODULE = { module: 'where_to_watch' } as const;

/** Jogos por grade: um dia cheio de futebol e basquete cabe com folga. */
const MAX_ENTRIES = 300;

/** Widgets lidos do banco, memoizados (60 s, como a configuração pública `/e/<id>.json`). */
class WidgetMemo {
  private readonly memo = new Map<string, { value: Widget | null; expiresAt: number }>();
  constructor(private readonly now: () => number) {}

  async get(db: Database, id: string): Promise<Widget | null> {
    const hit = this.memo.get(id);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const value = await getWidget(db, id);
    if (this.memo.size > 10_000) this.memo.clear();
    this.memo.set(id, { value, expiresAt: this.now() + 60_000 });
    return value;
  }
}

/**
 * GET /v1/widgets/{id}/channel-guide (issue #834): a grade do dia nos canais do cliente, presa a um widget
 * "Grade nos canais" do próprio tenant. A lista de canais só é lida pela chave secreta (`/v1/channel-list`);
 * aqui sai só a grade pronta, com os canais que têm jogo no dia e, se o widget escolheu canais, só eles.
 */
export async function channelGuideRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const widgets = new WidgetMemo(() => ctx.now().getTime());

  app.get('/v1/widgets/:id/channel-guide', { config: MODULE }, async (request, reply) => {
    const params = parseInput(ChannelGuideParams, request.params);
    const query = parseInput(ChannelGuideQuery, request.query);
    const tenant = request.tenant;
    if (!tenant) throw problems.invalidKey();
    // chave publicável presa a outro widget: o widget não existe para ela
    if (tenant.widgetId && tenant.widgetId !== params.id) throw problems.notFound('Widget');
    const db = requireDb(ctx);
    const widget = await widgets.get(db, params.id);
    if (
      !widget ||
      widget.tenantId !== tenant.tenantId ||
      widget.archivedAt ||
      widget.kind !== 'channel_guide'
    )
      throw problems.notFound('Widget');

    const country = widget.config.market.toUpperCase();
    assertMarket(tenant, country);
    const options = widget.config.options ?? {};
    const requested = query.sport ? parseGuideSports(query.sport) : null;
    for (const s of requested ?? []) assertSport(tenant, s);
    // esportes: os pedidos, senão o salvo no widget (`defaults.sport`; nenhum = todos); sempre dentro do plano
    const chosen = requested ?? parseGuideSports(widget.config.defaults?.sport);
    const sports = tenant.sports.length
      ? (chosen ?? [...tenant.sports]).filter((s) => tenant.sports.includes(s)).sort()
      : chosen;
    const only = parseGuideChannels(options.channels);

    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const date = query.date ?? civilDate(ctx.now(), tz);
    const list = await ctx.channelLists.confirmedOf(db, tenant.tenantId);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.whereToWatch,
      vary: [
        locale,
        tz,
        date,
        `w:${widget.id}:${widget.version}`,
        `s:${(sports ?? []).join(',')}`,
        ...channelListVary(tenant.tenantId, list),
      ],
      load: async () => {
        const body: ChannelGuide = {
          widget_id: widget.id,
          date,
          country,
          status: list ? 'ok' : 'no_channel_list',
          channels: [],
          entries: [],
        };
        if (!list || (sports && !sports.length)) return { body, tags: ['broadcaster'] };
        const { start, end } = dayRange(date, tz);
        const window: SQL[] = [gte(event.startsAt, start), lt(event.startsAt, end)];
        if (sports) window.push(inArray(event.sport, sports));
        const [optionRows, matchRows] = await Promise.all([
          db
            .select({
              eventId: broadcastOption.eventId,
              broadcasterId: broadcastOption.broadcasterId,
              channelName: broadcastOption.channelName,
              region: broadcastOption.region,
              status: broadcastOption.status,
              producedBy: broadcastOption.producedBy,
            })
            .from(broadcastOption)
            .innerJoin(event, eq(event.id, broadcastOption.eventId))
            .where(
              and(eq(broadcastOption.countryCode, country), isNull(broadcastOption.supersededBy), ...window),
            ),
          db
            .select({
              eventId: matchChannel.eventId,
              broadcasterId: matchChannel.broadcasterId,
              channelName: matchChannel.channelName,
            })
            .from(matchChannel)
            .innerJoin(event, eq(event.id, matchChannel.eventId))
            .where(
              and(eq(matchChannel.countryCode, country), eq(matchChannel.status, 'confirmed'), ...window),
            ),
        ]);
        const byEvent = guideChannelsByEvent(country, optionRows, matchRows, list, only);
        const built = await buildEvents(buildCtx(ctx, locale, tz), [...byEvent.keys()]);
        const entries = built
          .map((b) => ({ event: b.dto, channels: byEvent.get(b.dto.id) ?? [] }))
          .sort(
            (a, b) =>
              a.event.starts_at.localeCompare(b.event.starts_at) || a.event.id.localeCompare(b.event.id),
          )
          .slice(0, MAX_ENTRIES);
        body.entries = entries;
        body.channels = guideChannelNames(new Map(entries.map((e) => [e.event.id, e.channels])));
        return {
          body,
          tags: ['event', 'broadcaster', ...entries.map((e) => `where_to_watch:${e.event.id}`)],
        };
      },
    });
  });
}
