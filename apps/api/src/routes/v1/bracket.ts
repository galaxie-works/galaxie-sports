import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { BracketParams, LocaleQuery, type Bracket, type Event } from '@galaxie/contracts';
import { asset, competition, event, eventParticipant, participant, season, stage } from '@galaxie/db';
import { knockoutStageRules } from '@galaxie/rules';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL, STALE_SEC } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant } from '../../i18n.js';
import { teamLogoId } from '../../assets/custom-logos.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';
import { eventsTtl, rulesStageKey } from '../../events/builder.js';
import { BRACKET_KINDS, buildBracket, type BracketMatch } from '../../competitions/bracket.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import { localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;

/**
 * Chaveamento do mata-mata da temporada (#829): `GET /v1/competitions/{id}/seasons/{season}/bracket`.
 * Fases de mata-mata com os confrontos (ida e volta, jogo único ou série), agregado, pênaltis e vencedor,
 * na ordem do chaveamento. Cache como a agenda: curto com jogo ao vivo ou perto de começar (`eventsTtl`),
 * até 1 h sem jogo por perto; purgado por `competition:<id>` e `event`.
 */
export async function bracketRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/competitions/:id/seasons/:season/bracket', { config: MODULE }, async (request, reply) => {
    const params = parseInput(BracketParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      staleSec: STALE_SEC.standings,
      vary: [locale, tz],
      check: sportCheck(request),
      load: async () => {
        const db = requireDb(ctx);
        const [c] = await db
          .select({ id: competition.id, slug: competition.slug, sport: competition.sport })
          .from(competition)
          .where(UUID_RE.test(params.id) ? eq(competition.id, params.id) : eq(competition.slug, params.id))
          .orderBy(sql`(${competition.sport} = 'football') desc`)
          .limit(1);
        if (!c) throw problems.notFound('Competição');
        const [s] = await db
          .select()
          .from(season)
          .where(
            and(
              eq(season.competitionId, c.id),
              params.season === 'current' ? eq(season.current, true) : eq(season.year, Number(params.season)),
            ),
          )
          .orderBy(desc(season.year))
          .limit(1);
        if (!s) throw problems.notFound('Temporada');

        const stages = (
          await db
            .select({
              id: stage.id,
              kind: stage.kind,
              name: stage.name,
              label: stage.providerLabel,
              order: stage.order,
            })
            .from(stage)
            .where(eq(stage.seasonId, s.id))
            .orderBy(asc(stage.order))
        ).filter((st) => BRACKET_KINDS.has(st.kind));

        const rows = stages.length
          ? await db
              .select({
                id: event.id,
                stageId: event.stageId,
                startsAt: event.startsAt,
                updatedAt: event.updatedAt,
                status: event.status,
                score: event.score,
                participantId: eventParticipant.participantId,
                side: eventParticipant.side,
                result: eventParticipant.result,
              })
              .from(event)
              .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
              .where(
                inArray(
                  event.stageId,
                  stages.map((st) => st.id),
                ),
              )
          : [];
        const byId = new Map<string, BracketMatch>();
        for (const r of rows) {
          const m = byId.get(r.id) ?? {
            id: r.id,
            stageId: r.stageId!,
            startsAt: r.startsAt,
            updatedAt: r.updatedAt,
            status: r.status as Event['status'],
            score: r.score ?? null,
            homeId: null,
            awayId: null,
            winnerId: null,
          };
          if (r.side === 'home') m.homeId = r.participantId;
          if (r.side === 'away') m.awayId = r.participantId;
          if ((r.result as { winner?: unknown } | null)?.winner === true) m.winnerId = r.participantId;
          byId.set(r.id, m);
        }
        const matches = [...byId.values()];

        const ids = [
          ...new Set(matches.flatMap((m) => [m.homeId, m.awayId]).filter((x): x is string => !!x)),
        ];
        const parts = ids.length
          ? await db
              .select({
                id: participant.id,
                name: participant.name,
                shortName: participant.shortName,
                key: asset.storageKey,
                url: asset.sourceUrl,
              })
              .from(participant)
              .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
              .where(inArray(participant.id, ids))
          : [];
        const names = await loadTeamNames(db, ids, teamNameOptions(ctx, locale));
        const participants = new Map(
          parts.map((p) => [
            p.id,
            {
              id: p.id,
              ...names.of(p.id, p.name),
              short_name: p.shortName,
              logo: assetUrl(ctx.assetsBaseUrl, p.key, p.url),
            },
          ]),
        );

        // partidas por confronto pelo regulamento (Copa do Brasil: jogo único nas primeiras fases)
        const rules = c.sport === 'football' ? await ctx.rules.get(c.slug, s.year) : null;
        const rounds = buildBracket({
          sport: c.sport,
          stages: stages.map((st) => ({ ...st, name: st.name as Record<string, string> })),
          matches,
          participants,
          locale,
          tz,
          expectedLegs: (st) =>
            rules?.knockout
              ? (knockoutStageRules(rules, rulesStageKey(st.kind, st.label)).legs ?? null)
              : null,
        });

        const updated = matches.reduce<Date | null>(
          (max, m) => (!max || m.updatedAt > max ? m.updatedAt : max),
          null,
        );
        const body: Bracket = {
          competition_id: c.id,
          sport: c.sport,
          season: { year: s.year, label: s.label },
          rounds,
          updated_at: updated ? formatInstant(updated, tz) : null,
        };
        const asEvents = matches.map((m) => ({ status: m.status, starts_at: m.startsAt.toISOString() }));
        return {
          body,
          tags: [`competition:${c.id}`, `standing:${s.id}`, 'event'],
          ttl: eventsTtl(asEvents, ctx.now(), CACHE_TTL.standings),
          meta: { sport: c.sport },
        };
      },
    });
  });
}
