import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ChampionsParams,
  ChampionsQuery,
  LeadersParams,
  LeadersQuery,
  type Champions,
  type Leaders,
  type LocaleQuery,
} from '@galaxie/contracts';
import { competition, season, type Database } from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import {
  leadersUpdatedAt,
  loadChampionRows,
  loadLeaderRows,
  loadTitleCoverage,
  rankLeaders,
  titleRanking,
} from '../../competitions/championship.js';

const MODULE = { module: 'core_data' } as const;

function localeOf(request: FastifyRequest, query: Pick<LocaleQuery, 'locale'>) {
  return resolveLocale(query.locale, request.headers['accept-language']);
}

/** Competição pelo UUID ou slug (o slug do futebol ganha quando dois esportes usam o mesmo). */
async function findCompetition(db: Database, idOrSlug: string) {
  const [row] = await db
    .select({ id: competition.id, sport: competition.sport, type: competition.type })
    .from(competition)
    .where(UUID_RE.test(idOrSlug) ? eq(competition.id, idOrSlug) : eq(competition.slug, idOrSlug))
    .orderBy(sql`(${competition.sport} = 'football') desc`)
    .limit(1);
  if (!row) throw problems.notFound('Competição');
  return row;
}

/** Rotas do campeonato para os widgets do épico #820: artilharia (#828) e galeria de campeões (#831). */
export async function championshipRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const ref = (
    id: string | null,
    name: string | null,
    short: string | null,
    key: string | null,
    url: string | null,
    names: Awaited<ReturnType<typeof loadTeamNames>>,
  ) =>
    id && name
      ? { id, ...names.of(id, name), short_name: short, logo: assetUrl(ctx.assetsBaseUrl, key, url) }
      : null;

  // ─── /v1/competitions/:id/seasons/:season/leaders ───────────────────────────────────────────
  app.get('/v1/competitions/:id/seasons/:season/leaders', { config: MODULE }, async (request, reply) => {
    const params = parseInput(LeadersParams, request.params);
    const query = parseInput(LeadersQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      load: async () => {
        const db = requireDb(ctx);
        const c = await findCompetition(db, params.id);
        const [s] = await db
          .select({ id: season.id, year: season.year, label: season.label })
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
        const raw = await loadLeaderRows(db, {
          seasonId: s.id,
          category: query.category,
          limit: query.limit,
          customLogos: ctx.logos.enabled(),
        });
        const ranked = rankLeaders(raw, query.category, query.limit);
        const names = await loadTeamNames(
          db,
          ranked.flatMap((r) => (r.team_id ? [r.team_id] : [])),
          teamNameOptions(ctx, locale),
        );
        const updated = await leadersUpdatedAt(db, s.id);
        const body: Leaders = {
          competition_id: c.id,
          sport: c.sport,
          season: { year: s.year, label: s.label },
          category: query.category,
          data: ranked.map((r) => ({
            rank: r.rank,
            person: {
              id: r.person_id,
              name: r.person_name,
              photo: assetUrl(ctx.assetsBaseUrl, r.photo_key, r.photo_url),
              nationality: r.nationality,
            },
            team: ref(r.team_id, r.team_name, r.team_short, r.logo_key, r.logo_url, names),
            teams: r.teams,
            appearances: r.appearances,
            minutes: r.minutes,
            goals: r.goals,
            assists: r.assists,
            yellow_cards: r.yellow_cards,
            red_cards: r.red_cards,
          })),
          updated_at: updated ? formatInstant(updated, tz) : null,
        };
        return { body, tags: [`competition:${c.id}`, `season:${s.id}`] };
      },
    });
  });

  // ─── /v1/competitions/:id/champions ──────────────────────────────────────────────────────────
  app.get('/v1/competitions/:id/champions', { config: MODULE }, async (request, reply) => {
    const params = parseInput(ChampionsParams, request.params);
    const query = parseInput(ChampionsQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const c = await findCompetition(db, params.id);
        const rows = await loadChampionRows(db, {
          competitionId: c.id,
          competitionType: c.type,
          customLogos: ctx.logos.enabled(),
        });
        const coverage = rows.length ? await loadTitleCoverage(db, c.id) : null;
        const ranking = titleRanking(rows, coverage);
        const names = await loadTeamNames(
          db,
          rows.flatMap((r) => [r.champion_id, r.runner_id].filter((id): id is string => !!id)),
          teamNameOptions(ctx, locale),
        );
        const teamRef = new Map(
          rows.flatMap((r) => {
            const champ = ref(
              r.champion_id,
              r.champion_name,
              r.champion_short,
              r.champion_logo_key,
              r.champion_logo_url,
              names,
            );
            return champ ? [[champ.id, champ] as const] : [];
          }),
        );
        const body: Champions = {
          competition_id: c.id,
          sport: c.sport,
          data: rows.slice(0, query.limit).map((r) => ({
            season_year: r.season_year,
            season_label: r.season_label,
            decided_on: r.decided_on,
            champion: r.champion_id ? (teamRef.get(r.champion_id) ?? null) : null,
            runner_up: ref(
              r.runner_id,
              r.runner_name,
              r.runner_short,
              r.runner_logo_key,
              r.runner_logo_url,
              names,
            ),
          })),
          editions: rows.length,
          ranking:
            ranking?.flatMap((t) => {
              const team = teamRef.get(t.teamId);
              return team ? [{ team, titles: t.titles, last: t.last }] : [];
            }) ?? null,
          coverage: coverage
            ? {
                first_year: coverage.first_year,
                complete_through: coverage.complete_through,
                unidentified: rows.filter((r) => !r.champion_id).length,
              }
            : null,
        };
        return { body, tags: [`competition:${c.id}`] };
      },
    });
  });
}
