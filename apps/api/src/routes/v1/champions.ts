import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ChampionsParams, ChampionsQuery, type CompetitionChampions } from '@galaxie/contracts';
import { asset, competition, competitionProfile, participant } from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { competitionName, resolveLocale } from '../../i18n.js';
import { competitionLogoId, teamLogoId } from '../../assets/custom-logos.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import { competitionProfileServed, semanticFloor } from '../../competitions/profile.js';
import {
  editionsOf,
  loadRunnerUps,
  loadTitles,
  rankChampions,
  rankingComplete,
} from '../../competitions/champions.js';

const MODULE = { module: 'core_data' } as const;

/** Galeria de campeões `/v1/competitions/{id}/champions` (issue #831) — módulo core_data. */
export async function championRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/competitions/:id/champions', { config: MODULE }, async (request, reply) => {
    const params = parseInput(ChampionsParams, request.params);
    const query = parseInput(ChampionsQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    const withRunnerUp = query.runner_up === true;
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale, String(query.limit ?? 'all'), withRunnerUp ? 'ru' : ''],
      load: async () => {
        const db = requireDb(ctx);
        const where = UUID_RE.test(params.id)
          ? eq(competition.id, params.id)
          : eq(competition.slug, params.id);
        const [row] = await db
          .select({
            c: competition,
            labels: competitionProfile.labels,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
          })
          .from(competition)
          .leftJoin(
            competitionProfile,
            and(
              eq(competitionProfile.competitionId, competition.id),
              competitionProfileServed(semanticFloor(ctx)),
            ),
          )
          .leftJoin(asset, eq(asset.id, competitionLogoId(ctx.logos.enabled())))
          .where(where)
          .orderBy(sql`(${competition.sport} = 'football') desc`)
          .limit(1);
        if (!row) throw problems.notFound('Competição');
        const c = row.c;

        const { rows, coverage } = await loadTitles(db, c.id);
        const all = editionsOf(rows);
        const shown = query.limit ? all.slice(0, query.limit) : all;
        const complete = rankingComplete(all, coverage);
        const runnerUps = withRunnerUp
          ? await loadRunnerUps(db, c.id, shown)
          : new Map<number, string | null>();

        // times citados: campeões, vices e, com a lista completa, o ranking inteiro
        const ids = new Set<string>();
        for (const e of complete ? all : shown) if (e.participantId) ids.add(e.participantId);
        for (const id of runnerUps.values()) if (id) ids.add(id);
        const teams = ids.size
          ? await db
              .select({
                id: participant.id,
                name: participant.name,
                shortName: participant.shortName,
                storageKey: asset.storageKey,
                sourceUrl: asset.sourceUrl,
              })
              .from(participant)
              .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
              .where(inArray(participant.id, [...ids]))
          : [];
        const names = await loadTeamNames(db, [...ids], teamNameOptions(ctx, locale));
        const refs = new Map<string, CompetitionChampions['ranking'][number]['participant']>(
          teams.map((t) => [
            t.id,
            {
              id: t.id,
              ...names.of(t.id, t.name),
              short_name: t.shortName,
              logo: assetUrl(ctx.assetsBaseUrl, t.storageKey, t.sourceUrl),
            },
          ]),
        );
        const ref = (id: string | null | undefined) => (id ? (refs.get(id) ?? null) : null);

        const ranking = complete
          ? rankChampions(all, (id) => refs.get(id)?.name ?? '').flatMap((r) => {
              const p = refs.get(r.participantId);
              return p ? [{ rank: r.rank, participant: p, titles: r.titles, seasons: r.seasons }] : [];
            })
          : [];
        const labels = { ...(c.labels ?? {}), ...(row.labels ?? {}) } as Record<string, string>;
        const body: CompetitionChampions = {
          competition: {
            id: c.id,
            slug: c.slug,
            sport: c.sport,
            name: competitionName(labels, c.countryCode, c.name, locale),
            logo: assetUrl(ctx.assetsBaseUrl, row.logoKey, row.logoUrl),
          },
          editions: shown.map((e) => ({
            season_year: e.seasonYear,
            season_label: e.seasonLabel,
            decided_on: e.decidedOn,
            champion: ref(e.participantId),
            runner_up: withRunnerUp ? ref(runnerUps.get(e.seasonYear)) : null,
          })),
          total_editions: all.length,
          ranking,
          ranking_complete: complete,
          coverage: coverage
            ? { first_year: coverage.firstYear, complete_through: coverage.completeThrough }
            : null,
        };
        return { body, tags: [`competition:${c.id}`, 'competition_title', 'competition_profile'] };
      },
    });
  });
}
