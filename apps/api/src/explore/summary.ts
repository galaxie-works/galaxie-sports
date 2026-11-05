/**
 * Resumo da home "Explorar" (docs/05 §3.1.2): contadores por esporte e por país, competições e clubes em
 * destaque e o jogo de maior relevância de cada país.
 *
 * As escolhas e as contas (a parte pesada: um ano de jogos) vêm prontas de `core.explore_summary`, gravado pelo job
 * `explore-summary` do ingestor (#596) com o código de `@galaxie/explore`. Aqui a API aplica o recorte do plano e junta
 * o que depende da requisição: nomes no idioma, logos (acervo do tenant), bandeiras e os eventos dos destaques, tudo
 * por id. Sem o pré-calculado (primeira subida) ou com ele velho (mais de 30 min), faz a mesma conta na hora, com o
 * `statement_timeout` de sempre, e registra um aviso.
 */
import { eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Event, ExploreCompetition, ExploreSummary, ExploreTeam } from '@galaxie/contracts';
import { asset, competition, competitionProfile, country, sport, type AssetPalette } from '@galaxie/db';
import {
  computeExploreSnapshot,
  continentalSlugs,
  EXPLORE_MAX_AGE_MS,
  loadExploreSnapshot,
  selectForScope,
  selectWindowEvents as selectWindowRows,
  sportOf,
  type CountryCandidate,
  type ExploreSnapshot,
  type WindowEvent,
} from '@galaxie/explore';
import type { GeoConfig } from '@galaxie/geo';
import { buildEvents, type BuildContext } from '../events/builder.js';
import { reasonDto } from '../events/relevance.js';
import { competitionName, pickText } from '../i18n.js';
import { teamColors } from '../teams/colors.js';
import { competitionLogoId, logoIdSql } from '../assets/custom-logos.js';
import { assetUrl } from '../util.js';
import { OFF_CATALOG_SPORTS } from '../off-catalog.js';
import { loadTeamNames } from '../teams/display-name.js';
import { competitionProfileJoin } from '../competitions/profile.js';

export {
  ANNOUNCED_DAYS,
  ANNOUNCED_PER_COUNTRY,
  countryActivity,
  exploreWindow,
  involves,
  isUpcoming,
  MAIN_SPORT,
  pickMainCompetition,
  rankTopCompetitions,
  TOP_COMPETITIONS,
  TOP_TEAMS,
  type CatalogItem,
  type WindowEvent,
} from '@galaxie/explore';

type I18n = Record<string, string>;

/** Avisos do resumo (o logger da requisição). */
type Log = Pick<FastifyBaseLogger, 'warn'>;

/**
 * Jogos da janela (`@galaxie/explore`) com o nome da competição no idioma da requisição: a agenda conta com a mesma
 * consulta do resumo e mostra o nome nas facetas.
 */
export async function selectWindowEvents(
  bctx: Pick<BuildContext, 'db' | 'now' | 'locale'>,
  where: SQL | undefined,
  sports: string[] | null,
): Promise<WindowEvent[]> {
  const rows = await selectWindowRows(bctx.db, bctx.now, where, sports);
  return rows.map((r) =>
    r.competition
      ? {
          ...r,
          competition: {
            ...r.competition,
            name: competitionName(
              r.competition.labels,
              r.competition.countryCode,
              r.competition.name ?? r.competition.slug,
              bctx.locale,
            ),
          },
        }
      : r,
  );
}

/**
 * O resumo pré-calculado, se está em dia (até `EXPLORE_MAX_AGE_MS`); senão a mesma conta feita agora. A leitura que
 * falha (tabela ainda sem a migration, banco ocupado) também cai na conta da hora.
 */
export async function exploreSnapshotFor(
  bctx: Pick<BuildContext, 'db' | 'now'>,
  geo: GeoConfig,
  log?: Log,
): Promise<{ snapshot: ExploreSnapshot; source: 'precomputed' | 'computed' }> {
  let stored: ExploreSnapshot | null = null;
  try {
    stored = await loadExploreSnapshot(bctx.db);
  } catch (err) {
    log?.warn({ err }, 'resumo do Explorar: leitura do pré-calculado falhou; calculando na requisição');
  }
  const ageMs = stored ? bctx.now.getTime() - stored.generatedAt.getTime() : null;
  if (stored && ageMs !== null && ageMs <= EXPLORE_MAX_AGE_MS)
    return { snapshot: stored, source: 'precomputed' };
  if (stored)
    log?.warn(
      { age_seconds: Math.round(ageMs! / 1000), generated_at: stored.generatedAt.toISOString() },
      'resumo do Explorar pré-calculado com mais de 30 min (job explore-summary parado?); calculando na requisição',
    );
  else
    log?.warn(
      'resumo do Explorar sem pré-cálculo (job explore-summary ainda não rodou?); calculando na requisição',
    );
  return { snapshot: await computeExploreSnapshot(bctx.db, geo, bctx.now), source: 'computed' };
}

interface TeamRow extends Record<string, unknown> {
  id: string;
  name: string;
  short_name: string | null;
  storage_key: string | null;
  source_url: string | null;
  palette: AssetPalette | null;
}

/**
 * Monta o resumo. `sports` é a restrição do plano do tenant (null = todos): limita os jogos contados e os
 * destaques; o catálogo (competições, participantes) é o mesmo para todos, como em /v1/navigation.
 */
export async function loadExploreSummary(
  bctx: BuildContext,
  geo: GeoConfig,
  sports: string[] | null,
  assetsBaseUrl: string | undefined,
  log?: Log,
): Promise<ExploreSummary> {
  const { db, locale } = bctx;
  const codes = geo.navigationCountries;
  const { snapshot } = await exploreSnapshotFor(bctx, geo, log);
  const selection = selectForScope(snapshot, codes, sports);

  const competitionIds = [
    ...new Set([
      ...[...selection.sports.values()].flatMap((s) => s.topCompetitions),
      ...[...selection.countries.values()].flatMap((c) => (c.mainCompetition ? [c.mainCompetition] : [])),
    ]),
  ];
  const teamIds = [...new Set([...selection.countries.values()].flatMap((c) => c.topTeams))];
  const highlightIds = [
    ...new Set(
      [...selection.countries.values()].flatMap((c) => [
        ...(c.highlight ? [c.highlight.id] : []),
        ...c.announced.map((a) => a.id),
      ]),
    ),
  ];

  // só leituras por id (e as tabelas pequenas de esportes e países): a conta já veio pronta
  const [sportRows, competitionRows, countryRows, teamRows, built] = await Promise.all([
    db
      .select({ slug: sport.slug, name: sport.name })
      .from(sport)
      .where(notInArray(sport.slug, [...OFF_CATALOG_SPORTS])),
    competitionIds.length
      ? db
          .select({
            id: competition.id,
            sport: competition.sport,
            slug: competition.slug,
            name: competition.name,
            labels: competition.labels,
            countryCode: competition.countryCode,
            profileLabels: competitionProfile.labels,
            type: competition.type,
            tier: competition.tier,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
          })
          .from(competition)
          .leftJoin(competitionProfile, competitionProfileJoin(bctx.minReview ?? 'approved'))
          .leftJoin(asset, eq(asset.id, competitionLogoId(bctx.customLogos)))
          .where(inArray(competition.id, competitionIds))
      : Promise.resolve([]),
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
      .where(inArray(country.code, codes)),
    teamsById(bctx, teamIds),
    highlightIds.length ? buildEvents(bctx, highlightIds) : Promise.resolve([]),
  ]);
  const dtoBy = new Map(built.map((b) => [b.dto.id, b.dto]));

  // ── competições
  const competitionBy = new Map(
    competitionRows.map((c): [string, ExploreCompetition] => [
      c.id,
      {
        id: c.id,
        slug: c.slug,
        sport: c.sport,
        name: competitionName(
          { ...(c.labels ?? {}), ...(c.profileLabels ?? {}) } as I18n,
          c.countryCode,
          c.name,
          locale,
        ),
        type: c.type,
        tier: c.tier,
        logo: assetUrl(assetsBaseUrl, c.logoKey, c.logoUrl),
      },
    ]),
  );
  const competitionsOf = (ids: string[]) => ids.flatMap((id) => competitionBy.get(id) ?? []);

  // ── esportes
  const sportName = new Map(sportRows.map((s) => [s.slug, s.name as I18n]));
  const navSports = [
    ...geo.navigationSports,
    ...sportRows
      .filter((s) => !geo.navigationSports.some((n) => n.slug === s.slug))
      .map((s) => ({ slug: s.slug, name: s.name as I18n })),
  ];
  const sportsDto: ExploreSummary['sports'] = navSports.map((s) => {
    const entry = sportOf(selection, s.slug);
    return {
      slug: s.slug,
      name: pickText({ ...(s.name as I18n), ...sportName.get(s.slug) }, locale, s.slug)!,
      competitions: entry.competitions,
      participants: entry.participants,
      upcoming: entry.upcoming,
      live: entry.live,
      top_competitions: competitionsOf(entry.topCompetitions),
    };
  });

  // ── países
  const dbCountry = new Map(countryRows.map((r) => [r.code, r]));
  const teamNames = await loadTeamNames(bctx.db, teamIds, {
    locale,
    minReview: bctx.minReview ?? 'approved',
  });
  const teamBy = new Map(
    teamRows.map((t): [string, ExploreTeam] => [
      t.id,
      {
        id: t.id,
        ...teamNames.of(t.id, t.name),
        short_name: t.short_name,
        logo: assetUrl(assetsBaseUrl, t.storage_key, t.source_url),
        colors: teamColors(t.palette),
      },
    ]),
  );
  const confederationRef = (code: string) => {
    const c = geo.confederation(code);
    return { code, name: c ? pickText(c.name as I18n, locale, code)! : code };
  };
  /** O evento do card com a relevância do mercado do país e os textos no idioma pedido. */
  const withRelevance = (code: string, candidate: CountryCandidate): Event | null => {
    const dto = dtoBy.get(candidate.id);
    if (!dto) return null;
    const comp = candidate.competition;
    const continental = comp
      ? continentalSlugs(geo, code).find((c) => c.sport === comp.sport && c.slug === comp.slug)
      : undefined;
    const { details, ...relevance } = candidate.relevance;
    return {
      ...structuredClone(dto),
      relevance: {
        ...relevance,
        reasons: [...relevance.reasons],
        details: details.map((d) => reasonDto({ ...d, teams: [] }, locale, { teams: [], continental })),
      },
    };
  };
  const countriesDto: ExploreSummary['countries'] = codes.map((code) => {
    const cfg = geo.country(code);
    const row = dbCountry.get(code);
    const c = selection.countries.get(code)!;
    const main = c.mainCompetition ? competitionBy.get(c.mainCompetition) : undefined;
    return {
      code,
      name: pickText(
        { ...(cfg?.name as I18n | undefined), ...(row?.name as I18n | undefined) },
        locale,
        code,
      )!,
      flag: assetUrl(assetsBaseUrl, row?.storageKey, row?.sourceUrl),
      confederation: confederationRef(row?.confederation ?? cfg?.confederation ?? 'FIFA'),
      competitions: c.competitions,
      main_competition: main ?? null,
      top_teams: c.topTeams.flatMap((id) => teamBy.get(id) ?? []),
      upcoming: c.upcoming,
      live: c.live,
      highlight: c.highlight ? withRelevance(code, c.highlight) : null,
      announced: c.announced.flatMap((a) => withRelevance(code, a) ?? []),
    };
  });
  const confederations: ExploreSummary['confederations'] = [];
  for (const c of countriesDto) {
    let section = confederations.find((s) => s.code === c.confederation.code);
    if (!section) confederations.push((section = { ...c.confederation, countries: [] }));
    section.countries.push(c.code);
  }

  return {
    generated_at: selection.generatedAt.toISOString(),
    window: { from: selection.window.from.toISOString(), to: selection.window.to.toISOString() },
    sports: sportsDto,
    countries: countriesDto,
    confederations,
  };
}

/** Clubes em destaque por id, com o escudo (acervo do tenant) e as cores. */
async function teamsById(bctx: BuildContext, ids: string[]): Promise<TeamRow[]> {
  if (!ids.length) return [];
  const rows = await bctx.db.execute<TeamRow>(sql`
    select p.id::text as id, p.name, p.short_name, a.storage_key, a.source_url, a.palette
      from core.participant p
      left join core.asset a on a.id = ${logoIdSql('p', bctx.customLogos)}
     where p.id in (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})`);
  return [...rows];
}
