import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as z from 'zod';
import {
  GamesEventParams,
  GamesListQuery,
  GamesNocParams,
  GamesParams,
  LocaleQuery,
  MedalHistoryQuery,
  MedalsQuery,
  ScheduleQuery,
  TodayQuery,
  type Delegation,
  type GamesDetail,
  type GamesSummary,
  type MedalDataQuality,
  type MedalHistory,
  type MedalTable,
  type MsEventDetail,
  type NocToday,
  type ScheduleUnit,
  type SupportedLocale,
} from '@galaxie/contracts';
import {
  competition,
  discipline,
  games,
  gamesCompetition,
  LATAM_NOCS,
  medal,
  MEDAL_SOURCE_LICENSES,
  medalTable,
  msEvent,
  msParticipant,
  msPerson,
  msSport,
  noc,
  season,
  phase,
  result,
  teamMember,
  unit,
  type Database,
} from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, pickText, resolveLocale } from '../../i18n.js';
import { decodeCursor, encodeCursor, parseInput, UUID_RE } from '../../util.js';

const MODULE = { module: 'multisport' } as const;

type GamesRow = typeof games.$inferSelect;
type Locale = SupportedLocale;
type I18n = Record<string, string> | null;

/** Selos que permitem publicar quadro/ranking (docs/08 §6.4). */
const PUBLISHABLE = new Set(['complete', 'partial']);

/**
 * TTL do quadro conforme o estado da edição (docs/05 §7): encerrada muda só com nova carga/QA (24 h + purge);
 * em andamento segue o ritmo de "onde assistir" (60 s); futura, 1 h.
 */
function medalsTtl(g: GamesRow): number {
  if (g.status === 'in_progress') return CACHE_TTL.whereToWatch;
  if (g.status === 'upcoming') return CACHE_TTL.standings;
  return CACHE_TTL.catalog;
}

/** Colunas da view do quadro (views não entram aninhadas no select). */
const MT_COLS = {
  nocCode: medalTable.nocCode,
  gold: medalTable.gold,
  silver: medalTable.silver,
  bronze: medalTable.bronze,
  total: medalTable.total,
  rankByGold: medalTable.rankByGold,
  rankByTotal: medalTable.rankByTotal,
};

// `s` vai para o SQL como timestamptz: só ISO 8601 válido (cursor forjado → 400, não 500)
const ScheduleCursor = z.object({ s: z.iso.datetime().nullable(), i: z.string().regex(UUID_RE) });

// ─── qualidade de dados ──────────────────────────────────────────────────────────────────────────

/** Selo de qualidade do quadro, com o aviso localizado (pt-BR ou espanhol). */
export function medalQuality(
  g: Pick<GamesRow, 'medalDataQuality' | 'medalCoverage' | 'status'>,
  locale: Locale,
): MedalDataQuality {
  const level = (g.medalDataQuality ?? null) as MedalDataQuality['level'];
  const coverage = g.medalCoverage == null ? null : Number(g.medalCoverage);
  const publishable = !!level && PUBLISHABLE.has(level);
  const pt = locale.startsWith('pt');
  let notice: string | null = null;
  if (level === 'partial') {
    const pct =
      coverage == null
        ? null
        : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(coverage);
    notice = pt
      ? `Quadro parcial${pct ? `: cobertura de ${pct} das medalhas distribuídas` : ''}.`
      : `Cuadro parcial${pct ? `: cobertura del ${pct} de las medallas entregadas` : ''}.`;
  } else if (!publishable) {
    notice =
      g.status === 'upcoming'
        ? pt
          ? 'Os Jogos ainda não começaram.'
          : 'Los Juegos todavía no comenzaron.'
        : pt
          ? 'Dados de medalhas insuficientes para publicar o quadro desta edição.'
          : 'Datos de medallas insuficientes para publicar el cuadro de esta edición.';
  }
  return { level, coverage, publishable, notice };
}

function gamesSummary(g: GamesRow, locale: Locale): GamesSummary {
  return {
    slug: g.slug,
    type: g.type,
    season: g.season,
    year: g.year,
    edition: g.edition,
    name: pickText(g.name as I18n, locale, g.slug)!,
    host_city: g.hostCity,
    host_noc: g.hostNoc,
    start_date: g.startDate,
    end_date: g.endDate,
    tz: g.tz,
    status: g.status,
    medal_data_quality: medalQuality(g, locale),
  };
}

const nocRef = (n: { code: string; name: unknown; iso2: string | null }, locale: Locale) => ({
  code: n.code,
  name: pickText(n.name as I18n, locale, n.code)!,
  iso2: n.iso2,
});

// ─── fuso e datas ────────────────────────────────────────────────────────────────────────────────

/** Offset (ms) do fuso IANA no instante dado. */
function tzOffsetMs(at: Date, tz: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/** Início e fim (UTC) do dia local `date` (YYYY-MM-DD) no fuso `tz`, com horário de verão. */
export function localDayRange(date: string, tz: string): { from: Date; to: Date } {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const midnight = (yy: number, mm: number, dd: number) => {
    const guess = Date.UTC(yy, mm - 1, dd);
    const first = guess - tzOffsetMs(new Date(guess), tz);
    return new Date(guess - tzOffsetMs(new Date(first), tz));
  };
  return { from: midnight(y, mo, d), to: midnight(y, mo, d + 1) };
}

/** Data local de hoje (YYYY-MM-DD) no fuso. */
export function todayIn(tz: string, now = new Date()): string {
  return new Date(now.getTime() + tzOffsetMs(now, tz)).toISOString().slice(0, 10);
}

// ─── consultas ───────────────────────────────────────────────────────────────────────────────────

async function findGames(db: Database, slug: string): Promise<GamesRow> {
  const [g] = await db.select().from(games).where(eq(games.slug, slug)).limit(1);
  if (!g) throw problems.notFound('Edição dos Jogos');
  return g;
}

async function findNoc(db: Database, code: string) {
  const [n] = await db.select().from(noc).where(eq(noc.code, code)).limit(1);
  if (!n) throw problems.notFound('Comitê olímpico (CON)');
  return n;
}

/** Fontes das medalhas da edição, com licença (Wikidata = CC0). */
async function medalSources(db: Database, g: GamesRow) {
  const rows = await db
    .selectDistinct({ source: medal.source })
    .from(medal)
    .innerJoin(msEvent, eq(msEvent.id, medal.eventId))
    .where(eq(msEvent.gamesId, g.id))
    .orderBy(asc(medal.source));
  return rows.map((r) => ({
    source: r.source,
    license: (MEDAL_SOURCE_LICENSES as Record<string, string>)[r.source] ?? null,
    url: r.source === 'wikidata' && g.wikidataQid ? `https://www.wikidata.org/wiki/${g.wikidataQid}` : null,
  }));
}

function selectUnits(db: Database) {
  return db
    .select({
      u: unit,
      ph: { code: phase.code, name: phase.name },
      ev: {
        id: msEvent.id,
        name: msEvent.name,
        gender: msEvent.gender,
        isTeam: msEvent.isTeam,
        gamesId: msEvent.gamesId,
      },
      d: { code: discipline.code, name: discipline.name },
      s: { code: msSport.code, name: msSport.name },
    })
    .from(unit)
    .innerJoin(phase, eq(phase.id, unit.phaseId))
    .innerJoin(msEvent, eq(msEvent.id, phase.eventId))
    .leftJoin(discipline, eq(discipline.code, msEvent.disciplineCode))
    .leftJoin(msSport, eq(msSport.code, discipline.sportCode))
    .$dynamic();
}
type UnitRow = Awaited<ReturnType<ReturnType<typeof selectUnits>['execute']>>[number];

function eventRef(
  ev: { id: string; name: unknown; gender: 'M' | 'W' | 'X' | 'O'; isTeam: boolean },
  d: { code: string; name: unknown } | null,
  s: { code: string; name: unknown } | null,
  locale: Locale,
) {
  return {
    id: ev.id,
    name: pickText(ev.name as I18n, locale, '')!,
    gender: ev.gender,
    is_team: ev.isTeam,
    discipline: d?.code
      ? {
          code: d.code,
          name: pickText(d.name as I18n, locale, d.code)!,
          sport: s?.code
            ? { code: s.code, name: pickText(s.name as I18n, locale, s.code)! }
            : { code: '', name: '' },
        }
      : null,
  };
}

function scheduleUnit(r: UnitRow, locale: Locale, tz: string): ScheduleUnit {
  return {
    id: r.u.id,
    name: r.u.name ? pickText(r.u.name as I18n, locale) : null,
    starts_at: r.u.startUtc ? formatInstant(r.u.startUtc, tz) : null,
    ends_at: r.u.endUtc ? formatInstant(r.u.endUtc, tz) : null,
    status: r.u.status,
    venue: r.u.venue,
    is_medal_unit: r.u.isMedalUnit,
    core_event_id: r.u.coreEventId,
    phase: { code: r.ph.code, name: pickText(r.ph.name as I18n, locale, r.ph.code)! },
    event: eventRef(r.ev, r.d, r.s, locale),
  };
}

/** Unidade com participação do CON (via resultados/listas de largada). */
const unitHasNoc = (code: string) =>
  sql`exists (select 1 from ${result} r join ${msParticipant} p on p.id = r.participant_id
              where r.unit_id = ${unit.id} and p.noc_code = ${code})`;

/** Nome de exibição de um participante (atleta ou equipe). */
const participantName = sql<string>`coalesce(${msPerson.fullName}, ${msParticipant.teamName}, ${msParticipant.nocCode})`;

// ─── rotas ───────────────────────────────────────────────────────────────────────────────────────

/** Rotas /v1/multisport (docs/08 §4) — módulo `multisport`. */
export async function multisportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const localeOf = (request: FastifyRequest, query: { locale?: Locale | undefined }) =>
    resolveLocale(query.locale, request.headers['accept-language']);

  // ─── /v1/multisport/games ────────────────────────────────────────────────────────────────────
  app.get('/v1/multisport/games', { config: MODULE }, async (request, reply) => {
    const query = parseInput(GamesListQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const conds: SQL[] = [];
        if (query.type) conds.push(inArray(games.type, query.type));
        if (query.year) conds.push(eq(games.year, query.year));
        if (query.season) conds.push(eq(games.season, query.season));
        if (query.status) conds.push(eq(games.status, query.status));
        const rows = await db
          .select()
          .from(games)
          .where(and(...conds))
          .orderBy(asc(games.startDate), asc(games.slug));
        return { body: { data: rows.map((g) => gamesSummary(g, locale)) }, tags: ['games'] };
      },
    });
  });

  // ─── /v1/multisport/games/:slug ──────────────────────────────────────────────────────────────
  app.get('/v1/multisport/games/:slug', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const g = await findGames(db, params.slug);
        // #78: torneios coletivos da edição já presentes no core (ligados pelo multisport:seed)
        const comps = await db
          .select({
            gc: gamesCompetition,
            c: {
              id: competition.id,
              slug: competition.slug,
              name: competition.name,
              labels: competition.labels,
            },
            s: { year: season.year, label: season.label },
          })
          .from(gamesCompetition)
          .innerJoin(competition, eq(competition.id, gamesCompetition.competitionId))
          .leftJoin(season, eq(season.id, gamesCompetition.seasonId))
          .where(eq(gamesCompetition.gamesId, g.id))
          .orderBy(asc(gamesCompetition.sport), asc(gamesCompetition.gender), asc(competition.slug));
        const body: GamesDetail = {
          ...gamesSummary(g, locale),
          competitions: comps.map((r) => ({
            id: r.c.id,
            slug: r.c.slug,
            name: pickText(r.c.labels as I18n, locale, r.c.name)!,
            sport: r.gc.sport,
            gender: r.gc.gender,
            season: r.s ? { year: r.s.year, label: r.s.label } : null,
            provider_league_id: r.gc.providerLeagueId,
          })),
        };
        return { body, tags: [`games:${g.id}`, 'competition', 'season'] };
      },
    });
  });

  // ─── /v1/multisport/games/:slug/medals ───────────────────────────────────────────────────────
  app.get('/v1/multisport/games/:slug/medals', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesParams, request.params);
    const query = parseInput(MedalsQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const g = await findGames(db, params.slug);
        const quality = medalQuality(g, locale);
        const body: MedalTable = {
          games: gamesSummary(g, locale),
          sort: query.sort,
          data_quality: quality,
          sources: await medalSources(db, g),
          data: [],
        };
        if (quality.publishable) {
          const conds: SQL[] = [eq(medalTable.gamesId, g.id)];
          if (query.region === 'latam') conds.push(inArray(medalTable.nocCode, [...LATAM_NOCS]));
          if (query.noc) conds.push(inArray(medalTable.nocCode, query.noc));
          const rankCol = query.sort === 'gold' ? medalTable.rankByGold : medalTable.rankByTotal;
          const rows = await db
            .select({ m: MT_COLS, n: { code: noc.code, name: noc.name, iso2: noc.iso2 } })
            .from(medalTable)
            .innerJoin(noc, eq(noc.code, medalTable.nocCode))
            .where(and(...conds))
            .orderBy(asc(rankCol), asc(medalTable.nocCode));
          body.data = rows.map((r) => ({
            rank: query.sort === 'gold' ? r.m.rankByGold : r.m.rankByTotal,
            noc: nocRef(r.n, locale),
            gold: r.m.gold,
            silver: r.m.silver,
            bronze: r.m.bronze,
            total: r.m.total,
            rank_by_gold: r.m.rankByGold,
            rank_by_total: r.m.rankByTotal,
          }));
        }
        return { body, tags: [`games:${g.id}`, `medal_table:${g.id}`, 'medal'], ttl: medalsTtl(g) };
      },
    });
  });

  // ─── /v1/multisport/games/:slug/schedule ─────────────────────────────────────────────────────
  app.get('/v1/multisport/games/:slug/schedule', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesParams, request.params);
    const query = parseInput(ScheduleQuery, request.query);
    const locale = localeOf(request, query);
    const cursor = query.cursor ? decodeCursor(ScheduleCursor, query.cursor) : undefined;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, query.tz ?? ''],
      load: async () => {
        const db = requireDb(ctx);
        const g = await findGames(db, params.slug);
        const tz = query.tz ?? 'UTC';
        const conds: SQL[] = [eq(msEvent.gamesId, g.id)];
        if (query.date) {
          // o dia é local: no fuso pedido ou, sem `tz`, no fuso da sede
          const { from, to } = localDayRange(query.date, query.tz ?? g.tz);
          conds.push(sql`${unit.startUtc} >= ${from.toISOString()}::timestamptz`);
          conds.push(sql`${unit.startUtc} < ${to.toISOString()}::timestamptz`);
        }
        if (query.sport)
          conds.push(or(eq(discipline.code, query.sport), eq(discipline.sportCode, query.sport))!);
        if (query.noc) conds.push(unitHasNoc(query.noc));
        if (query.medal_only) conds.push(eq(unit.isMedalUnit, true));
        const orderKey = sql`coalesce(${unit.startUtc}, 'infinity'::timestamptz)`;
        if (cursor)
          conds.push(
            sql`(${orderKey}, ${unit.id}) > (coalesce(${cursor.s}::timestamptz, 'infinity'::timestamptz), ${cursor.i}::uuid)`,
          );
        const rows = await selectUnits(db)
          .where(and(...conds))
          .orderBy(asc(orderKey), asc(unit.id))
          .limit(query.limit + 1);
        const pageRows = rows.slice(0, query.limit);
        const last = pageRows.at(-1);
        const next_cursor =
          rows.length > query.limit && last
            ? encodeCursor({ s: last.u.startUtc?.toISOString() ?? null, i: last.u.id })
            : null;
        return {
          body: { data: pageRows.map((r) => scheduleUnit(r, locale, tz)), next_cursor },
          tags: [`games:${g.id}`, 'unit'],
        };
      },
    });
  });

  // ─── /v1/multisport/games/:slug/events/:id ───────────────────────────────────────────────────
  app.get('/v1/multisport/games/:slug/events/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesEventParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz],
      load: async () => {
        const db = requireDb(ctx);
        const g = await findGames(db, params.slug);
        const [row] = await db
          .select({
            ev: msEvent,
            d: { code: discipline.code, name: discipline.name },
            s: { code: msSport.code, name: msSport.name },
          })
          .from(msEvent)
          .leftJoin(discipline, eq(discipline.code, msEvent.disciplineCode))
          .leftJoin(msSport, eq(msSport.code, discipline.sportCode))
          .where(and(eq(msEvent.id, params.id), eq(msEvent.gamesId, g.id)))
          .limit(1);
        if (!row) throw problems.notFound('Prova');

        const phases = await db
          .select()
          .from(phase)
          .where(eq(phase.eventId, row.ev.id))
          .orderBy(asc(phase.order), asc(phase.code));
        const units = phases.length
          ? await db
              .select()
              .from(unit)
              .where(
                inArray(
                  unit.phaseId,
                  phases.map((p) => p.id),
                ),
              )
              .orderBy(sql`${unit.startUtc} asc nulls last`, asc(unit.id))
          : [];
        const results = units.length
          ? await db
              .select({
                r: result,
                p: { id: msParticipant.id, kind: msParticipant.kind, noc: msParticipant.nocCode },
                name: participantName,
              })
              .from(result)
              .innerJoin(msParticipant, eq(msParticipant.id, result.participantId))
              .leftJoin(msPerson, eq(msPerson.id, msParticipant.personId))
              .where(
                inArray(
                  result.unitId,
                  units.map((u) => u.id),
                ),
              )
              .orderBy(sql`${result.rank} asc nulls last`, asc(participantName))
          : [];
        const medals = await eventMedals(db, [row.ev.id], locale);

        const body: MsEventDetail = {
          ...eventRef(
            { id: row.ev.id, name: row.ev.name, gender: row.ev.gender, isTeam: row.ev.isTeam },
            row.d,
            row.s,
            locale,
          ),
          games: { slug: g.slug, name: pickText(g.name as I18n, locale, g.slug)! },
          event_date: row.ev.eventDate,
          phases: phases.map((ph) => ({
            code: ph.code,
            name: pickText(ph.name as I18n, locale, ph.code)!,
            units: units
              .filter((u) => u.phaseId === ph.id)
              .map((u) => ({
                id: u.id,
                name: u.name ? pickText(u.name as I18n, locale) : null,
                starts_at: u.startUtc ? formatInstant(u.startUtc, tz) : null,
                ends_at: u.endUtc ? formatInstant(u.endUtc, tz) : null,
                status: u.status,
                venue: u.venue,
                is_medal_unit: u.isMedalUnit,
                core_event_id: u.coreEventId,
                results: results
                  .filter((r) => r.r.unitId === u.id)
                  .map((r) => ({
                    participant: { id: r.p.id, kind: r.p.kind, name: r.name, noc: r.p.noc },
                    rank: r.r.rank,
                    value: r.r.resultValue,
                    type: r.r.resultType,
                    irm: r.r.irm,
                    records: r.r.records ?? [],
                  })),
              })),
          })),
          medals: medals.map(({ eventId: _e, ...m }) => m),
        };
        return { body, tags: [`games:${g.id}`, `ms_event:${row.ev.id}`, 'medal', 'unit'] };
      },
    });
  });

  // ─── /v1/multisport/games/:slug/nocs/:noc/athletes ───────────────────────────────────────────
  app.get('/v1/multisport/games/:slug/nocs/:noc/athletes', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesNocParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const g = await findGames(db, params.slug);
        const n = await findNoc(db, params.noc);
        const body: Delegation = {
          games: gamesSummary(g, locale),
          noc: nocRef(n, locale),
          basis: 'medals_and_results',
          data: await delegation(db, g.id, n.code, locale),
        };
        return { body, tags: [`games:${g.id}`, 'medal', 'participant'] };
      },
    });
  });

  // ─── /v1/multisport/games/:slug/today/:noc ───────────────────────────────────────────────────
  app.get('/v1/multisport/games/:slug/today/:noc', { config: MODULE }, async (request, reply) => {
    const params = parseInput(GamesNocParams, request.params);
    const query = parseInput(TodayQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    // sem `date`, "hoje" depende do relógio: entra na chave do cache
    const db = requireDb(ctx);
    const g = await findGames(db, params.slug);
    const tz = query.tz ?? g.tz;
    const date = query.date ?? todayIn(tz);
    return sendCached(request, reply, ctx.cache, {
      ttl: g.status === 'in_progress' ? CACHE_TTL.whereToWatch : CACHE_TTL.schedule,
      vary: [locale, tz, date],
      load: async () => {
        const n = await findNoc(db, params.noc);
        const quality = medalQuality(g, locale);
        const { from, to } = localDayRange(date, tz);
        const units = await selectUnits(db)
          .where(
            and(
              eq(msEvent.gamesId, g.id),
              sql`${unit.startUtc} >= ${from.toISOString()}::timestamptz`,
              sql`${unit.startUtc} < ${to.toISOString()}::timestamptz`,
              unitHasNoc(n.code),
            ),
          )
          .orderBy(asc(unit.startUtc), asc(unit.id));
        let medals: NocToday['medals'] = [];
        if (quality.publishable) {
          const evs = await db
            .select({
              id: msEvent.id,
              name: msEvent.name,
              gender: msEvent.gender,
              isTeam: msEvent.isTeam,
              d: { code: discipline.code, name: discipline.name },
              s: { code: msSport.code, name: msSport.name },
            })
            .from(medal)
            .innerJoin(msEvent, eq(msEvent.id, medal.eventId))
            .leftJoin(discipline, eq(discipline.code, msEvent.disciplineCode))
            .leftJoin(msSport, eq(msSport.code, discipline.sportCode))
            .where(
              and(
                eq(msEvent.gamesId, g.id),
                eq(medal.nocCode, n.code),
                eq(medal.awardedAt, date),
                isNull(medal.revokedAt),
              ),
            );
          const evById = new Map(evs.map((e) => [e.id, e]));
          const list = await eventMedals(db, [...evById.keys()], locale);
          medals = list
            .filter((m) => m.noc.code === n.code && !m.revoked && m.awarded_at === date)
            .map(({ eventId, ...m }) => {
              const e = evById.get(eventId)!;
              return { ...m, event: eventRef(e, e.d, e.s, locale) };
            });
        }
        const body: NocToday = {
          games: gamesSummary(g, locale),
          noc: nocRef(n, locale),
          date,
          tz,
          units: units.map((r) => scheduleUnit(r, locale, tz)),
          medals,
          medal_data_quality: quality,
          medal_chances: null,
          where_to_watch: null,
        };
        return { body, tags: [`games:${g.id}`, `medal_table:${g.id}`, 'medal', 'unit'] };
      },
    });
  });

  // ─── /v1/multisport/history/medals ───────────────────────────────────────────────────────────
  app.get('/v1/multisport/history/medals', { config: MODULE }, async (request, reply) => {
    const query = parseInput(MedalHistoryQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const db = requireDb(ctx);
        const nocs = await db.select().from(noc).where(inArray(noc.code, query.noc)).orderBy(asc(noc.code));
        if (!nocs.length) throw problems.notFound('Comitê olímpico (CON)');
        // as edições vêm de games: a retida entra em `withheld` mesmo sem linha do CON no quadro (senão o
        // cliente não distingue "retida" de "sem participação"); as futuras ainda não são histórico
        const conds: SQL[] = [inArray(games.type, query.type), ne(games.status, 'upcoming')];
        if (query.season) conds.push(eq(games.season, query.season));
        const editions = await db
          .select()
          .from(games)
          .where(and(...conds))
          .orderBy(asc(games.year), asc(games.type), asc(games.season));
        const published = editions.filter((g) => medalQuality(g, locale).publishable);
        const tableRows = published.length
          ? await db
              .select({ gamesId: medalTable.gamesId, m: MT_COLS })
              .from(medalTable)
              .where(
                and(
                  inArray(
                    medalTable.gamesId,
                    published.map((g) => g.id),
                  ),
                  inArray(
                    medalTable.nocCode,
                    nocs.map((n) => n.code),
                  ),
                ),
              )
              .orderBy(asc(medalTable.nocCode))
          : [];
        const rows = editions.flatMap((g): { g: GamesRow; m: (typeof tableRows)[number]['m'] | null }[] => {
          const lines = tableRows.filter((r) => r.gamesId === g.id);
          return lines.length ? lines.map((r) => ({ g, m: r.m })) : [{ g, m: null }];
        });

        const body: MedalHistory = {
          nocs: nocs.map((n) => nocRef(n, locale)),
          data: [],
          totals: [],
          withheld: [],
          sources: [],
        };
        const totals = new Map<string, { gold: number; silver: number; bronze: number; total: number }>();
        const withheld = new Map<string, MedalHistory['withheld'][number]>();
        const sourceGames = new Map<string, GamesRow>();
        for (const r of rows) {
          const quality = medalQuality(r.g, locale);
          const name = pickText(r.g.name as I18n, locale, r.g.slug)!;
          if (!quality.publishable) {
            withheld.set(r.g.slug, { slug: r.g.slug, name, data_quality: quality });
            continue;
          }
          if (!r.m) continue; // edição publicada sem medalha do CON
          sourceGames.set(r.g.id, r.g);
          body.data.push({
            games: { slug: r.g.slug, type: r.g.type, season: r.g.season, year: r.g.year, name },
            noc: r.m.nocCode,
            gold: r.m.gold,
            silver: r.m.silver,
            bronze: r.m.bronze,
            total: r.m.total,
            rank_by_gold: r.m.rankByGold,
            rank_by_total: r.m.rankByTotal,
            data_quality: quality,
          });
          const t = totals.get(r.m.nocCode) ?? { gold: 0, silver: 0, bronze: 0, total: 0 };
          t.gold += r.m.gold;
          t.silver += r.m.silver;
          t.bronze += r.m.bronze;
          t.total += r.m.total;
          totals.set(r.m.nocCode, t);
        }
        body.totals = nocs.map((n) => ({
          noc: n.code,
          ...(totals.get(n.code) ?? { gold: 0, silver: 0, bronze: 0, total: 0 }),
        }));
        body.withheld = [...withheld.values()];
        // fontes: licença de cada fonte usada nas edições publicadas
        if (sourceGames.size) {
          const src = await db
            .selectDistinct({ source: medal.source })
            .from(medal)
            .innerJoin(msEvent, eq(msEvent.id, medal.eventId))
            .where(inArray(msEvent.gamesId, [...sourceGames.keys()]));
          body.sources = src
            .map((s) => ({
              source: s.source,
              license: (MEDAL_SOURCE_LICENSES as Record<string, string>)[s.source] ?? null,
              url: s.source === 'wikidata' ? 'https://www.wikidata.org/' : null,
            }))
            .sort((a, b) => a.source.localeCompare(b.source));
        }
        return { body, tags: ['games', 'medal', 'noc'] };
      },
    });
  });
}

// ─── medalhas e delegação ────────────────────────────────────────────────────────────────────────

/** Medalhas das provas (inclusive revogadas), com integrantes das equipes. */
async function eventMedals(db: Database, eventIds: string[], locale: Locale) {
  if (!eventIds.length) return [];
  const rows = await db
    .select({
      m: medal,
      p: { id: msParticipant.id, kind: msParticipant.kind },
      name: participantName,
      n: { code: noc.code, name: noc.name, iso2: noc.iso2 },
    })
    .from(medal)
    .innerJoin(msParticipant, eq(msParticipant.id, medal.participantId))
    .leftJoin(msPerson, eq(msPerson.id, msParticipant.personId))
    .innerJoin(noc, eq(noc.code, medal.nocCode))
    .where(inArray(medal.eventId, eventIds))
    .orderBy(sql`case ${medal.medal} when 'G' then 1 when 'S' then 2 else 3 end`, asc(medal.nocCode));
  const teamIds = rows.filter((r) => r.p.kind === 'team').map((r) => r.p.id);
  const members = teamIds.length
    ? await db
        .select({ team: teamMember.teamParticipantId, name: msPerson.fullName })
        .from(teamMember)
        .innerJoin(msPerson, eq(msPerson.id, teamMember.personId))
        .where(inArray(teamMember.teamParticipantId, teamIds))
        .orderBy(asc(msPerson.fullName))
    : [];
  return rows.map((r) => ({
    eventId: r.m.eventId,
    medal: r.m.medal,
    noc: nocRef(r.n, locale),
    participant: {
      id: r.p.id,
      kind: r.p.kind,
      name: r.name,
      members: members.filter((x) => x.team === r.p.id).map((x) => x.name),
    },
    awarded_at: r.m.awardedAt,
    revoked: r.m.revokedAt !== null,
  }));
}

/**
 * Delegação de um CON na edição, derivada das medalhas (atletas e integrantes de equipes) e dos resultados
 * das unidades — a lista oficial de inscritos ainda não é carregada.
 */
async function delegation(
  db: Database,
  gamesId: string,
  nocCode: string,
  locale: Locale,
): Promise<Delegation['data']> {
  type Entry = Delegation['data'][number];
  const people = new Map<string, Entry>();
  const touch = (
    person: { id: string; fullName: string; gender: string | null; birthDate: string | null },
    ev: { id: string; name: unknown },
    m: 'G' | 'S' | 'B' | null,
  ) => {
    const e =
      people.get(person.id) ??
      ({
        person_id: person.id,
        name: person.fullName,
        gender: person.gender,
        birth_date: person.birthDate,
        medals: { gold: 0, silver: 0, bronze: 0, total: 0 },
        events: [],
      } satisfies Entry);
    people.set(person.id, e);
    const existing = e.events.find((x) => x.id === ev.id);
    if (existing) {
      if (m && !existing.medal) existing.medal = m;
      else return;
    } else e.events.push({ id: ev.id, name: pickText(ev.name as I18n, locale, '')!, medal: m });
    if (m) {
      e.medals[m === 'G' ? 'gold' : m === 'S' ? 'silver' : 'bronze'] += 1;
      e.medals.total += 1;
    }
  };
  const personCols = {
    id: msPerson.id,
    fullName: msPerson.fullName,
    gender: msPerson.gender,
    birthDate: msPerson.birthDate,
  };

  // medalhas individuais
  const individual = await db
    .select({ person: personCols, ev: { id: msEvent.id, name: msEvent.name }, m: medal.medal })
    .from(medal)
    .innerJoin(msEvent, eq(msEvent.id, medal.eventId))
    .innerJoin(msParticipant, eq(msParticipant.id, medal.participantId))
    .innerJoin(msPerson, eq(msPerson.id, msParticipant.personId))
    .where(and(eq(msEvent.gamesId, gamesId), eq(medal.nocCode, nocCode), isNull(medal.revokedAt)));
  // medalhas por equipe → integrantes
  const team = await db
    .select({ person: personCols, ev: { id: msEvent.id, name: msEvent.name }, m: medal.medal })
    .from(medal)
    .innerJoin(msEvent, eq(msEvent.id, medal.eventId))
    .innerJoin(teamMember, eq(teamMember.teamParticipantId, medal.participantId))
    .innerJoin(msPerson, eq(msPerson.id, teamMember.personId))
    .where(and(eq(msEvent.gamesId, gamesId), eq(medal.nocCode, nocCode), isNull(medal.revokedAt)));
  // resultados (sem medalha)
  const results = await db
    .selectDistinct({ person: personCols, ev: { id: msEvent.id, name: msEvent.name } })
    .from(result)
    .innerJoin(unit, eq(unit.id, result.unitId))
    .innerJoin(phase, eq(phase.id, unit.phaseId))
    .innerJoin(msEvent, eq(msEvent.id, phase.eventId))
    .innerJoin(msParticipant, eq(msParticipant.id, result.participantId))
    .innerJoin(msPerson, eq(msPerson.id, msParticipant.personId))
    .where(and(eq(msEvent.gamesId, gamesId), eq(msParticipant.nocCode, nocCode)));

  for (const r of [...individual, ...team]) touch(r.person, r.ev, r.m);
  for (const r of results) touch(r.person, r.ev, null);
  return [...people.values()].sort(
    (a, b) =>
      b.medals.gold - a.medals.gold ||
      b.medals.silver - a.medals.silver ||
      b.medals.bronze - a.medals.bronze ||
      a.name.localeCompare(b.name, locale),
  );
}
