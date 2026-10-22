import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { teamColors } from '../../teams/colors.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  EventParams,
  EventQuery,
  EventsQuery,
  H2hQuery,
  LiveEventsQuery,
  LocaleQuery,
  type HeadToHead,
  type SupportedLocale,
} from '@galaxie/contracts';
import { asset, event, eventParticipant, participant, venue, venueDisplay } from '@galaxie/db';
import { assertSport } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { buildEvents, eventsTtl, type BuildContext } from '../../events/builder.js';
import { buildLineups, buildStats, buildTimeline } from '../../events/detail.js';
import { buildIcs } from '../../events/ics.js';
import { applyRelevance, relevanceSql, resolveMarket } from '../../events/relevance.js';
import { eventContextSummary } from './event-context.js';
import {
  assertWindow,
  eventHead,
  filterConds,
  IN_PLAY,
  actuallyLiveCond,
  pageEventIds,
  sportScope,
  type EventFilters,
  type EventOrder,
} from '../../events/queries.js';
import { resolveLocale } from '../../i18n.js';
import { scheduleWindow } from '../../time.js';
import { assetUrl, parseInput } from '../../util.js';

const MODULE = { module: 'core_data' } as const;

export function localeOf(request: FastifyRequest, query: { locale?: SupportedLocale | undefined }) {
  return resolveLocale(query.locale, request.headers['accept-language']);
}

/** Garante que o esporte do recurso (guardado nos metadados do cache) está no plano do tenant. */
export function sportCheck(request: FastifyRequest) {
  return (meta: Record<string, string>) => {
    if (request.tenant && meta.sport) assertSport(request.tenant, meta.sport);
  };
}

export function buildCtx(ctx: AppContext, locale: SupportedLocale, tz: string): BuildContext {
  return {
    db: requireDb(ctx),
    locale,
    tz,
    now: ctx.now(),
    assetsBaseUrl: ctx.assetsBaseUrl,
    rules: ctx.rules,
  };
}

/**
 * Lista paginada de eventos (agenda): usada por /v1/events e /v1/teams/{id}/events. Com `market`, preenche
 * `relevance` e habilita `relevance_min` / `order=relevance`.
 */
export async function eventPage(
  bctx: BuildContext,
  filters: EventFilters,
  options: { order: EventOrder; limit: number; cursor?: string | undefined },
  market: string | null = null,
) {
  const { ids, nextCursor } = await pageEventIds(
    bctx.db,
    market ? { ...filters, relevance: relevanceSql(market) } : filters,
    options,
  );
  const data = (await buildEvents(bctx, ids)).map((b) => b.dto);
  await applyRelevance(bctx.db, data, market);
  return {
    body: { data, next_cursor: nextCursor },
    tags: ['event', ...data.map((e) => `event:${e.id}`)],
    ttl: Math.min(CACHE_TTL.schedule, eventsTtl(data, bctx.now, CACHE_TTL.schedule)),
  };
}

/** Rotas de eventos (docs/05 §3.2). Todas exigem o módulo core_data. */
export async function eventRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ─── /v1/events ──────────────────────────────────────────────────────────────────────────────
  app.get('/v1/events', { config: MODULE }, async (request, reply) => {
    const query = parseInput(EventsQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const sports = sportScope(request, query.sport);
    const market = resolveMarket(request, query.market);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz, `market:${market ?? ''}`, ...(sports ?? [])],
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const win = scheduleWindow(query, tz, bctx.now);
        assertWindow(win.start, win.end);
        return eventPage(
          bctx,
          {
            start: win.start,
            end: win.end,
            sport: query.sport,
            sports,
            competition: query.competition,
            team: query.team,
            country: query.country,
            status: query.status,
            importanceMin: query.importance_min,
            relevanceMin: query.relevance_min,
          },
          { order: query.order, limit: query.limit, cursor: query.cursor },
          market,
        );
      },
    });
  });

  // ─── /v1/events/live ─────────────────────────────────────────────────────────────────────────
  app.get('/v1/events/live', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LiveEventsQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const sports = sportScope(request, query.sport);
    const market = resolveMarket(request, query.market);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.live,
      vary: [locale, tz, `market:${market ?? ''}`, ...(sports ?? [])],
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const rows = await bctx.db
          .select({ id: event.id })
          .from(event)
          .where(
            and(
              ...filterConds({
                sport: query.sport,
                sports,
                competition: query.competition,
                status: IN_PLAY,
              }),
              actuallyLiveCond(bctx.now),
            ),
          )
          .orderBy(desc(event.importance), asc(event.startsAt), asc(event.id))
          .limit(500);
        const data = (
          await buildEvents(
            bctx,
            rows.map((r) => r.id),
          )
        ).map((b) => b.dto);
        await applyRelevance(bctx.db, data, market);
        return { body: { data }, tags: ['event', ...data.map((e) => `event:${e.id}`)] };
      },
    });
  });

  // ─── /v1/events/:id e /v1/events/:id.ics ─────────────────────────────────────────────────────
  app.get('/v1/events/:id', { config: MODULE }, async (request, reply) => {
    const raw = (request.params as { id?: string }).id ?? '';
    const ics = raw.toLowerCase().endsWith('.ics');
    const params = parseInput(EventParams, { id: ics ? raw.slice(0, -4) : raw });
    const query = parseInput(EventQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const market = ics ? null : resolveMarket(request, query.market);
    // resumo do cenário/resumo de IA só para quem contratou live_intelligence (a resposta varia por isso)
    const withContext = !ics && !!request.tenant?.modules.includes('live_intelligence');
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: ics ? CACHE_TTL.schedule : CACHE_TTL.standings,
      vary: [
        locale,
        ics ? 'ics' : tz,
        ...(market ? [`market:${market}`] : []),
        ...(withContext ? ['context'] : []),
      ],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const [built] = await buildEvents(bctx, [params.id]);
        if (!built) throw problems.notFound('Evento');
        const e = built.dto;
        await applyRelevance(bctx.db, [e], market);
        const tags = [`event:${e.id}`, ...(e.competition ? [`competition:${e.competition.id}`] : [])];
        if (!ics) {
          if (withContext) {
            e.context = await eventContextSummary(bctx.db, e.id, locale, tz);
            tags.push(`event_context:${e.id}`);
          }
          return {
            body: e,
            tags,
            ttl: eventsTtl([e], bctx.now, CACHE_TTL.standings),
            meta: { sport: e.sport },
          };
        }
        const head = await eventHead(bctx.db, e.id);
        const [v] = e.venue
          ? await bctx.db
              .select({ name: venue.name, city: venue.city, curated: venue.curated })
              .from(venue)
              .where(eq(venue.id, e.venue.id))
          : [];
        const names = e.participants.map((p) => p.name);
        const title = names.length === 2 ? `${names[0]} × ${names[1]}` : (e.competition?.name ?? e.sport);
        const body = buildIcs(
          [
            {
              uid: `${e.id}@galaxie.sports`,
              start: head.startsAt,
              end: head.endsAtExpected,
              summary: e.competition && names.length === 2 ? `${title} · ${e.competition.name}` : title,
              description:
                [e.competition?.name, e.stage?.name, e.derby?.name].filter(Boolean).join(' · ') || null,
              location: v ? Object.values(venueDisplay(v)).filter(Boolean).join(', ') : null,
              status:
                e.status === 'cancelled' || e.status === 'abandoned'
                  ? 'CANCELLED'
                  : e.status === 'postponed'
                    ? 'TENTATIVE'
                    : 'CONFIRMED',
              updatedAt: head.updatedAt,
              categories: [e.sport],
            },
          ],
          { now: head.updatedAt },
        );
        return {
          body,
          tags,
          contentType: 'text/calendar; charset=utf-8',
          headers: { 'content-disposition': `attachment; filename="${e.id}.ics"` },
          meta: { sport: e.sport },
        };
      },
    });
  });

  // ─── /v1/events/:id/timeline · lineups · stats ───────────────────────────────────────────────
  const detailRoute = (
    path: string,
    build: (ev: { id: string; sport: string }) => Promise<unknown>,
    liveTtl: number,
  ) =>
    app.get(path, { config: MODULE }, async (request, reply) => {
      const params = parseInput(EventParams, request.params);
      const query = parseInput(LocaleQuery, request.query);
      const locale = localeOf(request, query);
      reply.header('content-language', locale);
      return sendCached(request, reply, ctx.cache, {
        ttl: CACHE_TTL.standings,
        vary: [locale],
        check: sportCheck(request),
        load: async () => {
          const db = requireDb(ctx);
          const head = await eventHead(db, params.id);
          const live = IN_PLAY.includes(head.status) || head.status === 'starting';
          return {
            body: await build(head),
            tags: [`event:${head.id}`],
            ttl: live ? liveTtl : head.status === 'finished' ? CACHE_TTL.standings : CACHE_TTL.schedule,
            meta: { sport: head.sport },
          };
        },
      });
    });

  detailRoute(
    '/v1/events/:id/timeline',
    (ev) => buildTimeline(requireDb(ctx), ev, ctx.assetsBaseUrl, ctx.now()),
    CACHE_TTL.live,
  );
  detailRoute('/v1/events/:id/lineups', (ev) => buildLineups(requireDb(ctx), ev, ctx.assetsBaseUrl), 60);
  detailRoute('/v1/events/:id/stats', (ev) => buildStats(requireDb(ctx), ev, ctx.assetsBaseUrl), 30);

  // ─── /v1/events/:id/h2h ──────────────────────────────────────────────────────────────────────
  app.get('/v1/events/:id/h2h', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(H2hQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const db = bctx.db;
        const head = await eventHead(db, params.id);
        const parts = await db
          .select({
            id: participant.id,
            name: participant.name,
            side: eventParticipant.side,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
            logoPalette: asset.palette,
          })
          .from(eventParticipant)
          .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
          .leftJoin(asset, eq(asset.id, participant.logoAssetId))
          .where(eq(eventParticipant.eventId, head.id))
          .orderBy(sql`case ${eventParticipant.side} when 'home' then 0 when 'away' then 1 else 2 end`);
        const body: HeadToHead = {
          event_id: head.id,
          participants: parts.map((p) => ({
            id: p.id,
            name: p.name,
            logo: assetUrl(ctx.assetsBaseUrl, p.logoKey, p.logoUrl),
            colors: teamColors(p.logoPalette),
          })),
          summary: { played: 0, draws: 0, teams: parts.map((p) => ({ id: p.id, wins: 0, goals: 0 })) },
          events: [],
        };
        if (parts.length === 2) {
          const [a, b] = [parts[0]!.id, parts[1]!.id];
          const history = await db
            .select({
              id: event.id,
              score: event.score,
              participantId: eventParticipant.participantId,
              side: eventParticipant.side,
            })
            .from(event)
            .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
            .where(
              and(
                eq(event.status, 'finished'),
                // o jogo da página entra quando já terminou (senão a barra contradiz o próprio placar);
                // antes disso o confronto direto é só o histórico anterior
                ...(head.status === 'finished' ? [] : [ne(event.id, head.id)]),
                inArray(eventParticipant.participantId, [a, b]),
                sql`exists (select 1 from core.event_participant x where x.event_id = ${event.id} and x.participant_id = ${a}::uuid)`,
                sql`exists (select 1 from core.event_participant y where y.event_id = ${event.id} and y.participant_id = ${b}::uuid)`,
              ),
            )
            .orderBy(desc(event.startsAt), asc(event.id));
          const order: string[] = [];
          const goals = new Map<string, Map<string, number>>();
          for (const h of history) {
            if (!goals.has(h.id)) {
              goals.set(h.id, new Map());
              order.push(h.id);
            }
            const g = h.side === 'home' ? h.score?.home : h.side === 'away' ? h.score?.away : null;
            if (g != null) goals.get(h.id)!.set(h.participantId, g);
          }
          const stats = new Map(body.summary.teams.map((t) => [t.id, t]));
          for (const id of order) {
            const g = goals.get(id)!;
            const ga = g.get(a);
            const gb = g.get(b);
            if (ga === undefined || gb === undefined) continue;
            body.summary.played += 1;
            stats.get(a)!.goals += ga;
            stats.get(b)!.goals += gb;
            if (ga === gb) body.summary.draws += 1;
            else stats.get(ga > gb ? a : b)!.wins += 1;
          }
          body.events = (await buildEvents(bctx, order.slice(0, query.limit))).map((x) => x.dto);
        }
        return {
          body,
          tags: [`event:${head.id}`, 'event'],
          ttl: CACHE_TTL.standings,
          meta: { sport: head.sport },
        };
      },
    });
  });
}
