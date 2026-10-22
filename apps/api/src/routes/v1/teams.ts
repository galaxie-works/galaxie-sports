import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import {
  LocaleQuery,
  SquadQuery,
  TeamEventsQuery,
  TeamParams,
  TeamsQuery,
  teamGradient,
  type Event,
  type Person,
  type Squad,
  type Team,
  type TeamOverview,
  type TeamColors,
  type TeamSummary,
} from '@galaxie/contracts';
import {
  asset,
  type AssetPalette,
  competition,
  competitionProfile,
  country,
  event,
  eventParticipant,
  participant,
  person,
  providerMap,
  roster,
  season,
  standing,
  teamProfile,
  venue,
  type Database,
} from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { buildEvents, eventsTtl } from '../../events/builder.js';
import { assertWindow, competitionCond, IN_PLAY, sportScope } from '../../events/queries.js';
import { pickText } from '../../i18n.js';
import { scheduleWindow } from '../../time.js';
import { assetUrl, decodeCursor, encodeCursor, likeEscape, parseInput, UUID_RE } from '../../util.js';
import { buildCtx, eventPage, localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;
const TeamCursor = z.object({ n: z.string(), i: z.string().regex(UUID_RE) });

/** Idade completa em anos numa data (UTC). */
export function ageAt(birthDate: string | null, now: Date): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Paleta do escudo (core.asset.palette, extraída pelo espelho de mídia) → `colors` do Team.
 * null enquanto o escudo não foi espelhado/decodificado (a paleta é zerada se o escudo sai do storage).
 */
export function teamColors(palette: AssetPalette | null): TeamColors | null {
  if (!palette) return null;
  return {
    primary: palette.dominant,
    secondary: palette.secondary,
    monochrome: palette.monochrome,
    gradient: teamGradient(palette.dominant),
  };
}

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
        ? { id: v.v.id, name: v.v.name, city: v.v.city, image: assetUrl(ctx.assetsBaseUrl, v.key, v.url) }
        : null,
      colors: teamColors(row.logoPalette),
      external_ids: Object.fromEntries(ids.map((i) => [i.provider, i.providerId])),
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

  // ─── /v1/teams/:id/overview ──────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/overview', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const db = bctx.db;
        const team = await loadTeam(db, params.id, locale);

        // posição: temporada atual (ou a mais recente) de cada competição com tabela do time
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
          .where(eq(standing.participantId, team.id))
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

        const teamEvents = (status: Event['status'][], order: 'asc' | 'desc', limit: number) =>
          db
            .select({ id: event.id })
            .from(event)
            .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
            .where(and(eq(eventParticipant.participantId, team.id), inArray(event.status, status)))
            .orderBy(order === 'asc' ? asc(event.startsAt) : desc(event.startsAt), asc(event.id))
            .limit(limit);
        const [lastIds, liveIds, nextIds] = await Promise.all([
          teamEvents(['finished'], 'desc', 5),
          teamEvents(IN_PLAY, 'desc', 1),
          db
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
          if (!mine || !other || e.score.home == null || e.score.away == null) continue;
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
          standings,
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
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz],
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
          },
          { order: query.order, limit: query.limit, cursor: query.cursor },
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
        const rows = await db
          .select({
            r: roster,
            person: {
              id: person.id,
              name: person.name,
              nationality: person.nationality,
              birthDate: person.birthDate,
            },
            photoKey: asset.storageKey,
            photoUrl: asset.sourceUrl,
          })
          .from(roster)
          .innerJoin(person, eq(person.id, roster.personId))
          .leftJoin(asset, eq(asset.id, person.photoAssetId))
          .where(
            and(
              eq(roster.participantId, p.id),
              query.season
                ? inArray(
                    roster.seasonId,
                    db.select({ id: season.id }).from(season).where(eq(season.year, query.season)),
                  )
                : isNull(roster.seasonId),
            ),
          );
        const member = (r: (typeof rows)[number]) => ({
          person: {
            id: r.person.id,
            name: r.person.name,
            photo: assetUrl(ctx.assetsBaseUrl, r.photoKey, r.photoUrl),
            nationality: r.person.nationality,
            birth_date: r.person.birthDate,
            age: ageAt(r.person.birthDate, now),
          },
          number: r.r.number,
          position: r.r.position,
        });
        const seen = new Set<string>();
        const unique = rows.filter((r) => {
          const k = `${r.r.role}|${r.person.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const byRole = (role: string) =>
          unique
            .filter((r) => r.r.role === role)
            .sort(
              (a, b) =>
                (POSITION_ORDER[(a.r.position ?? '').toLowerCase()] ?? 9) -
                  (POSITION_ORDER[(b.r.position ?? '').toLowerCase()] ?? 9) ||
                (a.r.number ?? 999) - (b.r.number ?? 999) ||
                a.person.name.localeCompare(b.person.name),
            )
            .map(member);
        const body: Squad = {
          team_id: p.id,
          season: query.season ?? null,
          players: byRole('player'),
          coaches: byRole('coach'),
          staff: byRole('staff'),
        };
        return { body, tags: [`participant:${p.id}`, 'roster'], meta: { sport: p.sport } };
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
        const db = requireDb(ctx);
        const [row] = await db
          .select({ p: person, key: asset.storageKey, url: asset.sourceUrl })
          .from(person)
          .leftJoin(asset, eq(asset.id, person.photoAssetId))
          .where(eq(person.id, params.id))
          .limit(1);
        if (!row) throw problems.notFound('Pessoa');
        const teams = await db
          .select({
            r: roster,
            team: { id: participant.id, name: participant.name, shortName: participant.shortName },
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
            seasonYear: season.year,
          })
          .from(roster)
          .innerJoin(participant, eq(participant.id, roster.participantId))
          .leftJoin(asset, eq(asset.id, participant.logoAssetId))
          .leftJoin(season, eq(season.id, roster.seasonId))
          .where(eq(roster.personId, row.p.id))
          .orderBy(sql`${season.year} desc nulls first`, asc(participant.name));
        const ids = await db
          .select({ provider: providerMap.provider, providerId: providerMap.providerId })
          .from(providerMap)
          .where(and(eq(providerMap.entityType, 'person'), eq(providerMap.entityId, row.p.id)));
        const body: Person = {
          id: row.p.id,
          name: row.p.name,
          first_name: row.p.firstName,
          last_name: row.p.lastName,
          birth_date: row.p.birthDate,
          age: ageAt(row.p.birthDate, ctx.now()),
          nationality: row.p.nationality,
          height_cm: row.p.heightCm,
          weight_kg: row.p.weightKg,
          photo: assetUrl(ctx.assetsBaseUrl, row.key, row.url),
          teams: teams.map((t) => ({
            team: {
              id: t.team.id,
              name: t.team.name,
              short_name: t.team.shortName,
              logo: assetUrl(ctx.assetsBaseUrl, t.logoKey, t.logoUrl),
            },
            role: t.r.role,
            number: t.r.number,
            position: t.r.position,
            season: t.seasonYear ?? null,
          })),
          external_ids: Object.fromEntries(ids.map((i) => [i.provider, i.providerId])),
        };
        return {
          body,
          tags: [`person:${row.p.id}`, 'roster', ...teams.map((t) => `participant:${t.team.id}`)],
        };
      },
    });
  });
}
