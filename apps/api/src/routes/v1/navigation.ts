import { and, count, desc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CountryCompetitionsQuery,
  CountryParams,
  LocaleQuery,
  MIRROR_SPORTS,
  type CompetitionScope,
  type ConfederationRef,
  type CountryCompetition,
  type CountryCompetitions,
  type CountryDetail,
  type Navigation,
} from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  country,
  event,
  providerMap,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { groupCompetitions, loadGeoConfig, type GeoConfig, type ScopeEntry } from '@galaxie/geo';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { pickList, pickText, resolveLocale } from '../../i18n.js';
import { assetUrl, parseInput } from '../../util.js';

const MODULE = { module: 'core_data' } as const;
const MIRRORED = new Set<string>(MIRROR_SPORTS);

type I18n = Record<string, string>;

/** Rótulo de cada grupo da página do país. */
const SCOPE_LABELS: Record<CompetitionScope, I18n> = {
  domestic: { 'pt-BR': 'Competições nacionais', es: 'Competiciones nacionales', en: 'Domestic competitions' },
  continental_clubs: {
    'pt-BR': 'Copas continentais de clubes',
    es: 'Copas continentales de clubes',
    en: 'Continental club competitions',
  },
  national_teams: { 'pt-BR': 'Seleção', es: 'Selección', en: 'National team' },
  world_clubs: { 'pt-BR': 'Mundiais de clubes', es: 'Mundiales de clubes', en: 'Club world competitions' },
};

export interface NavigationRoutesOptions {
  /** Configuração geográfica (padrão: config/geo, carregada na primeira requisição). */
  geo?: GeoConfig;
}

/**
 * Navegação por país e menu de esportes (docs/05 §3.1.1, docs/09 §2.1) — módulo core_data, cache 24 h:
 * `GET /v1/navigation`, `GET /v1/countries/{code}` e `GET /v1/countries/{code}/competitions`.
 */
export async function navigationRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: NavigationRoutesOptions = {},
): Promise<void> {
  let geo = options.geo;
  const geoConfig = (): GeoConfig => {
    try {
      return (geo ??= loadGeoConfig());
    } catch (err) {
      app.log.error({ err }, 'config/geo inválida ou ausente');
      throw problems.degraded('Configuração geográfica (config/geo) indisponível.');
    }
  };

  const confederationRef = (g: GeoConfig, code: string | null, locale: string): ConfederationRef | null => {
    if (!code) return null;
    const c = g.confederation(code);
    return { code, name: c ? pickText(c.name as I18n, locale, code)! : code };
  };

  // ─── /v1/navigation ──────────────────────────────────────────────────────────────────────────
  app.get('/v1/navigation', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LocaleQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const g = geoConfig();
        const [sportRows, compCounts, eventCounts, countryRows] = await Promise.all([
          db.select({ slug: sport.slug, name: sport.name }).from(sport),
          db.select({ sport: competition.sport, n: count() }).from(competition).groupBy(competition.sport),
          db.select({ sport: event.sport, n: count() }).from(event).groupBy(event.sport),
          db
            .select({
              code: country.code,
              name: country.name,
              confederation: country.confederation,
              storageKey: asset.storageKey,
              sourceUrl: asset.sourceUrl,
            })
            .from(country)
            .leftJoin(asset, eq(asset.id, country.flagAssetId))
            .where(inArray(country.code, g.navigationCountries)),
        ]);
        const sportName = new Map(sportRows.map((s) => [s.slug, s.name as I18n]));
        const comps = new Map(compCounts.map((r) => [r.sport, Number(r.n)]));
        const events = new Map(eventCounts.map((r) => [r.sport, Number(r.n)]));
        const navSports = [
          ...g.navigationSports,
          // esportes do banco fora da lista da navegação (não deveria acontecer) vão ao fim
          ...sportRows
            .filter((s) => !g.navigationSports.some((n) => n.slug === s.slug))
            .map((s) => ({ slug: s.slug, name: s.name as I18n })),
        ];
        const sports: Navigation['sports'] = navSports.map((s) => {
          const competitions = comps.get(s.slug) ?? 0;
          const eventsN = events.get(s.slug) ?? 0;
          return {
            slug: s.slug,
            name: pickText({ ...(s.name as I18n), ...sportName.get(s.slug) }, locale, s.slug)!,
            competitions,
            events: eventsN,
            has_data: competitions > 0 || eventsN > 0,
            mirror: MIRRORED.has(s.slug) ? `/mirror/${s.slug}` : null,
          };
        });

        const dbCountry = new Map(countryRows.map((r) => [r.code, r]));
        const countries: Navigation['countries'] = g.navigationCountries.map((code) => {
          const cfg = g.country(code)!;
          const row = dbCountry.get(code);
          return {
            code,
            name: pickText({ ...(cfg.name as I18n), ...(row?.name as I18n | undefined) }, locale, code)!,
            flag: assetUrl(ctx.assetsBaseUrl, row?.storageKey, row?.sourceUrl),
            confederation: confederationRef(g, row?.confederation ?? cfg.confederation, locale)!,
          };
        });
        const confederations: Navigation['confederations'] = [];
        for (const c of countries) {
          let section = confederations.find((s) => s.code === c.confederation.code);
          if (!section) confederations.push((section = { ...c.confederation, countries: [] }));
          section.countries.push(c.code);
        }
        const body: Navigation = { sports, countries, confederations };
        return { body, tags: ['sport', 'competition', 'country', 'asset'] };
      },
    });
  });

  // ─── /v1/countries/:code ─────────────────────────────────────────────────────────────────────
  app.get('/v1/countries/:code', { config: MODULE }, async (request, reply) => {
    const params = parseInput(CountryParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const body = await countryDetail(requireDb(ctx), geoConfig(), params.code, locale);
        return { body, tags: [`country:${params.code}`, 'country', 'asset'] };
      },
    });
  });

  // ─── /v1/countries/:code/competitions ────────────────────────────────────────────────────────
  app.get('/v1/countries/:code/competitions', { config: MODULE }, async (request, reply) => {
    const params = parseInput(CountryParams, request.params);
    const query = parseInput(CountryCompetitionsQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const g = geoConfig();
        const detail = await countryDetail(db, g, params.code, locale);
        const items = await countryCompetitions(db, g, params.code, query.sport, query.max_tier, locale);
        const sportRows = await db.select({ slug: sport.slug, name: sport.name }).from(sport);
        const sportName = new Map(sportRows.map((s) => [s.slug, s.name as I18n]));
        const navName = new Map(g.navigationSports.map((s) => [s.slug, s.name as I18n]));
        const grouped = groupCompetitions(
          items,
          g.navigationSports.map((s) => s.slug),
          locale,
        );
        const body: CountryCompetitions = {
          country: detail,
          sports: grouped.map((s) => ({
            sport: {
              slug: s.sport,
              name: pickText({ ...navName.get(s.sport), ...sportName.get(s.sport) }, locale, s.sport)!,
            },
            groups: s.groups.map((grp) => ({
              scope: grp.scope,
              label: pickText(SCOPE_LABELS[grp.scope], locale)!,
              competitions: grp.competitions.map(({ order: _o, ...c }) => c),
            })),
          })),
        };
        return {
          body,
          tags: ['competition', 'season', 'competition_profile', `country:${params.code}`, 'country'],
        };
      },
    });
  });

  // ─── helpers ─────────────────────────────────────────────────────────────────────────────────

  async function countryDetail(
    db: Database,
    g: GeoConfig,
    code: string,
    locale: string,
  ): Promise<CountryDetail> {
    const [row] = await db
      .select({ c: country, storageKey: asset.storageKey, sourceUrl: asset.sourceUrl })
      .from(country)
      .leftJoin(asset, eq(asset.id, country.flagAssetId))
      .where(eq(country.code, code))
      .limit(1);
    const cfg = g.country(code);
    if (!row && !cfg) throw problems.notFound('País');
    return {
      code,
      name: pickText(
        { ...(cfg?.name as I18n | undefined), ...(row?.c.name as I18n | undefined) },
        locale,
        code,
      )!,
      ioc_code: row?.c.iocCode ?? cfg?.ioc ?? null,
      flag: assetUrl(ctx.assetsBaseUrl, row?.storageKey, row?.sourceUrl),
      confederation: confederationRef(g, row?.c.confederation ?? cfg?.confederation ?? null, locale),
      in_navigation: g.navigationCountries.includes(code),
    };
  }

  function selectCompetitions(db: Database) {
    return db
      .select({
        c: competition,
        country: { code: country.code, name: country.name },
        logoKey: asset.storageKey,
        logoUrl: asset.sourceUrl,
      })
      .from(competition)
      .leftJoin(country, eq(country.code, competition.countryCode))
      .leftJoin(asset, eq(asset.id, competition.logoAssetId))
      .$dynamic();
  }
  type Row = Awaited<ReturnType<ReturnType<typeof selectCompetitions>['execute']>>[number];

  /**
   * Domésticas (country_code = país, tier ≤ maxTier) + internacionais do escopo de que o país participa
   * (por slug ou, fora do catálogo, pelo ID da api-sports em core.provider_map).
   */
  async function countryCompetitions(
    db: Database,
    g: GeoConfig,
    code: string,
    sportSlug: string | undefined,
    maxTier: number,
    locale: string,
  ): Promise<(CountryCompetition & { order: number | null })[]> {
    const sportCond: SQL | undefined = sportSlug ? eq(competition.sport, sportSlug) : undefined;
    const domestic = await selectCompetitions(db).where(
      and(eq(competition.countryCode, code), lte(competition.tier, maxTier), sportCond),
    );

    const entries = g.internationalFor(code, sportSlug);
    const bySlug = new Map(entries.map((e) => [`${e.sport}/${e.slug}`, e]));
    const byProviderId = new Map(
      entries.filter((e) => e.apiSportsId !== null).map((e) => [`${e.sport}/${e.apiSportsId}`, e]),
    );
    const international = new Map<string, { row: Row; entry: ScopeEntry }>();
    if (entries.length) {
      const slugRows = await selectCompetitions(db).where(
        and(inArray(competition.slug, [...new Set(entries.map((e) => e.slug))]), sportCond),
      );
      for (const row of slugRows) {
        const entry = bySlug.get(`${row.c.sport}/${row.c.slug}`);
        if (entry) international.set(row.c.id, { row, entry });
      }
    }
    if (byProviderId.size) {
      const mapped = await db
        .select({ id: providerMap.entityId, sport: providerMap.sport, providerId: providerMap.providerId })
        .from(providerMap)
        .where(
          and(
            eq(providerMap.provider, 'api-sports'),
            eq(providerMap.entityType, 'competition'),
            inArray(providerMap.providerId, [
              ...new Set([...byProviderId.values()].map((e) => e.apiSportsId!)),
            ]),
          ),
        );
      const hits = mapped
        .map((m) => ({ id: m.id, entry: byProviderId.get(`${m.sport}/${m.providerId}`) }))
        .filter((m): m is { id: string; entry: ScopeEntry } => !!m.entry && !international.has(m.id));
      if (hits.length) {
        const rows = await selectCompetitions(db).where(
          inArray(
            competition.id,
            hits.map((h) => h.id),
          ),
        );
        const entryById = new Map(hits.map((h) => [h.id, h.entry]));
        for (const row of rows) international.set(row.c.id, { row, entry: entryById.get(row.c.id)! });
      }
    }

    const all = [
      ...domestic
        .filter((r) => !international.has(r.c.id))
        .map((row) => ({ row, entry: null as ScopeEntry | null })),
      ...international.values(),
    ];
    const summaries = await summarize(
      db,
      all.map((a) => a.row),
      locale,
    );
    return all.map(({ row, entry }, i) => ({
      ...summaries[i]!,
      scope: entry ? entry.scope : 'domestic',
      confederations: entry ? entry.confederations : [],
      order: entry ? entry.order : g.featuredOrder(row.c.sport, row.c.slug),
    }));
  }

  /** Resumo da competição (mesmo formato de /v1/competitions). */
  async function summarize(db: Database, rows: Row[], locale: string) {
    const ids = rows.map((r) => r.c.id);
    if (!ids.length) return [];
    const [profiles, current] = await Promise.all([
      db
        .select({
          competitionId: competitionProfile.competitionId,
          labels: competitionProfile.labels,
          nicknames: competitionProfile.nicknames,
        })
        .from(competitionProfile)
        .where(inArray(competitionProfile.competitionId, ids)),
      db
        .selectDistinctOn([season.competitionId], {
          competitionId: season.competitionId,
          year: season.year,
          label: season.label,
        })
        .from(season)
        .where(and(inArray(season.competitionId, ids), eq(season.current, true)))
        .orderBy(season.competitionId, desc(season.year)),
    ]);
    const profileBy = new Map(profiles.map((p) => [p.competitionId, p]));
    const currentBy = new Map(current.map((s) => [s.competitionId, s]));
    return rows.map((r) => {
      const profile = profileBy.get(r.c.id);
      const labels = { ...(r.c.labels ?? {}), ...(profile?.labels ?? {}) } as I18n;
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
        country: r.country?.code
          ? { code: r.country.code, name: pickText(r.country.name as I18n, locale, r.country.code)! }
          : null,
        logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
        current_season: cur ? { year: cur.year, label: cur.label } : null,
      };
    });
  }
}
