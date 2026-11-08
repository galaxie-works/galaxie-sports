import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  TeamParams,
  TeamStatisticsQuery,
  type TeamSeasonStatistics,
  type TeamStatistics,
} from '@galaxie/contracts';
import { asset, competition, competitionProfile, participant, season, teamSeasonStat } from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { competitionName } from '../../i18n.js';
import { competitionLogoId } from '../../assets/custom-logos.js';
import { competitionProfileJoin } from '../../competitions/profile.js';
import { readTeamSeasonStats } from '../../teams/season-stats.js';
import { assetUrl, parseInput } from '../../util.js';
import { localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;

/**
 * Estatísticas do time por competição e temporada (#893), de `core.team_season_stat` (o agregado do fornecedor,
 * renovado pelo espelho a cada 7 ou 14 dias). Sem `competition`/`season`, a temporada mais recente e, nela, a competição em que
 * o time mais jogou. Time sem estatísticas (esporte sem o dado, temporada não coletada) → `data: null`.
 */
export async function teamStatisticsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/teams/:id/statistics', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(TeamStatisticsQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.teamStats,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const db = requireDb(ctx);
        const [team] = await db
          .select({ id: participant.id, sport: participant.sport })
          .from(participant)
          .where(eq(participant.id, params.id))
          .limit(1);
        if (!team) throw problems.notFound('Time');

        const rows = await db
          .select({
            stat: teamSeasonStat,
            year: season.year,
            label: season.label,
            c: {
              id: competition.id,
              slug: competition.slug,
              name: competition.name,
              labels: competition.labels,
              countryCode: competition.countryCode,
            },
            profileLabels: competitionProfile.labels,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
          })
          .from(teamSeasonStat)
          .innerJoin(season, eq(season.id, teamSeasonStat.seasonId))
          .innerJoin(competition, eq(competition.id, season.competitionId))
          .leftJoin(competitionProfile, competitionProfileJoin(ctx.semantic?.minReviewStatus ?? 'approved'))
          .leftJoin(asset, eq(asset.id, competitionLogoId(ctx.logos.enabled())))
          .where(eq(teamSeasonStat.participantId, team.id))
          // mais recente primeiro; no mesmo ano, a competição em que o time mais jogou (sem contagem de jogos, por
          // último: o `desc` do Postgres poria o nulo na frente)
          .orderBy(desc(season.year), sql`${teamSeasonStat.played} desc nulls last`, competition.name);

        const ref = (r: (typeof rows)[number]) => ({
          competition: {
            id: r.c.id,
            slug: r.c.slug,
            name: competitionName(
              { ...(r.c.labels ?? {}), ...(r.profileLabels ?? {}) } as Record<string, string>,
              r.c.countryCode,
              r.c.name,
              locale,
            ),
            logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
          },
          season: { year: r.year, label: r.label },
        });
        const wanted = query.competition;
        const chosen = rows.find(
          (r) =>
            (wanted === undefined || r.c.id === wanted || r.c.slug === wanted) &&
            (query.season === undefined || r.year === query.season),
        );
        const data: TeamSeasonStatistics | null = chosen
          ? {
              ...ref(chosen),
              form: chosen.stat.form,
              ...readTeamSeasonStats(chosen.stat.stats),
              updated_at: chosen.stat.observedAt.toISOString(),
            }
          : null;
        const body: TeamStatistics = {
          team_id: team.id,
          sport: team.sport,
          data,
          available: rows.map(ref),
        };
        return {
          body,
          tags: [`participant:${team.id}`, 'team_season_stat', 'competition'],
          meta: { sport: team.sport },
        };
      },
    });
  });
}
