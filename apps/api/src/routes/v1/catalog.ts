import { and, asc, count, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { loadGeoConfig, type GeoConfig } from '@galaxie/geo';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as z from 'zod';
import {
  CompetitionParams,
  CompetitionsQuery,
  IdParams,
  LocaleQuery,
  MIRROR_SPORTS,
  StandingsParams,
  type Competition,
  type CompetitionSummary,
  type Country,
  type Sport,
  type Standings,
  type Venue,
} from '@galaxie/contracts';
import {
  asset,
  assetCredit,
  competition,
  competitionProfile,
  country,
  participant,
  providerMap,
  season,
  sport,
  standing,
  venue,
  venueDisplay,
  venueFormerNames,
  type Database,
  type I18nText,
} from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, pickList, pickText, resolveLocale } from '../../i18n.js';
import { competitionLogoId, teamLogoId } from '../../assets/custom-logos.js';
import {
  assetUrl,
  decodeCursor,
  encodeCursor,
  likeEscape,
  logoCreditText,
  logoSource,
  parseInput,
  UUID_RE,
} from '../../util.js';
import { OFF_CATALOG_SPORTS } from '../../off-catalog.js';
import { enrichRaceStandings } from '../../events/race-standings.js';
import { loadLiveries, type LiveryEntry } from '@galaxie/knowledge';
import { currentPhaseKey, standingsGroupLabel, standingsTableOf } from '@galaxie/rules';
import { effectiveMinReview, meetsReview } from './semantic.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import {
  competitionProfileServed,
  competitionProfileServedSql,
  semanticFloor,
} from '../../competitions/profile.js';

const MODULE = { module: 'core_data' } as const;
const MIRRORED = new Set<string>(MIRROR_SPORTS);

const CompetitionCursor = z.object({ t: z.number().int(), n: z.string(), i: z.string().regex(UUID_RE) });

type CountryRow = { code: string; name: I18nText } | null;

/** Locale e fuso da requisição; registra Content-Language. */
function localeOf(request: FastifyRequest, query: { locale?: z.infer<typeof LocaleQuery>['locale'] }) {
  return resolveLocale(query.locale, request.headers['accept-language']);
}

/** Rotas do catálogo (docs/05 §3.1). Todas exigem o módulo core_data. */
export async function catalogRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // pinturas da F1 por época (data/knowledge/formula-1/liveries.yaml), lidas uma vez, no piso editorial
  let liveriesCache: Promise<LiveryEntry[]> | undefined;
  const liveries = () => {
    liveriesCache ??= loadLiveries(...(ctx.semantic?.knowledgeDir ? [ctx.semantic.knowledgeDir] : []))
      .then((all) => all.filter((l) => meetsReview(l.review_status, effectiveMinReview(ctx, undefined))))
      .catch((err: unknown) => {
        liveriesCache = undefined;
        throw err;
      });
    return liveriesCache;
  };
  // nível nacional/regional e posição editorial das domésticas (config/geo); sem a config, os campos saem
  // null em vez de quebrar
  let geo: GeoConfig | null | undefined;
  const geoConfig = () => {
    if (geo === undefined) {
      try {
        geo = loadGeoConfig();
      } catch (err) {
        app.log.warn({ err }, 'config/geo indisponível: competições sem `level` e `order`');
        geo = null;
      }
    }
    return geo;
  };
  const levelOf = (sport: string, slug: string, countryCode: string | null | undefined) =>
    geoConfig()?.competitionLevel(sport, slug, countryCode ?? null) ?? null;
  const orderOf = (sport: string, slug: string, countryCode: string | null | undefined) =>
    levelOf(sport, slug, countryCode) ? (geoConfig()?.domesticOrder(sport, slug) ?? null) : null;
  const countryRef = (c: CountryRow, locale: string) =>
    c ? { code: c.code, name: pickText(c.name as Record<string, string>, locale, c.code)! } : null;

  // ─── /v1/sports ──────────────────────────────────────────────────────────────────────────────
  app.get('/v1/sports', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const rows = await db
          .select({ slug: sport.slug, name: sport.name, competitions: count(competition.id) })
          .from(sport)
          .leftJoin(competition, eq(competition.sport, sport.slug))
          .where(notInArray(sport.slug, [...OFF_CATALOG_SPORTS]))
          .groupBy(sport.slug)
          .orderBy(asc(sport.slug));
        const data: Sport[] = rows.map((r) => ({
          slug: r.slug,
          name: pickText(r.name as Record<string, string>, locale, r.slug)!,
          competitions: Number(r.competitions),
          mirror: MIRRORED.has(r.slug) ? `/mirror/${r.slug}` : null,
        }));
        return { body: { data }, tags: ['sport', 'competition'] };
      },
    });
  });

  // ─── /v1/countries ───────────────────────────────────────────────────────────────────────────
  app.get('/v1/countries', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const rows = await db
          .select({ c: country, storageKey: asset.storageKey, sourceUrl: asset.sourceUrl })
          .from(country)
          .leftJoin(asset, eq(asset.id, country.flagAssetId));
        const data: Country[] = rows
          .map((r) => ({
            code: r.c.code,
            name: pickText(r.c.name as Record<string, string>, locale, r.c.code)!,
            ioc_code: r.c.iocCode,
            confederation: r.c.confederation,
            flag: assetUrl(ctx.assetsBaseUrl, r.storageKey, r.sourceUrl),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, locale));
        return { body: { data }, tags: ['country', 'asset'] };
      },
    });
  });

  // ─── /v1/competitions ────────────────────────────────────────────────────────────────────────
  app.get('/v1/competitions', { config: MODULE }, async (request, reply) => {
    const query = parseInput(CompetitionsQuery, request.query);
    const locale = localeOf(request, query);
    const cursor = query.cursor ? decodeCursor(CompetitionCursor, query.cursor) : undefined;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const conds: SQL[] = [];
        if (query.sport) conds.push(eq(competition.sport, query.sport));
        if (query.country) conds.push(eq(competition.countryCode, query.country));
        if (query.tier) conds.push(eq(competition.tier, query.tier));
        if (query.q) {
          const p = `%${likeEscape(query.q)}%`;
          conds.push(
            or(
              ilike(competition.name, p),
              ilike(competition.slug, p),
              sql`${competition.labels}::text ilike ${p}`,
              sql`exists (select 1 from ${competitionProfile} cp
                          where cp.competition_id = ${competition.id}
                            and ${competitionProfileServedSql('cp', semanticFloor(ctx))}
                            and (cp.nicknames::text ilike ${p} or cp.labels::text ilike ${p}))`,
            )!,
          );
        }
        if (cursor)
          conds.push(
            sql`(${competition.tier}, ${competition.name}, ${competition.id}) > (${cursor.t}, ${cursor.n}, ${cursor.i}::uuid)`,
          );
        const rows = await selectCompetitions(db)
          .where(and(...conds))
          .orderBy(asc(competition.tier), asc(competition.name), asc(competition.id))
          .limit(query.limit + 1);
        const pageRows = rows.slice(0, query.limit);
        const data = await toSummaries(db, pageRows, locale);
        const last = pageRows.at(-1);
        const next_cursor =
          rows.length > query.limit && last
            ? encodeCursor({ t: last.c.tier, n: last.c.name, i: last.c.id })
            : null;
        return {
          body: { data, next_cursor },
          tags: ['competition', 'season', 'competition_profile', 'country'],
        };
      },
    });
  });

  // ─── /v1/competitions/:id ────────────────────────────────────────────────────────────────────
  app.get('/v1/competitions/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(CompetitionParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const row = await findCompetition(db, params.id);
        const [summary] = await toSummaries(db, [row], locale);
        const [profile] = await db
          .select({ trophy: competitionProfile.trophyNickname })
          .from(competitionProfile)
          .where(
            and(eq(competitionProfile.competitionId, row.c.id), competitionProfileServed(semanticFloor(ctx))),
          )
          .limit(1);
        const seasons = await db
          .select()
          .from(season)
          .where(eq(season.competitionId, row.c.id))
          .orderBy(desc(season.year));
        const ids = await db
          .select({ provider: providerMap.provider, providerId: providerMap.providerId })
          .from(providerMap)
          .where(and(eq(providerMap.entityType, 'competition'), eq(providerMap.entityId, row.c.id)));
        // logo da Commons (competição sem logo do fornecedor, ex.: a F1): sai com o crédito
        const [credit] =
          row.logoOrigin === 'commons' && row.logoAssetId
            ? await db.select().from(assetCredit).where(eq(assetCredit.assetId, row.logoAssetId)).limit(1)
            : [];
        const body: Competition = {
          ...summary!,
          logo_source: logoSource(row.logoOrigin),
          logo_credit: credit
            ? {
                source: 'Wikimedia Commons',
                title: credit.title,
                page_url: credit.pageUrl,
                author: credit.author,
                license: credit.license,
                license_url: credit.licenseUrl,
                attribution_required: credit.attributionRequired,
                attribution: credit.attribution,
                text: logoCreditText(credit.author, credit.license, credit.attribution),
              }
            : null,
          trophy_nickname: profile?.trophy ?? null,
          external_ids: Object.fromEntries(ids.map((i) => [i.provider, i.providerId])),
          seasons: seasons.map((s) => ({
            year: s.year,
            label: s.label,
            start_date: s.startDate,
            end_date: s.endDate,
            current: s.current,
            coverage: s.coverage ?? null,
          })),
        };
        return { body, tags: [`competition:${row.c.id}`, 'season', 'competition_profile'] };
      },
    });
  });

  // ─── /v1/competitions/:id/seasons/:season/standings ──────────────────────────────────────────
  app.get('/v1/competitions/:id/seasons/:season/standings', { config: MODULE }, async (request, reply) => {
    const params = parseInput(StandingsParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      load: async () => {
        const db = requireDb(ctx);
        const row = await findCompetition(db, params.id);
        const [s] = await db
          .select()
          .from(season)
          .where(
            and(
              eq(season.competitionId, row.c.id),
              params.season === 'current' ? eq(season.current, true) : eq(season.year, Number(params.season)),
            ),
          )
          .orderBy(desc(season.year))
          .limit(1);
        if (!s) throw problems.notFound('Temporada');

        const rows = await db
          .select({
            st: standing,
            p: {
              id: participant.id,
              name: participant.name,
              shortName: participant.shortName,
            },
            storageKey: asset.storageKey,
            sourceUrl: asset.sourceUrl,
          })
          .from(standing)
          .innerJoin(participant, eq(participant.id, standing.participantId))
          .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
          .where(eq(standing.seasonId, s.id))
          .orderBy(asc(standing.group), asc(standing.rank));

        const names = await loadTeamNames(
          db,
          rows.map((r) => r.p.id),
          teamNameOptions(ctx, locale),
        );
        // tabelas da temporada pelo regulamento (Apertura/Clausura, anual, promedios): nome, papel e fase atual
        // os regulamentos (config/rules) são do futebol
        const rules = row.c.sport === 'football' ? await ctx.rules.get(row.c.slug, s.year) : null;
        const tables = rules?.tables.length ? rules : null;
        const activity = new Map<string, number>();
        for (const r of rows) activity.set(r.st.group, Math.max(activity.get(r.st.group) ?? 0, r.st.played));
        const currentPhase = tables
          ? currentPhaseKey(
              tables,
              [...activity].map(([group, played]) => ({ group, played })),
            )
          : null;
        const groups = new Map<string, Standings['groups'][number]>();
        const sources = new Map<string, Set<string>>();
        let updatedAt: Date | null = null;
        for (const r of rows) {
          sources.set(r.st.group, (sources.get(r.st.group) ?? new Set()).add(r.st.source));
          let g = groups.get(r.st.group);
          if (!g) {
            const t = tables ? standingsTableOf(tables, r.st.group) : null;
            g = {
              name: r.st.group || null,
              display_name: t ? standingsGroupLabel(t, r.st.group, locale) : null,
              table: t?.kind ?? null,
              table_key: t?.key ?? null,
              current: tables ? t?.kind === 'phase' && t.key === currentPhase : null,
              source: null,
              rows: [],
            };
            groups.set(r.st.group, g);
          }
          g.rows.push({
            rank: r.st.rank,
            participant: {
              id: r.p.id,
              ...names.of(r.p.id, r.p.name),
              short_name: r.p.shortName,
              logo: assetUrl(ctx.assetsBaseUrl, r.storageKey, r.sourceUrl),
            },
            points: r.st.points,
            played: r.st.played,
            won: r.st.won,
            drawn: r.st.drawn,
            lost: r.st.lost,
            ot_won: r.st.otWon,
            ot_lost: r.st.otLost,
            goals_for: r.st.goalsFor,
            goals_against: r.st.goalsAgainst,
            goal_diff: r.st.goalsFor - r.st.goalsAgainst,
            form: r.st.form,
            description: r.st.description,
          });
          if (!updatedAt || r.st.updatedAt > updatedAt) updatedAt = r.st.updatedAt;
        }
        // F1: retrato, equipe da temporada (nome de época e cor), pódios e o desempate por contagem regressiva
        if (row.c.sport === 'formula-1')
          await enrichRaceStandings(db, s.id, [...groups.values()], {
            assetsBaseUrl: ctx.assetsBaseUrl,
            liveries: await liveries().catch(() => []),
            year: s.year,
          });
        for (const [group, set] of sources) {
          const only = set.size === 1 ? [...set][0] : null;
          groups.get(group)!.source = only === 'provider' || only === 'computed' ? only : null;
        }
        // ordem do regulamento (fases na ordem cronológica, depois as auxiliares); grupo desconhecido no fim
        const order = (g: Standings['groups'][number]) =>
          tables && g.table_key
            ? tables.tables.findIndex((t) => t.key === g.table_key)
            : Number.MAX_SAFE_INTEGER;
        const ordered = [...groups.values()].sort(
          (a, b) => order(a) - order(b) || (a.name ?? '').localeCompare(b.name ?? ''),
        );
        const source = rows[0]?.st.source;
        const body: Standings = {
          competition_id: row.c.id,
          season: { year: s.year, label: s.label },
          groups: ordered,
          source: source === 'provider' || source === 'computed' ? source : null,
          updated_at: updatedAt ? formatInstant(updatedAt, tz) : null,
        };
        return { body, tags: [`standing:${s.id}`, `competition:${row.c.id}`] };
      },
    });
  });

  // ─── /v1/venues/:id ──────────────────────────────────────────────────────────────────────────
  app.get('/v1/venues/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(IdParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const [row] = await db
          .select({
            v: venue,
            country: { code: country.code, name: country.name },
            storageKey: asset.storageKey,
            sourceUrl: asset.sourceUrl,
          })
          .from(venue)
          .leftJoin(country, eq(country.code, venue.countryCode))
          .leftJoin(asset, eq(asset.id, venue.imageAssetId))
          .where(eq(venue.id, params.id))
          .limit(1);
        if (!row) throw problems.notFound('Venue');
        const shown = venueDisplay(row.v);
        const body: Venue = {
          id: row.v.id,
          name: shown.name,
          city: shown.city,
          country: countryRef(row.country?.code ? (row.country as CountryRow) : null, locale),
          capacity: row.v.capacity,
          surface: row.v.surface,
          image: assetUrl(ctx.assetsBaseUrl, row.storageKey, row.sourceUrl),
          provider_name: row.v.name,
          former_names: venueFormerNames(row.v),
        };
        return { body, tags: [`venue:${row.v.id}`] };
      },
    });
  });

  // ─── helpers ─────────────────────────────────────────────────────────────────────────────────

  function selectCompetitions(db: Database) {
    return db
      .select({
        c: competition,
        country: { code: country.code, name: country.name },
        logoKey: asset.storageKey,
        logoUrl: asset.sourceUrl,
        logoOrigin: asset.origin,
        logoAssetId: asset.id,
      })
      .from(competition)
      .leftJoin(country, eq(country.code, competition.countryCode))
      .leftJoin(asset, eq(asset.id, competitionLogoId(ctx.logos.enabled())))
      .$dynamic();
  }

  type CompetitionRow = Awaited<ReturnType<ReturnType<typeof selectCompetitions>['execute']>>[number];

  async function findCompetition(db: Database, idOrSlug: string): Promise<CompetitionRow> {
    const where = UUID_RE.test(idOrSlug) ? eq(competition.id, idOrSlug) : eq(competition.slug, idOrSlug);
    const [row] = await selectCompetitions(db)
      .where(where)
      .orderBy(sql`(${competition.sport} = 'football') desc`)
      .limit(1);
    if (!row) throw problems.notFound('Competição');
    return row;
  }

  async function toSummaries(
    db: Database,
    rows: CompetitionRow[],
    locale: string,
  ): Promise<CompetitionSummary[]> {
    const ids = rows.map((r) => r.c.id);
    if (!ids.length) return [];
    const profiles = await db
      .select({
        competitionId: competitionProfile.competitionId,
        labels: competitionProfile.labels,
        nicknames: competitionProfile.nicknames,
      })
      .from(competitionProfile)
      .where(
        and(inArray(competitionProfile.competitionId, ids), competitionProfileServed(semanticFloor(ctx))),
      );
    const profileBy = new Map(profiles.map((p) => [p.competitionId, p]));
    const current = await db
      .selectDistinctOn([season.competitionId], {
        competitionId: season.competitionId,
        year: season.year,
        label: season.label,
      })
      .from(season)
      .where(and(inArray(season.competitionId, ids), eq(season.current, true)))
      .orderBy(season.competitionId, desc(season.year));
    const currentBy = new Map(current.map((s) => [s.competitionId, s]));

    return rows.map((r): CompetitionSummary => {
      const profile = profileBy.get(r.c.id);
      const labels = { ...(r.c.labels ?? {}), ...(profile?.labels ?? {}) } as Record<string, string>;
      const cur = currentBy.get(r.c.id);
      return {
        id: r.c.id,
        slug: r.c.slug,
        sport: r.c.sport,
        name: pickText(labels, locale, r.c.name)!,
        official_name: r.c.name,
        nicknames: pickList(profile?.nicknames, locale),
        type: r.c.type,
        tier: r.c.tier,
        country: countryRef(r.country?.code ? (r.country as CountryRow) : null, locale),
        level: levelOf(r.c.sport, r.c.slug, r.country?.code),
        order: orderOf(r.c.sport, r.c.slug, r.country?.code),
        logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
        current_season: cur ? { year: cur.year, label: cur.label } : null,
      };
    });
  }
}
