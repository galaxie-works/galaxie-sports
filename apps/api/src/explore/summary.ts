/**
 * Resumo da home "Explorar" (docs/05 §3.1.2): contadores por esporte e por país, competições e clubes em
 * destaque e o jogo de maior relevância de cada país, montados com poucas consultas em lote (nenhuma por
 * esporte ou por país). As escolhas (destaques, liga principal, jogo do país) são funções puras, testadas
 * à parte; o carregamento só junta as linhas do banco.
 */
import { and, count, eq, gte, inArray, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  EXPLORE_WINDOW_DAYS,
  type Event,
  type EventRelevance,
  type ExploreCompetition,
  type ExploreSummary,
  type ExploreTeam,
} from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  country,
  event,
  eventParticipant,
  participant,
  sport,
  type AssetPalette,
} from '@galaxie/db';
import type { GeoConfig, MarketAudience } from '@galaxie/geo';
import { buildEvents, type BuildContext } from '../events/builder.js';
import { actuallyLiveCond, IN_PLAY } from '../events/queries.js';
import {
  audienceOf,
  continentalSlugs,
  marketBonus,
  reasonDto,
  type ContinentalEntry,
} from '../events/relevance.js';
import { pickText } from '../i18n.js';
import { teamColors } from '../teams/colors.js';
import { assetUrl } from '../util.js';
import { OFF_CATALOG_SPORTS } from '../off-catalog.js';

type I18n = Record<string, string>;

const DAY_MS = 24 * 3600_000;
/** Competições em destaque por esporte e clubes em destaque por país. */
export const TOP_COMPETITIONS = 4;
export const TOP_TEAMS = 5;
/** A liga principal (e os clubes em destaque) do país vêm deste esporte. */
export const MAIN_SPORT = 'football';
/** Jogos que não contam como "próximos". */
const NOT_UPCOMING = new Set(['postponed', 'cancelled', 'abandoned', 'finished']);
/** Jogos anunciados (provisórios) de cada país: até quantos e com quanta antecedência. */
export const ANNOUNCED_PER_COUNTRY = 2;
export const ANNOUNCED_DAYS = 90;

// ─── escolhas (funções puras) ────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  sport: string;
  slug: string;
  type: ExploreCompetition['type'];
  tier: number;
  prestige: number;
  countryCode: string | null;
  /** Jogos nos últimos 12 meses (e no mês seguinte). */
  recent: number;
}

/**
 * Competições em destaque de um esporte: as que tiveram jogos recentes primeiro (uma Euro sem edição no
 * ano não ocupa a vitrine), depois menor tier, maior prestígio e mais jogos.
 */
export function rankTopCompetitions<T extends CatalogItem>(items: T[], limit = TOP_COMPETITIONS): T[] {
  return [...items]
    .sort(
      (a, b) =>
        Number(b.recent > 0) - Number(a.recent > 0) ||
        a.tier - b.tier ||
        b.prestige - a.prestige ||
        b.recent - a.recent ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, limit);
}

/**
 * Liga principal do país: só ligas (não copas), menor tier, a ordem de `featured` (config/geo) e, fora
 * dela, a com mais jogos recentes.
 */
export function pickMainCompetition<T extends CatalogItem>(
  items: T[],
  featuredOrder: (sport: string, slug: string) => number | null,
): T | null {
  const order = (c: T) => featuredOrder(c.sport, c.slug) ?? Number.MAX_SAFE_INTEGER;
  const leagues = items.filter((c) => c.type === 'league');
  return (
    [...leagues].sort(
      (a, b) => a.tier - b.tier || order(a) - order(b) || b.recent - a.recent || a.slug.localeCompare(b.slug),
    )[0] ?? null
  );
}

export interface WindowEvent {
  id: string;
  sport: string;
  status: string;
  startsAt: Date;
  importance: number;
  /** Em andamento de fato (status de jogo e dado fresco, como em /v1/events/live). */
  live: boolean;
  competition: { sport: string; slug: string; countryCode: string | null } | null;
  participantIds: string[];
  participantCountries: (string | null)[];
}

/** O jogo envolve o país? (competição do país ou participante do país, como `/v1/events?country=`). */
export function involves(e: WindowEvent, code: string): boolean {
  return e.competition?.countryCode === code || e.participantCountries.includes(code);
}

export function isUpcoming(e: WindowEvent, from: Date, to: Date): boolean {
  return !NOT_UPCOMING.has(e.status) && e.startsAt >= from && e.startsAt < to;
}

export interface CountryActivity {
  upcoming: number;
  live: number;
  /** Próximo jogo de maior relevância no mercado do país. */
  highlight: { id: string; relevance: EventRelevance } | null;
}

/** Desempate do destaque: clubes em destaque do país e a liga principal. */
export interface HighlightPreference {
  teams: ReadonlySet<string>;
  main: { sport: string; slug: string } | null;
}

/**
 * Jogos, ao vivo e o destaque de um país a partir dos jogos da janela. O destaque é o de maior relevância
 * no mercado (bônus de docs/06 §3.2); como a relevância empata muito (toda rodada da liga soma o mesmo
 * bônus), desempata por clubes em destaque envolvidos, jogo da liga principal e, por fim, o mais cedo.
 * O bônus de semifinal (outro lado da chave) fica de fora: o resumo não carrega as chaves.
 */
export function countryActivity(
  events: WindowEvent[],
  code: string,
  window: { from: Date; to: Date },
  continental: ReadonlySet<string>,
  prefer: HighlightPreference = { teams: new Set(), main: null },
  texts: { locale: string; continental: ContinentalEntry[] } = { locale: 'pt-BR', continental: [] },
  audience?: MarketAudience | null,
): CountryActivity {
  let upcoming = 0;
  let live = 0;
  const appeal = (e: WindowEvent) => [
    e.participantIds.filter((id) => prefer.teams.has(id)).length,
    Number(
      !!prefer.main && e.competition?.sport === prefer.main.sport && e.competition.slug === prefer.main.slug,
    ),
  ];
  let best: { e: WindowEvent; relevance: EventRelevance; appeal: number[] } | null = null;
  for (const e of events) {
    if (!involves(e, code)) continue;
    if (e.live) live += 1;
    if (!isUpcoming(e, window.from, window.to)) continue;
    upcoming += 1;
    const candidate = {
      e,
      relevance: marketRelevance(e, code, continental, texts, audience),
      appeal: appeal(e),
    };
    if (!best || compareHighlight(candidate, best) < 0) best = candidate;
  }
  return { upcoming, live, highlight: best ? { id: best.e.id, relevance: best.relevance } : null };
}

/** Relevância do jogo no mercado do país (bônus de docs/06 §3.2 e audiência, sem o da outra semifinal). */
function marketRelevance(
  e: WindowEvent,
  code: string,
  continental: ReadonlySet<string>,
  texts: { locale: string; continental: ContinentalEntry[] },
  audience: MarketAudience | null | undefined,
): EventRelevance {
  const { bonus, reasons, details } = marketBonus(
    code,
    { participantCountries: e.participantCountries, competition: e.competition },
    continental,
    audienceOf(audience, code, e.competition, e.importance),
  );
  const comp = e.competition;
  const vars = {
    teams: [],
    continental: comp
      ? texts.continental.find((c) => c.sport === comp.sport && c.slug === comp.slug)
      : undefined,
  };
  return {
    market: code,
    score: Math.min(100, e.importance + bonus),
    bonus,
    reasons,
    details: details.map((d) => reasonDto(d, texts.locale, vars)),
  };
}

/**
 * Jogos anunciados (provisórios: oficiais, ainda sem o fornecedor) que envolvem o país, do mais cedo ao
 * mais tarde, sem o destaque da janela (que já aparece no card).
 */
export function countryAnnounced(
  provisional: WindowEvent[],
  code: string,
  now: Date,
  continental: ReadonlySet<string>,
  exclude: string | null,
  texts: { locale: string; continental: ContinentalEntry[] } = { locale: 'pt-BR', continental: [] },
  audience?: MarketAudience | null,
): { id: string; relevance: EventRelevance }[] {
  return provisional
    .filter((e) => e.id !== exclude && involves(e, code) && !NOT_UPCOMING.has(e.status) && e.startsAt >= now)
    .sort((a, b) => +a.startsAt - +b.startsAt || a.id.localeCompare(b.id))
    .slice(0, ANNOUNCED_PER_COUNTRY)
    .map((e) => ({ id: e.id, relevance: marketRelevance(e, code, continental, texts, audience) }));
}

function compareHighlight(
  a: { e: WindowEvent; relevance: EventRelevance; appeal: number[] },
  b: { e: WindowEvent; relevance: EventRelevance; appeal: number[] },
): number {
  return (
    b.relevance.score - a.relevance.score ||
    b.appeal[0]! - a.appeal[0]! ||
    b.appeal[1]! - a.appeal[1]! ||
    +a.e.startsAt - +b.e.startsAt ||
    a.e.id.localeCompare(b.e.id)
  );
}

// ─── carregamento ────────────────────────────────────────────────────────────────────────────────

interface TeamRow extends Record<string, unknown> {
  id: string;
  country_code: string;
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
): Promise<ExploreSummary> {
  const { db, locale, now } = bctx;
  const window = { from: now, to: new Date(now.getTime() + EXPLORE_WINDOW_DAYS * DAY_MS) };
  const recentFrom = new Date(now.getTime() - 365 * DAY_MS);
  const recentTo = new Date(now.getTime() + 30 * DAY_MS);
  const codes = geo.navigationCountries;
  const inPlan = sports ? inArray(event.sport, sports) : undefined;
  // jogos com o país da competição e dos participantes (uma linha por jogo)
  const eventRows = (where: SQL | undefined) =>
    db
      .select({
        id: event.id,
        sport: event.sport,
        status: event.status,
        startsAt: event.startsAt,
        importance: event.importance,
        live: sql<boolean>`${actuallyLiveCond(now)}`,
        compSport: competition.sport,
        compSlug: competition.slug,
        compCountry: competition.countryCode,
        participantIds: sql<(string | null)[]>`array_agg(${participant.id})`,
        countries: sql<(string | null)[]>`array_agg(${participant.countryCode})`,
      })
      .from(event)
      .leftJoin(competition, eq(competition.id, event.competitionId))
      .leftJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
      .leftJoin(participant, eq(participant.id, eventParticipant.participantId))
      .where(and(where, inPlan))
      .groupBy(event.id, competition.id);

  const [
    sportRows,
    participantCounts,
    catalogRows,
    recentRows,
    countryRows,
    windowRows,
    teamRows,
    provisionalRows,
  ] = await Promise.all([
    db
      .select({ slug: sport.slug, name: sport.name })
      .from(sport)
      .where(notInArray(sport.slug, [...OFF_CATALOG_SPORTS])),
    db.select({ sport: participant.sport, n: count() }).from(participant).groupBy(participant.sport),
    db
      .select({
        id: competition.id,
        sport: competition.sport,
        slug: competition.slug,
        name: competition.name,
        labels: competition.labels,
        profileLabels: competitionProfile.labels,
        type: competition.type,
        tier: competition.tier,
        prestige: competition.prestige,
        countryCode: competition.countryCode,
        logoKey: asset.storageKey,
        logoUrl: asset.sourceUrl,
      })
      .from(competition)
      .leftJoin(competitionProfile, eq(competitionProfile.competitionId, competition.id))
      .leftJoin(asset, eq(asset.id, competition.logoAssetId))
      .where(lte(competition.tier, 2)),
    db
      .select({ id: event.competitionId, n: count() })
      .from(event)
      .where(and(gte(event.startsAt, recentFrom), lt(event.startsAt, recentTo)))
      .groupBy(event.competitionId),
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
    // jogos da janela e os em andamento
    eventRows(
      or(
        and(gte(event.startsAt, window.from), lt(event.startsAt, window.to)),
        inArray(event.status, IN_PLAY),
      ),
    ),
    topTeams(bctx, codes, now, recentFrom),
    // anunciados: provisórios dos próximos meses (o fornecedor ainda não publicou)
    eventRows(
      and(
        eq(event.isProvisional, true),
        gte(event.startsAt, now),
        lt(event.startsAt, new Date(now.getTime() + ANNOUNCED_DAYS * DAY_MS)),
      ),
    ),
  ]);

  // ── catálogo: destaques por esporte, liga principal e contagem por país
  const recent = new Map(recentRows.map((r) => [r.id, Number(r.n)]));
  const catalog = catalogRows.map((r) => ({ ...r, recent: recent.get(r.id) ?? 0 }));
  type Catalog = (typeof catalog)[number];
  const competitionDto = (c: Catalog): ExploreCompetition => ({
    id: c.id,
    slug: c.slug,
    sport: c.sport,
    name: pickText({ ...(c.labels ?? {}), ...(c.profileLabels ?? {}) } as I18n, locale, c.name)!,
    type: c.type,
    tier: c.tier,
    logo: assetUrl(assetsBaseUrl, c.logoKey, c.logoUrl),
  });
  const mainBy = new Map(
    codes.map((code) => [
      code,
      pickMainCompetition(
        catalog.filter((c) => c.sport === MAIN_SPORT && c.countryCode === code),
        (s, slug) => geo.featuredOrder(s, slug),
      ),
    ]),
  );

  // ── jogos: ao vivo e próximos por esporte e por país, e o destaque de cada país
  const windowEvent = (r: (typeof windowRows)[number]): WindowEvent => ({
    id: r.id,
    sport: r.sport,
    status: r.status,
    startsAt: r.startsAt,
    importance: r.importance,
    live: IN_PLAY.includes(r.status) && r.live,
    competition: r.compSlug ? { sport: r.compSport!, slug: r.compSlug, countryCode: r.compCountry } : null,
    participantIds: (r.participantIds ?? []).filter((id): id is string => !!id),
    participantCountries: (r.countries ?? []).filter((c): c is string => !!c),
  });
  const events = windowRows.map(windowEvent);
  const provisional = provisionalRows.map(windowEvent);
  const activity = new Map(
    codes.map((code) => {
      const continental = continentalSlugs(geo, code);
      return [
        code,
        countryActivity(
          events,
          code,
          window,
          new Set(continental.map((c) => `${c.sport}|${c.slug}`)),
          {
            teams: new Set(teamRows.filter((t) => t.country_code === code).map((t) => t.id)),
            main: mainBy.get(code) ?? null,
          },
          { locale, continental },
          geo.audience,
        ),
      ] as const;
    }),
  );
  const announced = new Map(
    codes.map((code) => {
      const continental = continentalSlugs(geo, code);
      return [
        code,
        countryAnnounced(
          provisional,
          code,
          now,
          new Set(continental.map((c) => `${c.sport}|${c.slug}`)),
          activity.get(code)?.highlight?.id ?? null,
          { locale, continental },
          geo.audience,
        ),
      ] as const;
    }),
  );
  const highlightIds = [
    ...new Set([
      ...[...activity.values()].flatMap((a) => (a.highlight ? [a.highlight.id] : [])),
      ...[...announced.values()].flatMap((list) => list.map((a) => a.id)),
    ]),
  ];
  const built = highlightIds.length ? await buildEvents(bctx, highlightIds) : [];
  const dtoBy = new Map(built.map((b) => [b.dto.id, b.dto]));

  // ── esportes
  const sportName = new Map(sportRows.map((s) => [s.slug, s.name as I18n]));
  const participantsBy = new Map(participantCounts.map((r) => [r.sport, Number(r.n)]));
  const navSports = [
    ...geo.navigationSports,
    ...sportRows
      .filter((s) => !geo.navigationSports.some((n) => n.slug === s.slug))
      .map((s) => ({ slug: s.slug, name: s.name as I18n })),
  ];
  const sportsDto: ExploreSummary['sports'] = navSports.map((s) => {
    const own = catalog.filter((c) => c.sport === s.slug);
    const evs = events.filter((e) => e.sport === s.slug);
    return {
      slug: s.slug,
      name: pickText({ ...(s.name as I18n), ...sportName.get(s.slug) }, locale, s.slug)!,
      competitions: own.length,
      participants: participantsBy.get(s.slug) ?? 0,
      upcoming: evs.filter((e) => isUpcoming(e, window.from, window.to)).length,
      live: evs.filter((e) => e.live).length,
      top_competitions: rankTopCompetitions(own).map(competitionDto),
    };
  });

  // ── países
  const dbCountry = new Map(countryRows.map((r) => [r.code, r]));
  const teamsBy = new Map<string, ExploreTeam[]>();
  for (const t of teamRows) {
    const list = teamsBy.get(t.country_code) ?? [];
    list.push({
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      logo: assetUrl(assetsBaseUrl, t.storage_key, t.source_url),
      colors: teamColors(t.palette),
    });
    teamsBy.set(t.country_code, list);
  }
  const confederationRef = (code: string) => {
    const c = geo.confederation(code);
    return { code, name: c ? pickText(c.name as I18n, locale, code)! : code };
  };
  const countriesDto: ExploreSummary['countries'] = codes.map((code) => {
    const cfg = geo.country(code);
    const row = dbCountry.get(code);
    const act = activity.get(code)!;
    const main = mainBy.get(code);
    const dto = act.highlight ? dtoBy.get(act.highlight.id) : undefined;
    const highlight: Event | null =
      dto && act.highlight ? { ...structuredClone(dto), relevance: act.highlight.relevance } : null;
    return {
      code,
      name: pickText(
        { ...(cfg?.name as I18n | undefined), ...(row?.name as I18n | undefined) },
        locale,
        code,
      )!,
      flag: assetUrl(assetsBaseUrl, row?.storageKey, row?.sourceUrl),
      confederation: confederationRef(row?.confederation ?? cfg?.confederation ?? 'FIFA'),
      competitions: catalog.filter((c) => c.countryCode === code).length,
      main_competition: main ? competitionDto(main) : null,
      top_teams: teamsBy.get(code) ?? [],
      upcoming: act.upcoming,
      live: act.live,
      highlight,
      announced: (announced.get(code) ?? []).flatMap((a) => {
        const d = dtoBy.get(a.id);
        return d ? [{ ...structuredClone(d), relevance: a.relevance }] : [];
      }),
    };
  });
  const confederations: ExploreSummary['confederations'] = [];
  for (const c of countriesDto) {
    let section = confederations.find((s) => s.code === c.confederation.code);
    if (!section) confederations.push((section = { ...c.confederation, countries: [] }));
    section.countries.push(c.code);
  }

  return {
    generated_at: now.toISOString(),
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    sports: sportsDto,
    countries: countriesDto,
    confederations,
  };
}

/**
 * Clubes em destaque de cada país (no esporte da liga principal), numa consulta: os da base semântica
 * primeiro (os grandes, curados), depois a soma da importância dos jogos dos últimos 12 meses.
 */
async function topTeams(bctx: BuildContext, codes: string[], now: Date, from: Date): Promise<TeamRow[]> {
  if (!codes.length) return [];
  const rows = await bctx.db.execute<TeamRow>(sql`
    select r.id::text as id, r.country_code, r.name, r.short_name,
           a.storage_key, a.source_url, a.palette
      from (select p.id, p.country_code, p.name, p.short_name, p.logo_asset_id,
                   row_number() over (
                     partition by p.country_code
                     order by exists (select 1 from semantic.team_profile tp where tp.participant_id = p.id) desc,
                              sum(e.importance) desc, p.name) as rn
              from core.event e
              join core.event_participant ep on ep.event_id = e.id
              join core.participant p on p.id = ep.participant_id
             where e.starts_at >= ${from.toISOString()}::timestamptz
               and e.starts_at < ${now.toISOString()}::timestamptz
               and p.kind = 'club'
               and p.sport = ${MAIN_SPORT}
               and p.country_code in (${sql.join(
                 codes.map((c) => sql`${c}`),
                 sql`, `,
               )})
             group by p.id) r
      left join core.asset a on a.id = r.logo_asset_id
     where r.rn <= ${TOP_TEAMS}
     order by r.country_code, r.rn`);
  return [...rows];
}
