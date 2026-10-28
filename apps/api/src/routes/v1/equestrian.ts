/**
 * Hipismo — `/v1/equestrian/*` (docs/13-hipismo.md §5), módulo `core_data`.
 *
 * Tudo vem do schema `equestrian`. A API não interpreta placar além do que a importação já separou com segurança:
 * `null` = não publicado (nunca zero), o bruto acompanha, cada linha traz `source`, e cobertura parcial é sempre
 * sinalizada. A categoria segue fora da oferta comercial até o licenciamento (`notice`).
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as z from 'zod';
import {
  EqAthletesQuery,
  EqChampionshipParams,
  EqCompetitionsQuery,
  EqHorsesQuery,
  EqIdParams,
  EqResultsQuery,
  LocaleQuery,
  type EqAthleteDetail,
  type EqAthleteSummary,
  type EqChampionship,
  type EqCompetitionDetail,
  type EqCompetitionSummary,
  type EqCountry,
  type EqHorseDetail,
  type EqOverview,
  type EqResult,
  type SupportedLocale,
} from '@galaxie/contracts';
import {
  asset,
  country,
  eqAthlete,
  eqCompetition,
  eqHorse,
  eqHorseOwner,
  eqImportRun,
  eqRankingObservation,
  eqResult,
  eqRound,
  eqSourceDisagreement,
  eqTeamResult,
  noc,
  type Database,
} from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { pickText, resolveLocale } from '../../i18n.js';
import { assetUrl, decodeCursor, encodeCursor, likeEscape, parseInput } from '../../util.js';

const MODULE = { module: 'core_data' } as const;
type Locale = SupportedLocale;
type I18n = Record<string, string> | null;

/** Códigos FEI/COI da América Latina (destaques e filtro `latam`). */
const LATAM = [
  'ARG',
  'BRA',
  'CHI',
  'URU',
  'PAR',
  'BOL',
  'PER',
  'ECU',
  'COL',
  'VEN',
  'MEX',
  'GUA',
  'CRC',
  'PAN',
  'DOM',
  'PUR',
  'CUB',
  'ESA',
  'HON',
  'NCA',
];
/** Atletas em destaque fixo na página do esporte (pedido editorial), antes do ranking por resultados recentes. */
const FEATURED_FEI_IDS = ['10000380'];

/** Nomes dos campeonatos com rodadas documentadas. */
const CHAMPIONSHIPS: Record<string, { pt: string; es: string; en: string }> = {
  athens_2004_jumping: {
    pt: 'Jogos Olímpicos Atenas 2004 — Saltos',
    es: 'Juegos Olímpicos Atenas 2004 — Salto',
    en: 'Athens 2004 Olympic Games — Jumping',
  },
  jerez_2002_jumping: {
    pt: 'Jogos Equestres Mundiais Jerez 2002 — Saltos',
    es: 'Juegos Ecuestres Mundiales Jerez 2002 — Salto',
    en: 'Jerez 2002 World Equestrian Games — Jumping',
  },
};

const tr = (locale: Locale, t: { pt: string; es: string; en?: string }) =>
  locale.startsWith('es') ? t.es : t.pt;

export function notice(locale: Locale, license: string | null): EqAthleteDetail['notice'] {
  return {
    license: license ?? 'unknown',
    commercial: false,
    message: tr(locale, {
      pt:
        'Estamos buscando o licenciamento com a FEI e com as federações, mas os processos e acessos são ' +
        'extremamente difíceis e caros. Por isso, o hipismo não faz parte das ofertas da Galaxie no momento, ' +
        'mas pode ser cotado caso haja interesse do parceiro.',
      es:
        'Estamos gestionando el licenciamiento con la FEI y las federaciones, pero los procesos y accesos son ' +
        'extremadamente difíciles y costosos. Por eso, la hípica no forma parte de la oferta de Galaxie por el ' +
        'momento, pero puede cotizarse si hay interés del socio.',
    }),
  };
}

const COVERAGE_NOTE = {
  complete: {
    pt: 'Todas as páginas de resultados exibidas pela fonte foram lidas. Isso não garante a carreira inteira.',
    es: 'Se leyeron todas las páginas de resultados que muestra la fuente. Eso no garantiza la carrera completa.',
  },
  partial: {
    pt: 'Histórico incompleto: só parte das páginas de resultados da fonte foi lida.',
    es: 'Historial incompleto: solo se leyó parte de las páginas de resultados de la fuente.',
  },
  not_collected: {
    pt: 'Histórico não coletado: o atleta aparece apenas em classificações de provas presentes na base.',
    es: 'Historial no recolectado: el atleta aparece solo en clasificaciones de pruebas presentes en la base.',
  },
} as const;

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | string | null | undefined) =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : d;
const OffsetCursor = z.object({ o: z.number().int().min(0) });
// `d` vai para o SQL como ::date: só data ISO válida (cursor forjado → 400, não 500)
const KeysetCursor = z.object({ d: z.iso.date(), id: z.uuid() });

// ─── países (FEI/COI → ISO, nome e bandeira) ─────────────────────────────────────────────────────

export type CountryInfo = { iso2: string | null; name: I18n; flag: string | null };
let countryCache: { at: number; map: Map<string, CountryInfo> } | null = null;

async function countries(db: Database, assetsBaseUrl: string | undefined): Promise<Map<string, CountryInfo>> {
  if (countryCache && Date.now() - countryCache.at < 3600_000) return countryCache.map;
  const [nocs, rows] = await Promise.all([
    db.select({ code: noc.code, iso2: noc.iso2, name: noc.name, flagUrl: noc.flagUrl }).from(noc),
    db
      .select({
        code: country.code,
        ioc: country.iocCode,
        name: country.name,
        storageKey: asset.storageKey,
        sourceUrl: asset.sourceUrl,
      })
      .from(country)
      .leftJoin(asset, eq(asset.id, country.flagAssetId)),
  ]);
  const byIso = new Map(rows.map((r) => [r.code, r]));
  const map = new Map<string, CountryInfo>();
  for (const n of nocs) {
    const c = n.iso2 ? byIso.get(n.iso2) : undefined;
    map.set(n.code, {
      iso2: c ? c.code : (n.iso2 ?? null),
      name: (c?.name as I18n) ?? (n.name as I18n),
      flag: c ? assetUrl(assetsBaseUrl, c.storageKey, c.sourceUrl) : (n.flagUrl ?? null),
    });
  }
  for (const r of rows)
    if (r.ioc && !map.has(r.ioc))
      map.set(r.ioc, {
        iso2: r.code,
        name: r.name as I18n,
        flag: assetUrl(assetsBaseUrl, r.storageKey, r.sourceUrl),
      });
  countryCache = { at: Date.now(), map };
  return map;
}

export function countryRef(
  map: Map<string, CountryInfo>,
  code: string | null | undefined,
  locale: Locale,
): EqCountry | null {
  if (!code) return null;
  const c = map.get(code);
  return {
    code,
    iso2: c?.iso2 ?? null,
    name: c ? pickText(c.name, locale, code) : null,
    flag_url: c?.flag ?? null,
  };
}

// ─── carga de referências ────────────────────────────────────────────────────────────────────────

type AthleteRow = typeof eqAthlete.$inferSelect;
type HorseRow = typeof eqHorse.$inferSelect;
type CompetitionRow = typeof eqCompetition.$inferSelect;
type ResultRow = typeof eqResult.$inferSelect;

interface Ctx {
  db: Database;
  locale: Locale;
  countries: Map<string, CountryInfo>;
}

const athleteRef = (c: Ctx, a: AthleteRow) => ({
  id: a.id,
  fei_id: a.feiId,
  name: a.displayName,
  country: countryRef(c.countries, a.competingFor, c.locale),
});

const bornYear = (h: HorseRow) => (h.birthDate ? Number(h.birthDate.slice(0, 4)) : null);
const horseRef = (h: HorseRow) => ({
  id: h.id,
  fei_id: h.feiId,
  name: h.name,
  breed: h.breed,
  born_year: bornYear(h),
  age: bornYear(h) === null ? null : new Date().getUTCFullYear() - bornYear(h)!,
  profile: (h.profileStatus === 'detailed' ? 'detailed' : 'pending') as 'detailed' | 'pending',
});

const competitionRef = (c: Ctx, k: CompetitionRow) => ({
  id: k.id,
  name: k.name,
  level: k.level,
  stars: k.stars,
  date: k.date,
  venue: k.venue,
  country: countryRef(c.countries, k.countryCode, c.locale),
  height_cm: k.heightCm,
  is_grand_prix: k.isGrandPrix,
});

async function byIds<T extends { id: string }>(
  db: Database,
  table: typeof eqAthlete | typeof eqHorse | typeof eqCompetition,
  ids: (string | null)[],
): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = (await db.select().from(table).where(inArray(table.id, unique))) as unknown as T[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function resultsOut(c: Ctx, rows: ResultRow[]): Promise<EqResult[]> {
  const [athletes, horses, comps] = await Promise.all([
    byIds<AthleteRow>(
      c.db,
      eqAthlete,
      rows.map((r) => r.athleteId),
    ),
    byIds<HorseRow>(
      c.db,
      eqHorse,
      rows.map((r) => r.horseId),
    ),
    byIds<CompetitionRow>(
      c.db,
      eqCompetition,
      rows.map((r) => r.competitionId),
    ),
  ]);
  return rows.map((r) => {
    const a = r.athleteId ? athletes.get(r.athleteId) : undefined;
    const h = r.horseId ? horses.get(r.horseId) : undefined;
    const k = r.competitionId ? comps.get(r.competitionId) : undefined;
    return {
      id: r.id,
      kind: r.sourceKind as EqResult['kind'],
      date: r.date,
      competition: k ? competitionRef(c, k) : null,
      athlete: a ? athleteRef(c, a) : null,
      athlete_name_as_published: r.athleteNameAsPublished,
      horse: h ? horseRef(h) : null,
      horse_name_as_published: r.horseNameAsPublished,
      country: countryRef(c.countries, r.countryCode, c.locale),
      country_basis: r.countryBasis,
      position: r.position,
      position_raw: r.positionRaw,
      status: r.status,
      score: {
        raw: r.scoreRaw,
        parse_status: r.scoreParseStatus,
        penalties: num(r.penalties),
        penalties_jumping: num(r.penaltiesJumping),
        penalties_time: num(r.penaltiesTime),
        time_seconds: num(r.timeSeconds),
        parts:
          r.scoreParts?.map((p) => ({ sequence: p.sequence, raw: p.raw, kind: p.kind, value: p.value })) ??
          null,
      },
      rounds_raw: r.roundCells ?? null,
      published_breakdown:
        r.publishedBreakdown?.map((b) => ({
          label: b.label,
          value: b.value,
          rank: b.rank,
          source_url: b.sourceUrl,
          source_pdf_page: b.sourcePdfPage,
        })) ?? null,
      prize:
        r.prizeAmount !== null || r.prizeRaw
          ? { amount: num(r.prizeAmount), currency: r.prizeCurrency, raw: r.prizeRaw }
          : null,
      quality_flags: r.qualityFlags ?? null,
      source: { provider: r.source, kind: r.sourceKind, url: r.sourceUrl, observed_at: iso(r.observedAt) },
    };
  });
}

async function latestLicense(
  db: Database,
): Promise<{ license: string | null; run: typeof eqImportRun.$inferSelect | null }> {
  const [run] = await db.select().from(eqImportRun).orderBy(desc(eqImportRun.startedAt)).limit(1);
  return { license: run?.license ?? null, run: run ?? null };
}

async function rankingsOut(c: Ctx, where?: SQL) {
  const rows = await c.db
    .select()
    .from(eqRankingObservation)
    .where(where)
    .orderBy(asc(eqRankingObservation.rankingName), asc(eqRankingObservation.rank));
  const [athletes, horses] = await Promise.all([
    byIds<AthleteRow>(
      c.db,
      eqAthlete,
      rows.map((r) => r.athleteId),
    ),
    byIds<HorseRow>(
      c.db,
      eqHorse,
      rows.map((r) => r.horseId),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    ranking: r.rankingName,
    athlete: r.athleteId && athletes.get(r.athleteId) ? athleteRef(c, athletes.get(r.athleteId)!) : null,
    horse: r.horseId && horses.get(r.horseId) ? horseRef(horses.get(r.horseId)!) : null,
    horse_name_as_published: r.horseNameAsPublished,
    rank: r.rank,
    rank_raw: r.rankRaw,
    points: num(r.points),
    edition: r.edition,
    coverage: r.coverage,
    source: {
      provider: r.source,
      kind: 'ranking_observation',
      url: r.sourceUrl,
      observed_at: iso(r.observedAt),
    },
  }));
}

async function disagreementsOut(c: Ctx, where: SQL) {
  const rows = await c.db.select().from(eqSourceDisagreement).where(where);
  const athletes = await byIds<AthleteRow>(
    c.db,
    eqAthlete,
    rows.map((r) => r.athleteId),
  );
  return rows.map((d) => ({
    id: d.id,
    event_key: d.eventKey,
    field: d.field,
    athlete: d.athleteId && athletes.get(d.athleteId) ? athleteRef(c, athletes.get(d.athleteId)!) : null,
    values: d.values,
    resolution: d.resolution,
  }));
}

/** Resumos de atletas (resultados, período, cavalos e vitórias) para listas e destaques. */
async function athleteSummaries(c: Ctx, where: SQL | undefined, order: SQL[], limit: number, offset: number) {
  const stats = c.db
    .select({
      athleteId: eqResult.athleteId,
      results: sql<number>`count(*)::int`.as('results'),
      first: sql<string | null>`min(${eqResult.date})::text`.as('first'),
      last: sql<string | null>`max(${eqResult.date})::text`.as('last'),
      horses: sql<number>`count(distinct ${eqResult.horseId})::int`.as('horses'),
      wins: sql<number>`count(*) filter (where ${eqResult.position} = 1)::int`.as('wins'),
    })
    .from(eqResult)
    .groupBy(eqResult.athleteId)
    .as('s');
  const rows = await c.db
    .select({
      a: eqAthlete,
      results: stats.results,
      first: stats.first,
      last: stats.last,
      horses: stats.horses,
      wins: stats.wins,
    })
    .from(eqAthlete)
    .leftJoin(stats, eq(stats.athleteId, eqAthlete.id))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  return rows.map((r): EqAthleteSummary => ({
    ...athleteRef(c, r.a),
    history_coverage: r.a.historyCoverage,
    results: r.results ?? 0,
    first_result: r.first ?? null,
    last_result: r.last ?? null,
    horses: r.horses ?? 0,
    wins: r.wins ?? 0,
  }));
}

async function competitionSummaries(c: Ctx, where: SQL | undefined, limit: number, offset: number) {
  const counts = c.db
    .select({
      competitionId: eqResult.competitionId,
      entries: sql<number>`count(*)::int`.as('entries'),
      latam: sql<number>`count(*) filter (where ${inArray(eqResult.countryCode, LATAM)})::int`.as('latam'),
    })
    .from(eqResult)
    .groupBy(eqResult.competitionId)
    .as('n');
  const rows = await c.db
    .select({ k: eqCompetition, entries: counts.entries, latam: counts.latam })
    .from(eqCompetition)
    .leftJoin(counts, eq(counts.competitionId, eqCompetition.id))
    .where(where)
    .orderBy(
      sql`${eqCompetition.date} desc nulls last`,
      desc(eqCompetition.allEntriesObserved),
      asc(eqCompetition.name),
    )
    .limit(limit)
    .offset(offset);
  return rows.map((r): EqCompetitionSummary => ({
    ...competitionRef(c, r.k),
    level_kind: r.k.levelKind,
    judging: r.k.judging,
    article: r.k.articleCode,
    show: r.k.showStart || r.k.showEnd ? { start: r.k.showStart, end: r.k.showEnd } : null,
    prize:
      r.k.prizeTotal !== null || r.k.prizeTotalRaw
        ? { total: num(r.k.prizeTotal), currency: r.k.prizeCurrency, raw: r.k.prizeTotalRaw }
        : null,
    entries_in_base: r.entries ?? 0,
    latam_entries: r.latam ?? 0,
    all_entries_observed: r.k.allEntriesObserved,
  }));
}

const pageOf = <T>(rows: T[], limit: number, offset: number) => ({
  data: rows.slice(0, limit),
  next_cursor: rows.length > limit ? encodeCursor({ o: offset + limit }) : null,
});

// ─── rotas ───────────────────────────────────────────────────────────────────────────────────────

export async function equestrianRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const localeOf = (request: FastifyRequest, query: { locale?: Locale | undefined }) =>
    resolveLocale(query.locale, request.headers['accept-language']);
  const context = async (locale: Locale): Promise<Ctx> => {
    const db = requireDb(ctx);
    return { db, locale, countries: await countries(db, ctx.assetsBaseUrl) };
  };

  // ─── resumo ──────────────────────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/overview', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const { db } = c;
        const { license, run } = await latestLicense(db);
        const [cov] = await db
          .select({
            complete: sql<number>`count(*) filter (where ${eqAthlete.historyCoverage} = 'complete')::int`,
            partial: sql<number>`count(*) filter (where ${eqAthlete.historyCoverage} = 'partial')::int`,
            notCollected: sql<number>`count(*) filter (where ${eqAthlete.historyCoverage} = 'not_collected')::int`,
          })
          .from(eqAthlete);
        const byCountry = await db
          .select({
            code: eqResult.countryCode,
            athletes: sql<number>`count(distinct ${eqResult.athleteId})::int`,
            results: sql<number>`count(*)::int`,
            first: sql<string | null>`min(${eqResult.date})::text`,
            last: sql<string | null>`max(${eqResult.date})::text`,
          })
          .from(eqResult)
          .where(
            and(
              inArray(eqResult.countryCode, LATAM),
              eq(eqResult.countryBasis, 'current_profile_representation'),
            ),
          )
          .groupBy(eqResult.countryCode)
          .orderBy(desc(sql`count(*)`));
        const [horses] = await db
          .select({
            detailed: sql<number>`count(*) filter (where ${eqHorse.profileStatus} = 'detailed')::int`,
            pending: sql<number>`count(*) filter (where ${eqHorse.profileStatus} <> 'detailed')::int`,
          })
          .from(eqHorse);
        const [comps] = await db
          .select({
            total: sql<number>`count(*)::int`,
            full: sql<number>`count(*) filter (where ${eqCompetition.allEntriesObserved})::int`,
          })
          .from(eqCompetition);
        const [totals] = await db
          .select({
            results: sql<number>`(select count(*) from ${eqResult})::int`,
            rounds: sql<number>`(select count(*) from ${eqRound})::int`,
          })
          .from(sql`(select 1) as one`);

        const featured = await athleteSummaries(
          c,
          inArray(eqAthlete.feiId, FEATURED_FEI_IDS),
          [asc(eqAthlete.displayName)],
          10,
          0,
        );
        const since = new Date(Date.now() - 730 * 86400_000).toISOString().slice(0, 10);
        const recentWins = c.db
          .select({
            athleteId: eqResult.athleteId,
            wins: sql<number>`count(*) filter (where ${eqResult.position} = 1)`.as('wins'),
            podiums: sql<number>`count(*) filter (where ${eqResult.position} <= 3)`.as('podiums'),
          })
          .from(eqResult)
          .where(sql`${eqResult.date} >= ${since}`)
          .groupBy(eqResult.athleteId)
          .as('w');
        const top = await db
          .select({ id: eqAthlete.id })
          .from(eqAthlete)
          .innerJoin(recentWins, eq(recentWins.athleteId, eqAthlete.id))
          .where(
            and(inArray(eqAthlete.competingFor, ['BRA', 'ARG']), eq(eqAthlete.historyCoverage, 'complete')),
          )
          .orderBy(desc(recentWins.wins), desc(recentWins.podiums))
          .limit(8);
        const topIds = top.map((t) => t.id).filter((id) => !featured.some((f) => f.id === id));
        const topRows = topIds.length
          ? await athleteSummaries(c, inArray(eqAthlete.id, topIds), [asc(eqAthlete.displayName)], 8, 0)
          : [];
        const highlights = [
          ...featured,
          ...topIds.map((id) => topRows.find((r) => r.id === id)!).filter(Boolean),
        ];

        const recent = await competitionSummaries(
          c,
          sql`exists (select 1 from ${eqResult} r where r.competition_id = ${eqCompetition.id} and r.country_code in (${sql.join(
            LATAM.map((x) => sql`${x}`),
            sql`, `,
          )}))`,
          8,
          0,
        );

        const champs = await db
          .select({
            key: eqRound.eventKey,
            start: sql<string | null>`min(${eqRound.eventStart})::text`,
            rounds: sql<number>`count(*)::int`,
          })
          .from(eqRound)
          .groupBy(eqRound.eventKey)
          .orderBy(desc(sql`min(${eqRound.eventStart})`));

        const body: EqOverview = {
          notice: notice(locale, license),
          dataset: {
            provider: run?.source ?? 'unknown',
            package: run?.packageName ?? null,
            package_sha256: run?.packageSha256 ?? null,
            imported_at: iso(run?.finishedAt ?? run?.startedAt ?? null),
          },
          coverage: {
            athletes: {
              complete: cov?.complete ?? 0,
              partial: cov?.partial ?? 0,
              not_collected: cov?.notCollected ?? 0,
            },
            by_country: byCountry
              .filter((r) => r.code)
              .map((r) => ({
                country: countryRef(c.countries, r.code, locale)!,
                athletes: r.athletes,
                results: r.results,
                first: r.first,
                last: r.last,
              })),
            horses: { detailed: horses?.detailed ?? 0, pending: horses?.pending ?? 0 },
            competitions: { total: comps?.total ?? 0, full_standings: comps?.full ?? 0 },
            results: totals?.results ?? 0,
            rounds: totals?.rounds ?? 0,
            note: tr(locale, {
              pt:
                'Base parcial para construir e validar o produto: não é um censo dos países nem de todos os anos. ' +
                'Classificação geral e rodada são registros distintos; dado ausente não é zero.',
              es:
                'Base parcial para construir y validar el producto: no es un censo de los países ni de todos los años. ' +
                'Clasificación general y ronda son registros distintos; un dato ausente no es cero.',
            }),
          },
          highlights,
          recent_competitions: recent,
          championships: champs.map((ch) => ({
            key: ch.key,
            name: CHAMPIONSHIPS[ch.key] ? tr(locale, CHAMPIONSHIPS[ch.key]!) : ch.key,
            start: ch.start,
            rounds: ch.rounds,
          })),
          rankings: await rankingsOut(c),
        };
        return { body, tags: ['equestrian'] };
      },
    });
  });

  // ─── atletas ─────────────────────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/athletes', { config: MODULE }, async (request, reply) => {
    const query = parseInput(EqAthletesQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    const offset = query.cursor ? decodeCursor(OffsetCursor, query.cursor).o : 0;
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const conds: SQL[] = [];
        if (query.country) conds.push(inArray(eqAthlete.competingFor, query.country));
        if (query.coverage) conds.push(eq(eqAthlete.historyCoverage, query.coverage));
        if (query.q)
          conds.push(
            or(
              // `%` e `_` do texto da busca são literais (sem curinga que varre a tabela)
              ilike(eqAthlete.displayName, `%${likeEscape(query.q)}%`),
              ilike(eqAthlete.nameAsPublished, `%${likeEscape(query.q)}%`),
              eq(eqAthlete.feiId, query.q),
            )!,
          );
        const rows = await athleteSummaries(
          c,
          and(...conds),
          [
            sql`case ${eqAthlete.historyCoverage} when 'complete' then 0 when 'partial' then 1 else 2 end`,
            sql`results desc nulls last`,
            asc(eqAthlete.displayName),
          ],
          query.limit + 1,
          offset,
        );
        return { body: pageOf(rows, query.limit, offset), tags: ['equestrian'] };
      },
    });
  });

  app.get('/v1/equestrian/athletes/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EqIdParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const { db } = c;
        const [a] = await db.select().from(eqAthlete).where(eq(eqAthlete.id, params.id));
        if (!a) throw problems.notFound('Atleta');
        const { license } = await latestLicense(db);
        const [stats] = await db
          .select({
            results: sql<number>`count(*)::int`,
            classified: sql<number>`count(*) filter (where ${eqResult.status} = 'classified')::int`,
            wins: sql<number>`count(*) filter (where ${eqResult.position} = 1)::int`,
            podiums: sql<number>`count(*) filter (where ${eqResult.position} between 1 and 3)::int`,
            first: sql<string | null>`min(${eqResult.date})::text`,
            last: sql<string | null>`max(${eqResult.date})::text`,
          })
          .from(eqResult)
          .where(eq(eqResult.athleteId, a.id));
        const byYear = await db
          .select({
            year: sql<number>`extract(year from ${eqResult.date})::int`,
            results: sql<number>`count(*)::int`,
            wins: sql<number>`count(*) filter (where ${eqResult.position} = 1)::int`,
          })
          .from(eqResult)
          .where(and(eq(eqResult.athleteId, a.id), isNotNull(eqResult.date)))
          .groupBy(sql`1`)
          .orderBy(sql`1`);
        const prizes = await db
          .select({
            currency: eqResult.prizeCurrency,
            amount: sql<string>`sum(${eqResult.prizeAmount})`,
            results: sql<number>`count(*)::int`,
          })
          .from(eqResult)
          .where(
            and(
              eq(eqResult.athleteId, a.id),
              isNotNull(eqResult.prizeAmount),
              isNotNull(eqResult.prizeCurrency),
            ),
          )
          .groupBy(eqResult.prizeCurrency);
        const horseStats = await db
          .select({
            horseId: eqResult.horseId,
            results: sql<number>`count(*)::int`,
            first: sql<string | null>`min(${eqResult.date})::text`,
            last: sql<string | null>`max(${eqResult.date})::text`,
            best: sql<number | null>`min(${eqResult.position})`,
          })
          .from(eqResult)
          .where(and(eq(eqResult.athleteId, a.id), isNotNull(eqResult.horseId)))
          .groupBy(eqResult.horseId)
          .orderBy(desc(sql`max(${eqResult.date})`));
        const horses = await byIds<HorseRow>(
          db,
          eqHorse,
          horseStats.map((h) => h.horseId),
        );
        const rounds = await db
          .select({ key: eqRound.eventKey, n: sql<number>`count(*)::int` })
          .from(eqRound)
          .where(eq(eqRound.athleteId, a.id))
          .groupBy(eqRound.eventKey);
        const coverage = a.historyCoverage as keyof typeof COVERAGE_NOTE;
        const body: EqAthleteDetail = {
          ...athleteRef(c, a),
          name_as_published: a.nameAsPublished,
          gender: a.gender,
          birth_date: a.birthDate,
          nationality: a.nationality,
          registry_status: a.registryStatusRaw,
          coverage: {
            history: coverage,
            displayed_total_raw: a.displayedTotalRaw,
            collected_results: a.collectedResults,
            results_in_base: stats?.results ?? 0,
            note: tr(locale, COVERAGE_NOTE[coverage]),
          },
          stats: {
            results: stats?.results ?? 0,
            classified: stats?.classified ?? 0,
            wins: stats?.wins ?? 0,
            podiums: stats?.podiums ?? 0,
            first_result: stats?.first ?? null,
            last_result: stats?.last ?? null,
            by_year: byYear,
            prize_by_currency: prizes.map((p) => ({
              currency: p.currency!,
              amount: Number(p.amount),
              results: p.results,
            })),
          },
          horses: horseStats
            .filter((h) => h.horseId && horses.has(h.horseId))
            .map((h) => ({
              ...horseRef(horses.get(h.horseId!)!),
              results: h.results,
              first: h.first,
              last: h.last,
              best_position: h.best === null ? null : Number(h.best),
            })),
          rankings: await rankingsOut(c, eq(eqRankingObservation.athleteId, a.id)),
          rounds: rounds.reduce((s, r) => s + r.n, 0),
          championships: rounds.map((r) => ({
            key: r.key,
            name: CHAMPIONSHIPS[r.key] ? tr(locale, CHAMPIONSHIPS[r.key]!) : r.key,
            rounds: r.n,
          })),
          disagreements: await disagreementsOut(c, eq(eqSourceDisagreement.athleteId, a.id)),
          source: {
            provider: a.source,
            kind: 'athlete_profile',
            url: a.sourceUrl,
            observed_at: iso(a.observedAt),
          },
          notice: notice(locale, license),
        };
        return { body, tags: ['equestrian'] };
      },
    });
  });

  // ─── cavalos ─────────────────────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/horses', { config: MODULE }, async (request, reply) => {
    const query = parseInput(EqHorsesQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    const offset = query.cursor ? decodeCursor(OffsetCursor, query.cursor).o : 0;
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const conds: SQL[] = [];
        if (query.q)
          conds.push(
            or(ilike(eqHorse.name, `%${likeEscape(query.q)}%`), eq(eqHorse.feiId, query.q.toUpperCase()))!,
          );
        if (query.detailed === 'true') conds.push(eq(eqHorse.profileStatus, 'detailed'));
        const stats = c.db
          .select({
            horseId: eqResult.horseId,
            results: sql<number>`count(*)::int`.as('results'),
            riders: sql<number>`count(distinct ${eqResult.athleteId})::int`.as('riders'),
            last: sql<string | null>`max(${eqResult.date})::text`.as('last'),
          })
          .from(eqResult)
          .groupBy(eqResult.horseId)
          .as('s');
        const rows = await c.db
          .select({ h: eqHorse, results: stats.results, riders: stats.riders, last: stats.last })
          .from(eqHorse)
          .leftJoin(stats, eq(stats.horseId, eqHorse.id))
          .where(and(...conds))
          .orderBy(sql`results desc nulls last`, asc(eqHorse.name))
          .limit(query.limit + 1)
          .offset(offset);
        const data = rows.map((r) => ({
          ...horseRef(r.h),
          results: r.results ?? 0,
          riders: r.riders ?? 0,
          last_result: r.last ?? null,
        }));
        return { body: pageOf(data, query.limit, offset), tags: ['equestrian'] };
      },
    });
  });

  app.get('/v1/equestrian/horses/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EqIdParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const { db } = c;
        const [h] = await db.select().from(eqHorse).where(eq(eqHorse.id, params.id));
        if (!h) throw problems.notFound('Cavalo');
        const { license } = await latestLicense(db);
        const owners = await db
          .select()
          .from(eqHorseOwner)
          .where(eq(eqHorseOwner.horseId, h.id))
          .orderBy(asc(eqHorseOwner.ownerName));
        const riders = await db
          .select({
            athleteId: eqResult.athleteId,
            results: sql<number>`count(*)::int`,
            first: sql<string | null>`min(${eqResult.date})::text`,
            last: sql<string | null>`max(${eqResult.date})::text`,
          })
          .from(eqResult)
          .where(and(eq(eqResult.horseId, h.id), isNotNull(eqResult.athleteId)))
          .groupBy(eqResult.athleteId)
          .orderBy(desc(sql`max(${eqResult.date})`));
        const athletes = await byIds<AthleteRow>(
          db,
          eqAthlete,
          riders.map((r) => r.athleteId),
        );
        const [stats] = await db
          .select({
            results: sql<number>`count(*)::int`,
            wins: sql<number>`count(*) filter (where ${eqResult.position} = 1)::int`,
            podiums: sql<number>`count(*) filter (where ${eqResult.position} between 1 and 3)::int`,
          })
          .from(eqResult)
          .where(eq(eqResult.horseId, h.id));
        const body: EqHorseDetail = {
          ...horseRef(h),
          birth_name: h.birthName,
          birth_date: h.birthDate,
          gender: h.gender,
          color: h.color,
          studbook: h.studbook,
          breeder: h.breeder,
          sire: h.sire,
          dam: h.dam,
          dam_sire: h.damSire,
          birth_country: h.birthCountry,
          admin_nf: h.adminNf,
          owners: owners.map((o) => ({
            name: o.ownerName,
            nationality: o.nationality,
            since_raw: o.sinceRaw,
            percentage_raw: o.percentageRaw,
          })),
          riders: riders
            .filter((r) => r.athleteId && athletes.has(r.athleteId))
            .map((r) => ({
              ...athleteRef(c, athletes.get(r.athleteId!)!),
              results: r.results,
              first: r.first,
              last: r.last,
            })),
          stats: { results: stats?.results ?? 0, wins: stats?.wins ?? 0, podiums: stats?.podiums ?? 0 },
          rankings: await rankingsOut(c, eq(eqRankingObservation.horseId, h.id)),
          source: {
            provider: h.source,
            kind: 'horse_profile',
            url: h.sourceUrl,
            observed_at: iso(h.observedAt),
          },
          notice: notice(locale, license),
        };
        return { body, tags: ['equestrian'] };
      },
    });
  });

  // ─── histórico de resultados ─────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/results', { config: MODULE }, async (request, reply) => {
    const query = parseInput(EqResultsQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    const after = query.cursor ? decodeCursor(KeysetCursor, query.cursor) : null;
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const dateKey = sql`coalesce(${eqResult.date}, '0001-01-01'::date)`;
        const conds: SQL[] = [];
        if (query.athlete) conds.push(eq(eqResult.athleteId, query.athlete));
        if (query.horse) conds.push(eq(eqResult.horseId, query.horse));
        if (query.competition) conds.push(eq(eqResult.competitionId, query.competition));
        if (query.country) conds.push(inArray(eqResult.countryCode, query.country));
        if (query.from) conds.push(sql`${eqResult.date} >= ${query.from}`);
        if (query.to) conds.push(sql`${eqResult.date} <= ${query.to}`);
        if (query.status) conds.push(eq(eqResult.status, query.status));
        if (query.podium === 'true') conds.push(sql`${eqResult.position} between 1 and 3`);
        if (query.event_country || query.level) {
          const kc: SQL[] = [sql`k.id = ${eqResult.competitionId}`];
          if (query.event_country)
            kc.push(
              sql`k.country_code in (${sql.join(
                query.event_country.map((x) => sql`${x}`),
                sql`, `,
              )})`,
            );
          if (query.level) kc.push(sql`k.level ilike ${`${query.level}%`}`);
          conds.push(sql`exists (select 1 from ${eqCompetition} k where ${sql.join(kc, sql` and `)})`);
        }
        if (after) conds.push(sql`(${dateKey}, ${eqResult.id}) < (${after.d}::date, ${after.id}::uuid)`);
        const rows = await c.db
          .select()
          .from(eqResult)
          .where(and(...conds))
          .orderBy(desc(dateKey), desc(eqResult.id))
          .limit(query.limit + 1);
        const pageRows = rows.slice(0, query.limit);
        const last = pageRows.at(-1);
        return {
          body: {
            data: await resultsOut(c, pageRows),
            next_cursor:
              rows.length > query.limit && last
                ? encodeCursor({ d: last.date ?? '0001-01-01', id: last.id })
                : null,
          },
          tags: ['equestrian'],
        };
      },
    });
  });

  // ─── provas ──────────────────────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/competitions', { config: MODULE }, async (request, reply) => {
    const query = parseInput(EqCompetitionsQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    const offset = query.cursor ? decodeCursor(OffsetCursor, query.cursor).o : 0;
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const conds: SQL[] = [];
        if (query.from) conds.push(sql`${eqCompetition.date} >= ${query.from}`);
        if (query.to) conds.push(sql`${eqCompetition.date} <= ${query.to}`);
        if (query.country) conds.push(inArray(eqCompetition.countryCode, query.country));
        if (query.level) conds.push(ilike(eqCompetition.level, `${likeEscape(query.level)}%`));
        if (query.full === 'true') conds.push(eq(eqCompetition.allEntriesObserved, true));
        if (query.latam === 'true')
          conds.push(
            sql`exists (select 1 from ${eqResult} r where r.competition_id = ${eqCompetition.id} and r.country_code in (${sql.join(
              LATAM.map((x) => sql`${x}`),
              sql`, `,
            )}))`,
          );
        const rows = await competitionSummaries(c, and(...conds), query.limit + 1, offset);
        return { body: pageOf(rows, query.limit, offset), tags: ['equestrian'] };
      },
    });
  });

  app.get('/v1/equestrian/competitions/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EqIdParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const [summary] = await competitionSummaries(c, eq(eqCompetition.id, params.id), 1, 0);
        if (!summary) throw problems.notFound('Prova');
        const [k] = await c.db.select().from(eqCompetition).where(eq(eqCompetition.id, params.id));
        const { license } = await latestLicense(c.db);
        const rows = await c.db
          .select()
          .from(eqResult)
          .where(eq(eqResult.competitionId, params.id))
          .orderBy(
            sql`${eqResult.position} asc nulls last`,
            sql`case ${eqResult.status} when 'classified' then 0 when 'RET' then 1 when 'EL' then 2 when 'WD' then 3 else 4 end`,
            asc(eqResult.athleteNameAsPublished),
          );
        const [hasRounds] = k!.showKey
          ? await c.db
              .select({ n: sql<number>`count(*)::int` })
              .from(eqRound)
              .where(eq(eqRound.eventKey, k!.showKey))
          : [{ n: 0 }];
        const body: EqCompetitionDetail = {
          ...summary,
          article_text: k!.articleText,
          schedule_number: k!.scheduleNumber,
          fei_reference_code: k!.feiReferenceCode,
          completeness: {
            all_entries_observed: k!.allEntriesObserved,
            displayed_entries: k!.displayedEntries,
            entries_in_base: rows.length,
            note: k!.allEntriesObserved
              ? tr(locale, {
                  pt: 'Classificação completa lida na fonte.',
                  es: 'Clasificación completa leída en la fuente.',
                })
              : tr(locale, {
                  pt: 'Classificação parcial: só os conjuntos presentes na base aparecem.',
                  es: 'Clasificación parcial: solo aparecen los binomios presentes en la base.',
                }),
          },
          standings: await resultsOut(c, rows),
          championship_key: k!.showKey && (hasRounds?.n ?? 0) > 0 ? k!.showKey : null,
          source: {
            provider: k!.source,
            kind: 'competition',
            url: k!.sourceUrl,
            observed_at: iso(k!.observedAt),
          },
          notice: notice(locale, license),
        };
        return { body, tags: ['equestrian'] };
      },
    });
  });

  // ─── campeonatos com rodadas documentadas ───────────────────────────────────────────────────
  app.get('/v1/equestrian/championships/:key', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EqChampionshipParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        const { db } = c;
        const rounds = await db
          .select()
          .from(eqRound)
          .where(eq(eqRound.eventKey, params.key))
          // etapas em ordem cronológica (sem data por etapa, a ordem do nome); dentro da etapa, pela posição publicada
          .orderBy(
            sql`${eqRound.date} asc nulls last`,
            asc(eqRound.stage),
            sql`case when ${eqRound.rankRaw} ~ '^[0-9]+$' then ${eqRound.rankRaw}::int end asc nulls last`,
            asc(eqRound.athleteNameAsPublished),
          );
        const teams = await db
          .select()
          .from(eqTeamResult)
          .where(eq(eqTeamResult.eventKey, params.key))
          .orderBy(sql`${eqTeamResult.position} asc nulls last`, asc(eqTeamResult.countryCode));
        if (!rounds.length && !teams.length) throw problems.notFound('Campeonato');
        const { license } = await latestLicense(db);
        const [comp] = await db
          .select({ id: eqCompetition.id })
          .from(eqCompetition)
          .where(eq(eqCompetition.showKey, params.key))
          .limit(1);
        const [athletes, horses] = await Promise.all([
          byIds<AthleteRow>(
            db,
            eqAthlete,
            rounds.map((r) => r.athleteId),
          ),
          byIds<HorseRow>(
            db,
            eqHorse,
            rounds.map((r) => r.horseId),
          ),
        ]);
        const stageMap = new Map<string, { stage: string; date: string | null; observations: number }>();
        for (const r of rounds) {
          const s = stageMap.get(r.stage) ?? { stage: r.stage, date: r.date, observations: 0 };
          s.observations++;
          stageMap.set(r.stage, s);
        }
        const meta = CHAMPIONSHIPS[params.key];
        const body: EqChampionship = {
          key: params.key,
          name: meta ? tr(locale, meta) : params.key,
          start: rounds[0]?.eventStart ?? null,
          end: rounds[0]?.eventEnd ?? null,
          competition_id: comp?.id ?? null,
          stages: [...stageMap.values()],
          rounds: rounds.map((r) => ({
            id: r.id,
            event_key: r.eventKey,
            stage: r.stage,
            date: r.date,
            date_precision: r.datePrecision,
            athlete:
              r.athleteId && athletes.get(r.athleteId) ? athleteRef(c, athletes.get(r.athleteId)!) : null,
            athlete_name_as_published: r.athleteNameAsPublished,
            horse: r.horseId && horses.get(r.horseId) ? horseRef(horses.get(r.horseId)!) : null,
            horse_name_as_published: r.horseNameAsPublished,
            country: countryRef(c.countries, r.countryCode, locale),
            bib: r.bib,
            rank_raw: r.rankRaw,
            status: r.status,
            penalties_jumping: num(r.penaltiesJumping),
            penalties_time: num(r.penaltiesTime),
            score: num(r.score),
            score_raw: r.scoreRaw,
            score_semantics: r.scoreSemantics,
            time_seconds: num(r.timeSeconds),
            source: {
              provider: r.source,
              kind: 'documented_round',
              url: r.sourceUrl,
              observed_at: iso(r.observedAt),
              pdf_page: r.sourcePdfPage,
            },
          })),
          teams: teams.map((t) => ({
            id: t.id,
            country: countryRef(c.countries, t.countryCode, locale)!,
            position: t.position,
            position_raw: t.positionRaw,
            score_raw: t.scoreRaw,
            members: (t.members ?? []).map((m) => ({
              athlete_fei_id: m.athleteFeiId,
              athlete_name: m.athleteName,
              horse_fei_id: m.horseFeiId,
              horse_name: m.horseName,
              individual_position_raw: m.individualPositionRaw,
              ...(m.scores ? { scores: m.scores } : {}),
            })),
            arithmetic: t.arithmetic ?? null,
            source: {
              provider: t.source,
              kind: 'team_result',
              url: t.sourceUrl,
              observed_at: iso(t.observedAt),
            },
          })),
          disagreements: await disagreementsOut(c, eq(eqSourceDisagreement.eventKey, params.key)),
          notice: notice(locale, license),
        };
        return { body, tags: ['equestrian'] };
      },
    });
  });

  // ─── rankings observados ─────────────────────────────────────────────────────────────────────
  app.get('/v1/equestrian/rankings', { config: MODULE }, async (request, reply) => {
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const c = await context(locale);
        return { body: { data: await rankingsOut(c) }, tags: ['equestrian'] };
      },
    });
  });
}
