import type { FastifyInstance } from 'fastify';
import { CompetitionParams, TeamParams, TransfersQuery } from '@galaxie/contracts';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import {
  loadCompetitionTransfers,
  loadTeamTransfers,
  type TransfersOptions,
} from '../../transfers/transfers.js';
import { teamNameOptions } from '../../teams/display-name.js';
import { parseInput } from '../../util.js';
import { localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;

/**
 * Vai e vem do mercado (#832): `/v1/teams/{id}/transfers` e `/v1/competitions/{id}/transfers`. As
 * transferências mudam no ritmo dos elencos: cache de 1 hora (o mesmo dos elencos e tabelas).
 */
export async function transferRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const options = (locale: string, query: ReturnType<typeof TransfersQuery.parse>): TransfersOptions => ({
    direction: query.direction,
    days: query.days,
    limit: query.limit,
    now: ctx.now(),
    assetsBaseUrl: ctx.assetsBaseUrl,
    customLogos: ctx.logos.enabled(),
    names: teamNameOptions(ctx, locale),
    minReview: ctx.semantic?.minReviewStatus ?? 'approved',
  });

  app.get('/v1/teams/:id/transfers', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(TransfersQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const r = await loadTeamTransfers(requireDb(ctx), params.id, options(locale, query));
        return {
          body: r.body,
          tags: ['roster', ...r.teamIds.map((t) => `participant:${t}`)],
          meta: { sport: r.sport },
        };
      },
    });
  });

  app.get('/v1/competitions/:id/transfers', { config: MODULE }, async (request, reply) => {
    const params = parseInput(CompetitionParams, request.params);
    const query = parseInput(TransfersQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const r = await loadCompetitionTransfers(requireDb(ctx), params.id, {
          ...options(locale, query),
          locale,
        });
        return {
          body: r.body,
          tags: ['roster', `competition:${r.competitionId}`],
          meta: { sport: r.sport },
        };
      },
    });
  });
}
