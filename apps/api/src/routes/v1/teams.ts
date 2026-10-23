import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import {
  LocaleQuery,
  PersonOverviewQuery,
  SquadQuery,
  TeamEventsQuery,
  TeamOverviewQuery,
  TeamParams,
  TeamsQuery,
  type Event,
  type FormerName,
  type Squad,
  type SquadMember,
  type Team,
  type TeamOverview,
  type TeamSeason,
  type TeamSummary,
} from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  country,
  event,
  eventParticipant,
  participant,
  providerMap,
  roster,
  season,
  standing,
  providerFormerName,
  sameName,
  teamProfile,
  venue,
  venueDisplay,
  type Database,
} from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { buildEvents, eventsTtl } from '../../events/builder.js';
import { constructorEvents } from '../../events/race.js';
import { assertWindow, competitionCond, IN_PLAY, sportScope } from '../../events/queries.js';
import { pickText } from '../../i18n.js';
import { teamColors } from '../../teams/colors.js';
import { loadTeamCompetitions } from '../../teams/load-campaigns.js';
import { ageAt, loadPerson, selectPeople } from '../../people/person.js';
import { loadPersonOverview } from '../../people/overview.js';
import {
  coreIds,
  nationalityResolver,
  providerIds,
  teamSeasonCoaches,
  teamSeasonPlayers,
  teamSeasonProviderRows,
} from '../../people/queries.js';
import { positionName } from '../../people/stats.js';
import { scheduleWindow } from '../../time.js';
import { assetUrl, decodeCursor, encodeCursor, likeEscape, parseInput, UUID_RE } from '../../util.js';
import { resolveMarket } from '../../events/relevance.js';
import { buildCtx, eventPage, localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;
const TeamCursor = z.object({ n: z.string(), i: z.string().regex(UUID_RE) });

export { ageAt } from '../../people/person.js';
export { teamColors } from '../../teams/colors.js';

const POSITION_ORDER: Record<string, number> = { goalkeeper: 0, defender: 1, midfielder: 2, attacker: 3 };

/** Rotas de times, elencos e pessoas (docs/05 §3.3). Todas exigem o módulo core_data. */
export async function teamRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  function selectTeams(db: Database) {
    return db
      .select({
        p: participant,
        logoKey: asset.storageKey,
        logoUrl: asset.sourceUrl,
        logoPalette: asset.palette,
      })
      .from(participant)
      .leftJoin(asset, eq(asset.id, participant.logoAssetId))
      .$dynamic();
  }
  type TeamRow = Awaited<ReturnType<ReturnType<typeof selectTeams>['execute']>>[number];

  async function nicknamesOf(db: Database, ids: string[]): Promise<Map<string, string[]>> {
    if (!ids.length) return new Map();
    const rows = await db
      .select({ participantId: teamProfile.participantId, nicknames: teamProfile.nicknames })
      .from(teamProfile)
      .where(inArray(teamProfile.participantId, ids));
    const out = new Map<string, string[]>();
    for (const r of rows)
      if (r.participantId && !out.has(r.participantId)) out.set(r.participantId, r.nicknames);
    return out;
  }

  const toSummary = (r: TeamRow, nicknames: Map<string, string[]>): TeamSummary => ({
    id: r.p.id,
    sport: r.p.sport,
    kind: r.p.kind,
    name: r.p.name,
    short_name: r.p.shortName,
    code: r.p.code,
    country: r.p.countryCode,
    logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
    nicknames: nicknames.get(r.p.id) ?? [],
  });

  /**
   * Nomes anteriores derivados dos jogos do fornecedor (`names:derive`), sem os que coincidem com o
   * nome atual ou com os nomes da base semântica (a curadoria vence).
   */
  async function teamFormerNames(db: Database, p: TeamRow['p']): Promise<FormerName[]> {
    const list = p.providerFormerNames ?? [];
    if (!list.length) return [];
    const [profile] = await db
      .select({ names: teamProfile.names, labels: teamProfile.labels })
      .from(teamProfile)
      .where(eq(teamProfile.participantId, p.id))
      .limit(1);
    const names = (profile?.names ?? {}) as { official?: string; short?: string };
    const current = [
      p.name,
      p.shortName,
      names.official,
      names.short,
      ...Object.values((profile?.labels ?? {}) as Record<string, string>),
    ].filter((n): n is string => !!n);
    return list
      .filter((f) => !current.some((c) => sameName(c, f.name)))
      .map(providerFormerName)
      .sort((a, b) => b.until.localeCompare(a.until));
  }

  async function loadTeam(db: Database, id: string, locale: string): Promise<Team> {
    const [row] = await selectTeams(db).where(eq(participant.id, id)).limit(1);
    if (!row) throw problems.notFound('Time');
    const nick = await nicknamesOf(db, [id]);
    const [c] = row.p.countryCode
      ? await db.select().from(country).where(eq(country.code, row.p.countryCode)).limit(1)
      : [];
    const [v] = row.p.homeVenueId
      ? await db
          .select({ v: venue, key: asset.storageKey, url: asset.sourceUrl })
          .from(venue)
          .leftJoin(asset, eq(asset.id, venue.imageAssetId))
          .where(eq(venue.id, row.p.homeVenueId))
          .limit(1)
      : [];
    const ids = await db
      .select({ provider: providerMap.provider, providerId: providerMap.providerId })
      .from(providerMap)
      .where(and(eq(providerMap.entityType, 'participant'), eq(providerMap.entityId, id)));
    return {
      ...toSummary(row, nick),
      country_ref: c
        ? { code: c.code, name: pickText(c.name as Record<string, string>, locale, c.code)! }
        : null,
      founded: row.p.founded,
      venue: v
        ? { id: v.v.id, ...venueDisplay(v.v), image: assetUrl(ctx.assetsBaseUrl, v.key, v.url) }
        : null,
      colors: teamColors(row.logoPalette),
      external_ids: Object.fromEntries(ids.map((i) => [i.provider, i.providerId])),
      former_names: await teamFormerNames(db, row.p),
    };
  }

  // ─── /v1/teams ───────────────────────────────────────────────────────────────────────────────
  app.get('/v1/teams', { config: MODULE }, async (request, reply) => {
    const query = parseInput(TeamsQuery, request.query);
    const locale = localeOf(request, query);
    const sports = sportScope(request, query.sport);
    const cursor = query.cursor ? decodeCursor(TeamCursor, query.cursor) : undefined;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale, ...(sports ?? [])],
      load: async () => {
        const db = requireDb(ctx);
        const conds: SQL[] = [];
        if (query.sport) conds.push(eq(participant.sport, query.sport));
        if (sports) conds.push(inArray(participant.sport, sports));
        if (query.country) conds.push(eq(participant.countryCode, query.country));
        if (query.q) {
          const p = `%${likeEscape(query.q)}%`;
          conds.push(
            or(
              ilike(participant.name, p),
              ilike(participant.shortName, p),
              ilike(participant.code, p),
              sql`exists (select 1 from ${teamProfile} tp where tp.participant_id = ${participant.id}
                          and (tp.nicknames::text ilike ${p} or tp.names::text ilike ${p} or tp.slug ilike ${p}))`,
            )!,
          );
        }
        if (query.competition) {
          conds.push(
            sql`exists (select 1 from core.event_participant ep join ${event} on ${event.id} = ep.event_id
                         where ep.participant_id = ${participant.id} and ${competitionCond(query.competition)})`,
          );
        }
        if (cursor)
          conds.push(sql`(${participant.name}, ${participant.id}) > (${cursor.n}, ${cursor.i}::uuid)`);
        const rows = await selectTeams(db)
          .where(and(...conds))
          .orderBy(asc(participant.name), asc(participant.id))
          .limit(query.limit + 1);
        const pageRows = rows.slice(0, query.limit);
        const nick = await nicknamesOf(
          db,
          pageRows.map((r) => r.p.id),
        );
        const last = pageRows.at(-1);
        return {
          body: {
            data: pageRows.map((r) => toSummary(r, nick)),
            next_cursor:
              rows.length > query.limit && last ? encodeCursor({ n: last.p.name, i: last.p.id }) : null,
          },
          tags: ['participant', 'team_profile'],
        };
      },
    });
  });

  // ─── /v1/teams/:id ───────────────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const team = await loadTeam(requireDb(ctx), params.id, locale);
        return { body: team, tags: [`participant:${team.id}`, 'team_profile'], meta: { sport: team.sport } };
      },
    });
  });

  /**
   * Anos de temporada com jogos do time (`season.year`, do mais recente ao mais antigo). A corrente é a
   * mais recente marcada como atual pelo fornecedor; sem nenhuma marcada, a mais recente.
   */
  async function teamSeasons(db: Database, teamId: string): Promise<TeamSeason[]> {
    const rows = await db
      .select({
        year: season.year,
        labels: sql<string[]>`array_agg(distinct ${season.label} order by ${season.label})`,
        events: sql<number>`count(distinct ${event.id})::int`.mapWith(Number),
        hasIncidents: sql<boolean>`bool_or(exists (select 1 from core.event_incident i
                                                     where i.event_id = ${event.id}))`,
        current: sql<boolean>`bool_or(${season.current})`,
      })
      .from(event)
      .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
      .innerJoin(season, eq(season.id, event.seasonId))
      .where(eq(eventParticipant.participantId, teamId))
      .groupBy(season.year)
      .orderBy(desc(season.year));
    const currentYear = rows.find((r) => r.current)?.year ?? rows[0]?.year;
    return rows.map((r) => ({
      year: r.year,
      labels: r.labels,
      events: r.events,
      has_incidents: !!r.hasIncidents,
      current: r.year === currentYear,
    }));
  }

  // ─── /v1/teams/:id/overview ──────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/overview', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(TeamOverviewQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const year = query.season;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz, `season:${year ?? ''}`],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const db = bctx.db;
        const team = await loadTeam(db, params.id, locale);
        const seasons = await teamSeasons(db, team.id);
        // ao vivo e próximo jogo só existem na temporada corrente
        const upcoming = year === undefined || seasons.find((s) => s.year === year)?.current === true;
        const inYear =
          year === undefined
            ? undefined
            : inArray(event.seasonId, db.select({ id: season.id }).from(season).where(eq(season.year, year)));

        // posição: temporada atual (ou a mais recente) de cada competição com tabela do time; com
        // `season`, a daquele ano
        const st = await db
          .select({
            s: standing,
            season: { id: season.id, year: season.year, label: season.label, current: season.current },
            c: {
              id: competition.id,
              slug: competition.slug,
              name: competition.name,
              labels: competition.labels,
              tier: competition.tier,
            },
            profileLabels: competitionProfile.labels,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
          })
          .from(standing)
          .innerJoin(season, eq(season.id, standing.seasonId))
          .innerJoin(competition, eq(competition.id, season.competitionId))
          .leftJoin(competitionProfile, eq(competitionProfile.competitionId, competition.id))
          .leftJoin(asset, eq(asset.id, competition.logoAssetId))
          .where(
            and(eq(standing.participantId, team.id), year === undefined ? undefined : eq(season.year, year)),
          )
          .orderBy(asc(competition.tier), desc(season.current), desc(season.year));
        const seen = new Set<string>();
        const standings: TeamOverview['standings'] = [];
        for (const r of st) {
          if (seen.has(r.c.id)) continue;
          seen.add(r.c.id);
          const labels = { ...(r.c.labels ?? {}), ...(r.profileLabels ?? {}) } as Record<string, string>;
          standings.push({
            competition: {
              id: r.c.id,
              slug: r.c.slug,
              name: pickText(labels, locale, r.c.name)!,
              logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
            },
            season: { year: r.season.year, label: r.season.label },
            group: r.s.group || null,
            rank: r.s.rank,
            points: r.s.points,
            played: r.s.played,
            won: r.s.won,
            drawn: r.s.drawn,
            lost: r.s.lost,
            goal_diff: r.s.goalsFor - r.s.goalsAgainst,
            form: r.s.form,
            description: r.s.description,
          });
        }

        // construtor (F1): as sessões dos pilotos da equipe
        const constructorId = team.kind === 'constructor' ? team.external_ids['api-sports'] : undefined;
        const teamEvents = (status: Event['status'][], order: 'asc' | 'desc', limit: number) =>
          constructorId
            ? constructorEvents(
                db,
                team.sport,
                constructorId,
                and(inArray(event.status, status), inYear),
                order,
                limit,
              )
            : db
                .select({ id: event.id })
                .from(event)
                .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
                .where(
                  and(eq(eventParticipant.participantId, team.id), inArray(event.status, status), inYear),
                )
                .orderBy(order === 'asc' ? asc(event.startsAt) : desc(event.startsAt), asc(event.id))
                .limit(limit);
        const [competitions, lastIds, liveIds, nextIds] = await Promise.all([
          loadTeamCompetitions(bctx, team.id, year),
          teamEvents(['finished'], 'desc', 5),
          upcoming ? teamEvents(IN_PLAY, 'desc', 1) : [],
          !upcoming
            ? []
            : db
                .select({ id: event.id })
                .from(event)
                .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
                .where(
                  and(
                    eq(eventParticipant.participantId, team.id),
                    inArray(event.status, ['scheduled', 'starting']),
                    sql`${event.startsAt} >= ${new Date(bctx.now.getTime() - 3 * 3600_000).toISOString()}::timestamptz`,
                  ),
                )
                .orderBy(asc(event.startsAt), asc(event.id))
                .limit(1),
        ]);
        const built = await buildEvents(bctx, [
          ...lastIds.map((r) => r.id),
          ...liveIds.map((r) => r.id),
          ...nextIds.map((r) => r.id),
        ]);
        const byId = new Map(built.map((b) => [b.dto.id, b.dto]));
        const lastEvents = lastIds.map((r) => byId.get(r.id)).filter((e): e is Event => !!e);
        const form: TeamOverview['form'] = [];
        for (const e of lastEvents) {
          const mine = e.participants.find((p) => p.id === team.id);
          const other = e.participants.find((p) => p.id !== team.id);
          if (!mine || !other) continue;
          // lutas (MMA): sem placar, o resultado é o vencedor e o "placar" é o método e o round
          if (e.fight && e.status === 'finished' && (mine.winner != null || other.winner != null)) {
            const r = e.fight.result;
            form.push({
              event_id: e.id,
              result: mine.winner === true ? 'W' : other.winner === true ? 'L' : 'D',
              score: r
                ? [r.method_name, r.round != null ? `R${r.round}` : null].filter(Boolean).join(' · ')
                : '',
            });
            continue;
          }
          if (e.score.home == null || e.score.away == null) continue;
          const gf = mine.side === 'home' ? e.score.home : e.score.away;
          const ga = mine.side === 'home' ? e.score.away : e.score.home;
          const result =
            gf > ga ? 'W' : gf < ga ? 'L' : mine.winner === true ? 'W' : other.winner === true ? 'L' : 'D';
          form.push({ event_id: e.id, result, score: `${gf}-${ga}` });
        }
        const live = liveIds[0] ? (byId.get(liveIds[0].id) ?? null) : null;
        const next = nextIds[0] ? (byId.get(nextIds[0].id) ?? null) : null;
        const body: TeamOverview = {
          team,
          season: year ?? null,
          seasons,
          standings,
          competitions,
          form,
          last_events: lastEvents,
          live_event: live,
          next_event: next,
        };
        const shown = [...lastEvents, ...(live ? [live] : []), ...(next ? [next] : [])];
        return {
          body,
          tags: [`participant:${team.id}`, 'event', 'standing', ...shown.map((e) => `event:${e.id}`)],
          ttl: eventsTtl(shown, bctx.now, CACHE_TTL.schedule),
          meta: { sport: team.sport },
        };
      },
    });
  });

  // ─── /v1/teams/:id/events ────────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/events', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(TeamEventsQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const market = resolveMarket(request, query.market);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz, `market:${market ?? ''}`],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const [p] = await bctx.db
          .select({ id: participant.id, sport: participant.sport })
          .from(participant)
          .where(eq(participant.id, params.id))
          .limit(1);
        if (!p) throw problems.notFound('Time');
        const win = scheduleWindow(query, tz, bctx.now, false);
        assertWindow(win.start, win.end);
        const page = await eventPage(
          bctx,
          {
            start: win.start,
            end: win.end,
            team: p.id,
            sport: query.sport,
            competition: query.competition,
            country: query.country,
            status: query.status,
            importanceMin: query.importance_min,
            relevanceMin: query.relevance_min,
          },
          { order: query.order, limit: query.limit, cursor: query.cursor },
          market,
        );
        return { ...page, tags: [...page.tags, `participant:${p.id}`], meta: { sport: p.sport } };
      },
    });
  });

  // ─── /v1/teams/:id/squad ─────────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/squad', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(SquadQuery, request.query);
    const locale = localeOf(request, query);
    const year = query.season;
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale],
      check: sportCheck(request),
      load: async () => {
        const db = requireDb(ctx);
        const now = ctx.now();
        const [p] = await db
          .select({ id: participant.id, sport: participant.sport })
          .from(participant)
          .where(eq(participant.id, params.id))
          .limit(1);
        if (!p) throw problems.notFound('Time');
        // na temporada corrente, o elenco atual (players/squads) também conta: contratações sem jogo ainda
        const current =
          year !== undefined && (await teamSeasons(db, p.id)).find((s) => s.current)?.year === year;
        const rows = await db
          .select({ r: roster, seasonYear: season.year })
          .from(roster)
          .leftJoin(season, eq(season.id, roster.seasonId))
          .where(
            and(
              eq(roster.participantId, p.id),
              year === undefined
                ? isNull(roster.seasonId)
                : current
                  ? or(isNull(roster.seasonId), eq(season.year, year))
                  : eq(season.year, year),
            ),
          )
          // a inscrição da temporada vem antes da do elenco atual (número e posição daquele ano)
          .orderBy(sql`${roster.seasonId} is null`);

        // quem entrou em campo pelo time no ano (escalações), com os números somados das partidas
        const teamPid =
          year !== undefined && p.sport === 'football'
            ? (await providerIds(db, 'participant', [p.id])).get(p.id)
            : undefined;
        const [lines, coachGames] = teamPid
          ? await Promise.all([
              teamSeasonPlayers(db, p.id, teamPid, year!),
              teamSeasonCoaches(db, p.id, teamPid, year!),
            ])
          : [[], []];
        const people = await coreIds(db, 'person', [
          ...lines.map((l) => l.pid),
          ...coachGames.map((c) => c.pid),
        ]);
        const statsOf = new Map<string, NonNullable<SquadMember['stats']>>();
        for (const l of lines) {
          const personId = people.get(l.pid);
          if (!personId) continue;
          const prev = statsOf.get(personId);
          statsOf.set(personId, {
            appearances: (prev?.appearances ?? 0) + l.apps,
            starts: (prev?.starts ?? 0) + l.starts,
            minutes: (prev?.minutes ?? 0) + l.minutes,
            goals: (prev?.goals ?? 0) + l.goals,
            assists: (prev?.assists ?? 0) + l.assists,
          });
        }
        // o total do fornecedor (`players?league&season`) vale quando passa a soma das partidas: cobre
        // competições sem detalhe de partida e temporadas antigas sem `fixtures/players`
        const provider = year === undefined ? [] : await teamSeasonProviderRows(db, p.id, year);
        for (const r of provider) {
          if (r.appearances <= (statsOf.get(r.personId)?.appearances ?? 0)) continue;
          statsOf.set(r.personId, {
            appearances: r.appearances,
            starts: r.lineups,
            minutes: r.minutes,
            goals: r.goals,
            assists: r.assists,
          });
        }
        const coachStats = new Map<string, NonNullable<SquadMember['stats']>>();
        for (const c of coachGames) {
          const personId = people.get(c.pid);
          if (personId)
            coachStats.set(personId, { appearances: c.games, starts: 0, minutes: 0, goals: 0, assists: 0 });
        }
        // com jogos no ano, quem não entrou em campo tem zero (e não "sem dado")
        const zero =
          lines.length || provider.length
            ? { appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0 }
            : null;

        type Entry = { personId: string; role: string; number: number | null; position: string | null };
        const entries = new Map<string, Entry>();
        for (const { r } of rows) {
          const k = `${r.role}|${r.personId}`;
          if (!entries.has(k))
            entries.set(k, { personId: r.personId, role: r.role, number: r.number, position: r.position });
        }
        for (const l of lines) {
          const personId = people.get(l.pid);
          if (!personId || l.apps === 0 || entries.has(`player|${personId}`)) continue;
          entries.set(`player|${personId}`, {
            personId,
            role: 'player',
            number: l.number,
            position: positionName(l.position),
          });
        }
        for (const [personId, s] of coachStats) {
          if (s.appearances > 0 && !entries.has(`coach|${personId}`))
            entries.set(`coach|${personId}`, { personId, role: 'coach', number: null, position: null });
        }

        const [persons, nationality] = await Promise.all([
          selectPeople(
            db,
            [...entries.values()].map((e) => e.personId),
          ),
          nationalityResolver(db, locale),
        ]);
        const personById = new Map(persons.map((x) => [x.id, x]));
        const member = (e: Entry): SquadMember | null => {
          const x = personById.get(e.personId);
          if (!x) return null;
          return {
            person: {
              id: x.id,
              name: x.name,
              photo: assetUrl(ctx.assetsBaseUrl, x.photoKey, x.photoUrl),
              nationality: x.nationality,
              nationality_ref: nationality(x.nationality),
              birth_date: x.birthDate,
              age: ageAt(x.birthDate, now),
            },
            number: e.number,
            position: e.position,
            stats:
              year === undefined
                ? null
                : ((e.role === 'coach' ? coachStats : statsOf).get(e.personId) ??
                  (e.role === 'player' ? zero : null)),
          };
        };
        const byRole = (role: string) =>
          [...entries.values()]
            .filter((e) => e.role === role)
            .map(member)
            .filter((m): m is SquadMember => m !== null)
            .sort(
              (a, b) =>
                (POSITION_ORDER[(a.position ?? '').toLowerCase()] ?? 9) -
                  (POSITION_ORDER[(b.position ?? '').toLowerCase()] ?? 9) ||
                (a.number ?? 999) - (b.number ?? 999) ||
                a.person.name.localeCompare(b.person.name),
            );
        const body: Squad = {
          team_id: p.id,
          season: year ?? null,
          players: byRole('player'),
          coaches: byRole('coach'),
          staff: byRole('staff'),
        };
        return {
          body,
          tags: [`participant:${p.id}`, 'roster', ...(year === undefined ? [] : ['event'])],
          meta: { sport: p.sport },
        };
      },
    });
  });

  // ─── /v1/people/:id ──────────────────────────────────────────────────────────────────────────
  app.get('/v1/people/:id', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.catalog,
      vary: [locale],
      load: async () => {
        const body = await loadPerson(requireDb(ctx), ctx.assetsBaseUrl, ctx.now(), params.id);
        return {
          body,
          tags: [`person:${body.id}`, 'roster', ...body.teams.map((t) => `participant:${t.team.id}`)],
        };
      },
    });
  });

  // ─── /v1/people/:id/overview ─────────────────────────────────────────────────────────────────
  app.get('/v1/people/:id/overview', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(PersonOverviewQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const { body, teamIds, eventIds } = await loadPersonOverview(bctx, params.id, query.season);
        // os jogos embutidos seguem o change feed (placar, status, correções) e o TTL curto do ao vivo
        return {
          body,
          tags: [
            `person:${body.person.id}`,
            'roster',
            ...teamIds.map((t) => `participant:${t}`),
            ...eventIds.map((e) => `event:${e}`),
          ],
          ttl: eventsTtl(
            body.recent_matches.map((m) => m.event),
            bctx.now,
            CACHE_TTL.standings,
          ),
        };
      },
    });
  });
}
