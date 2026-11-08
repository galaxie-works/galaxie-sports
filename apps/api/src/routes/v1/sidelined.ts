import type { FastifyInstance } from 'fastify';
import { EventParams, SidelinedQuery, TeamParams, type TeamSidelined } from '@galaxie/contracts';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { eventHead } from '../../events/queries.js';
import { loadEventSidelined, loadTeamSidelined, type SidelinedContext } from '../../sidelined/load.js';
import { teamNameOptions } from '../../teams/display-name.js';
import { parseInput } from '../../util.js';
import { localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;

/**
 * Desfalques (issue #830) — módulo core_data:
 * - `GET /v1/events/{id}/sidelined`: lesionados, suspensos e dúvidas de cada time do jogo;
 * - `GET /v1/teams/{id}/sidelined`: os desfalques atuais do time (e a lista do próximo jogo).
 *
 * Cache: a lista do fornecedor muda com o sync diário (`injuries` vale 4 h no cliente da api-sports) e o histórico
 * com a carga de pessoas; 1 h de TTL nos dois, 5 min no dia do jogo. As tags `event:`/`participant:` e `roster`
 * purgam junto com o evento e o elenco.
 */
export async function sidelinedRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const context = (locale: string): SidelinedContext => ({
    db: requireDb(ctx),
    assetsBaseUrl: ctx.assetsBaseUrl,
    customLogos: ctx.logos.enabled(),
    names: teamNameOptions(ctx, locale),
    now: ctx.now(),
  });

  app.get('/v1/events/:id/sidelined', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(SidelinedQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const c = context(locale);
        const head = await eventHead(c.db, params.id);
        const body = await loadEventSidelined(c, head);
        const hoursToKickoff = (head.startsAt.getTime() - c.now.getTime()) / 3_600_000;
        // no dia do jogo a lista do fornecedor ainda muda (sync diário, dúvidas confirmadas)
        const soon = head.status !== 'finished' && hoursToKickoff < 24;
        return {
          body,
          tags: [
            `event:${head.id}`,
            'roster',
            ...body.teams.flatMap((t) => (t.team.id ? [`participant:${t.team.id}`] : [])),
          ],
          ttl: soon ? CACHE_TTL.schedule : CACHE_TTL.standings,
          meta: { sport: head.sport },
        };
      },
    });
  });

  app.get('/v1/teams/:id/sidelined', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(SidelinedQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const { sport, ...body } = await loadTeamSidelined(context(locale), params.id);
        const out: TeamSidelined = body;
        return {
          body: out,
          tags: [
            `participant:${params.id}`,
            'roster',
            ...(out.next_event_id ? [`event:${out.next_event_id}`] : []),
          ],
          meta: { sport },
        };
      },
    });
  });
}
