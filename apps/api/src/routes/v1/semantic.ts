import { and, asc, desc, eq, gte, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  DerbiesQuery,
  DerbyParams,
  GlossaryQuery,
  ReviewQuery,
  TeamParams,
  UpcomingDerbiesQuery,
  type Derby,
  type DerbyMatch,
  type DerbyRetrospect,
  type DerbySummary,
  type Glossary,
  type GlossaryTerm,
  type SemanticTeamRef,
  type SupportedLocale,
  type TeamRival,
  type TeamRivals,
  type TeamSemantic,
  type UpcomingDerby,
} from '@galaxie/contracts';
import {
  asset,
  competition,
  derby,
  derbyTeam,
  event,
  eventParticipant,
  participant,
  teamProfile,
  type Database,
  type EventScore,
} from '@galaxie/db';
import { loadGlossary, type LocatedGlossaryTerm } from '@galaxie/knowledge';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext, type ReviewStatus } from '../../context.js';
import { ProblemError, problems } from '../../errors.js';
import { formatInstant, pickList, pickText, resolveLocale } from '../../i18n.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';

const MODULE = { module: 'semantic' } as const;
const REVIEW_ORDER: readonly ReviewStatus[] = ['draft', 'reviewed', 'approved'];

/** Eventos que não entram em "próximos clássicos" (não vão acontecer na data prevista). */
const NOT_UPCOMING = ['finished', 'cancelled', 'abandoned', 'postponed'] as const;

// ─── piso editorial ──────────────────────────────────────────────────────────────────────────────

/**
 * Status editorial mínimo efetivo: o maior entre o piso do servidor (SEMANTIC_MIN_REVIEW_STATUS, padrão
 * approved) e o pedido em `?min_review_status` — o cliente endurece, nunca afrouxa.
 */
export function effectiveMinReview(ctx: AppContext, requested: ReviewStatus | undefined): ReviewStatus {
  const floor = ctx.semantic?.minReviewStatus ?? 'approved';
  if (!requested) return floor;
  return REVIEW_ORDER.indexOf(requested) > REVIEW_ORDER.indexOf(floor) ? requested : floor;
}

export const meetsReview = (status: string, min: ReviewStatus) =>
  REVIEW_ORDER.indexOf(status as ReviewStatus) >= REVIEW_ORDER.indexOf(min);

/** Status aceitos para um mínimo (para filtros SQL). */
const statusesFrom = (min: ReviewStatus) => REVIEW_ORDER.slice(REVIEW_ORDER.indexOf(min));

// ─── perfis ──────────────────────────────────────────────────────────────────────────────────────

type ProfileRow = typeof teamProfile.$inferSelect;
type Names = { official: string; short: string; abbreviation?: string };
type CopyHints = Record<string, { cheer?: string[]; nicknames?: string[] }>;

/** Nome do time no mercado: labels (pt-BR → pt → en; es-AR → es → en) ou o nome curto. */
export function profileName(p: Pick<ProfileRow, 'labels' | 'names'>, locale: string): string {
  const names = p.names as Names;
  return pickText(p.labels as Record<string, string> | null, locale, names.short)!;
}

/** Dicas de copy do mercado: locale exato e depois o idioma (es-AR → es); pt-BR não cai para espanhol. */
export function copyHintsFor(
  hints: unknown,
  locale: string,
): { locale: string | null; cheer: string[]; nicknames: string[] } {
  const rec = (hints ?? {}) as CopyHints;
  for (const l of [locale, locale.split('-')[0]!]) {
    const h = rec[l];
    if (h) return { locale: l, cheer: h.cheer ?? [], nicknames: h.nicknames ?? [] };
  }
  return { locale: null, cheer: [], nicknames: [] };
}

export function teamRef(p: ProfileRow, locale: string): SemanticTeamRef {
  return {
    slug: p.slug,
    participant_id: p.participantId,
    name: profileName(p, locale),
    country: p.countryCode,
    kind: p.kind === 'national_team' ? 'national_team' : 'club',
  };
}

/** Perfil pelo UUID do participante (core) ou pelo slug. Sem perfil → null. */
export async function findProfile(db: Database, key: string): Promise<ProfileRow | null> {
  const where = UUID_RE.test(key) ? eq(teamProfile.participantId, key) : eq(teamProfile.slug, key);
  const [row] = await db.select().from(teamProfile).where(where).orderBy(asc(teamProfile.slug)).limit(1);
  return row ?? null;
}

async function profilesBySlug(db: Database, slugs: string[]): Promise<Map<string, ProfileRow>> {
  if (!slugs.length) return new Map();
  const rows = await db
    .select()
    .from(teamProfile)
    .where(inArray(teamProfile.slug, [...new Set(slugs)]));
  return new Map(rows.map((r) => [r.slug, r]));
}

function localeOf(request: FastifyRequest, query: { locale?: SupportedLocale | undefined }) {
  return resolveLocale(query.locale, request.headers['accept-language']);
}

/** Item existe, mas abaixo do status editorial mínimo: 404 com o motivo. */
export const notPublished = (what: string, min: ReviewStatus) =>
  new ProblemError(
    404,
    'NOT_FOUND',
    `${what} não encontrado`,
    `Não publicado com o status editorial mínimo ${min}.`,
  );

// ─── rotas ───────────────────────────────────────────────────────────────────────────────────────

/** Rotas semânticas (docs/06 §5): clássicos, cartão do time, rivais e glossário. Módulo `semantic`. */
export async function semanticRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ─── /v1/derbies ─────────────────────────────────────────────────────────────────────────────
  app.get('/v1/derbies', { config: MODULE }, async (request, reply) => {
    const query = parseInput(DerbiesQuery, request.query);
    const locale = localeOf(request, query);
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.semantic,
      vary: [locale, min],
      load: async () => {
        const db = requireDb(ctx);
        let teamSlug: string | undefined;
        if (query.team) {
          const p = await findProfile(db, query.team);
          if (!p) throw problems.notFound('Time');
          teamSlug = p.slug;
        }
        const all = await loadDerbies(db, min);
        const data = all
          .filter((d) => !teamSlug || d.teams.some((t) => t.slug === teamSlug))
          .filter((d) => !query.country || d.teams.some((t) => t.countryCode === query.country))
          .sort((a, b) => b.row.intensity - a.row.intensity || a.row.slug.localeCompare(b.row.slug))
          .map((d) => derbySummary(d, locale));
        return { body: { data }, tags: ['derby', 'team_profile'] };
      },
    });
  });

  // ─── /v1/derbies/upcoming ────────────────────────────────────────────────────────────────────
  app.get('/v1/derbies/upcoming', { config: MODULE }, async (request, reply) => {
    const query = parseInput(UpcomingDerbiesQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz, min],
      load: async () => {
        const db = requireDb(ctx);
        const now = new Date();
        const until = new Date(now.getTime() + query.days * 86_400_000);
        const rows = await db
          .select({
            e: event,
            c: {
              id: competition.id,
              slug: competition.slug,
              name: competition.name,
              labels: competition.labels,
            },
          })
          .from(event)
          .leftJoin(competition, eq(competition.id, event.competitionId))
          .where(
            and(
              sql`${event.derbyId} is not null`,
              gte(event.startsAt, now),
              lt(event.startsAt, until),
              notInArray(event.status, [...NOT_UPCOMING]),
            ),
          )
          .orderBy(asc(event.startsAt), asc(event.id));
        const derbies = new Map((await loadDerbies(db, min)).map((d) => [d.row.id, d]));
        const parts = await participantsOf(
          db,
          rows.map((r) => r.e.id),
        );
        const data: UpcomingDerby[] = [];
        for (const r of rows) {
          const d = derbies.get(r.e.derbyId!);
          if (!d) continue;
          if (query.country && !d.teams.some((t) => t.countryCode === query.country)) continue;
          data.push({
            event_id: r.e.id,
            starts_at: formatInstant(r.e.startsAt, tz),
            status: r.e.status,
            competition: r.c?.id ? competitionRef(r.c, locale) : null,
            participants: parts.get(r.e.id) ?? [],
            derby: derbySummary(d, locale),
          });
        }
        return { body: { data }, tags: ['event', 'derby'] };
      },
    });
  });

  // ─── /v1/derbies/:slug ───────────────────────────────────────────────────────────────────────
  app.get('/v1/derbies/:slug', { config: MODULE }, async (request, reply) => {
    const params = parseInput(DerbyParams, request.params);
    const query = parseInput(ReviewQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      // o retrospecto muda a cada clássico encerrado: TTL de tabela (1 h) + purge por evento
      ttl: CACHE_TTL.standings,
      vary: [locale, tz, min],
      load: async () => {
        const db = requireDb(ctx);
        const [row] = await db.select().from(derby).where(eq(derby.slug, params.slug)).limit(1);
        if (!row) throw problems.notFound('Clássico');
        if (!meetsReview(row.reviewStatus, min)) throw notPublished('Clássico', min);
        const [loaded] = await loadDerbies(db, 'draft', row.id);
        const d = loaded!;
        const ids = d.teams.map((t) => t.participantId);
        const [a, b] = d.teams;
        const resolved = ids.every((id): id is string => !!id);
        const matches = resolved ? await headToHead(db, ids[0]!, ids[1]!, locale, tz, d.teams) : [];
        const next = resolved ? await nextMeeting(db, ids[0]!, ids[1]!, locale, tz) : null;
        const body: Derby = {
          ...derbySummary(d, locale),
          labels: (row.labels ?? {}) as Record<string, string>,
          first_match: row.firstMatch,
          origin: row.origin,
          trivia: row.trivia,
          sources: row.sources,
          next_event: next,
          retrospect: retrospect(matches, resolved, a!.slug, b!.slug, tz),
        };
        return { body, tags: [`derby:${row.id}`, 'event', 'team_profile'] };
      },
    });
  });

  // ─── /v1/teams/:id/semantic ──────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/semantic', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(ReviewQuery, request.query);
    const locale = localeOf(request, query);
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.semantic,
      vary: [locale, min],
      load: async () => {
        const db = requireDb(ctx);
        const p = await findProfile(db, params.id);
        if (!p) throw problems.notFound('Perfil semântico do time');
        if (!meetsReview(p.reviewStatus, min)) throw notPublished('Perfil semântico do time', min);
        const names = p.names as Names;
        const hints = copyHintsFor(p.copyHints, locale);
        const fans = (p.fans ?? {}) as { demonym?: string | null; group_nicknames?: string[] };
        const stadium = p.stadium as { name: string; nicknames?: string[]; city?: string } | null;
        let logo: string | null = null;
        if (p.participantId) {
          const [l] = await db
            .select({ storageKey: asset.storageKey, sourceUrl: asset.sourceUrl })
            .from(participant)
            .innerJoin(asset, eq(asset.id, participant.logoAssetId))
            .where(eq(participant.id, p.participantId))
            .limit(1);
          logo = assetUrl(ctx.assetsBaseUrl, l?.storageKey, l?.sourceUrl);
        }
        const body: TeamSemantic = {
          slug: p.slug,
          participant_id: p.participantId,
          kind: p.kind === 'national_team' ? 'national_team' : 'club',
          country: p.countryCode,
          name: profileName(p, locale),
          official_name: names.official,
          short_name: names.short,
          abbreviation: names.abbreviation ?? null,
          logo,
          city: p.city,
          region: p.region,
          founded: p.founded,
          colors: p.colors,
          nicknames: [...new Set([...hints.nicknames, ...p.nicknames])],
          mascot: p.mascot,
          fans: { demonym: fans.demonym ?? null, group_nicknames: fans.group_nicknames ?? [] },
          rallying_cries: p.rallyingCries,
          stadium: stadium
            ? { name: stadium.name, nicknames: stadium.nicknames ?? [], city: stadium.city ?? null }
            : null,
          rivals: await rivalsOf(db, p, locale, min),
          identity: p.identity,
          copy_hints: hints,
          world_cup_titles: p.worldCupTitles ?? null,
          sources: p.sources,
          review_status: p.reviewStatus,
        };
        return { body, tags: [`team_profile:${p.slug}`, 'derby'] };
      },
    });
  });

  // ─── /v1/teams/:id/rivals ────────────────────────────────────────────────────────────────────
  app.get('/v1/teams/:id/rivals', { config: MODULE }, async (request, reply) => {
    const params = parseInput(TeamParams, request.params);
    const query = parseInput(ReviewQuery, request.query);
    const locale = localeOf(request, query);
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.semantic,
      vary: [locale, min],
      load: async () => {
        const db = requireDb(ctx);
        const p = await findProfile(db, params.id);
        if (!p) throw problems.notFound('Perfil semântico do time');
        if (!meetsReview(p.reviewStatus, min)) throw notPublished('Perfil semântico do time', min);
        const body: TeamRivals = { team: teamRef(p, locale), data: await rivalsOf(db, p, locale, min) };
        return { body, tags: [`team_profile:${p.slug}`, 'team_profile', 'derby'] };
      },
    });
  });

  // ─── /v1/glossary ────────────────────────────────────────────────────────────────────────────
  let glossaryCache: Promise<LocatedGlossaryTerm[]> | undefined;
  const glossary = () => {
    glossaryCache ??= loadGlossary(...(ctx.semantic?.knowledgeDir ? [ctx.semantic.knowledgeDir] : [])).catch(
      (err: unknown) => {
        glossaryCache = undefined;
        throw err;
      },
    );
    return glossaryCache;
  };

  app.get('/v1/glossary', { config: MODULE }, async (request, reply) => {
    const query = parseInput(GlossaryQuery, request.query);
    const locale = localeOf(request, query);
    const min = effectiveMinReview(ctx, query.min_review_status);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.semantic,
      vary: [locale, min],
      load: async () => {
        const all = await glossary();
        // glossário é por mercado: locale exato e depois o idioma (es-AR → es); nunca outro idioma
        let sourceLocale: string | null = null;
        let terms: LocatedGlossaryTerm[] = [];
        for (const l of [locale, locale.split('-')[0]!]) {
          terms = all.filter((t) => t.locale === l);
          if (terms.length) {
            sourceLocale = l;
            break;
          }
        }
        const data: GlossaryTerm[] = terms
          .filter((t) => meetsReview(t.entry.review_status, min))
          .filter((t) => !query.category || t.entry.category === query.category)
          .map(({ entry: e }) => ({
            key: e.key,
            term: e.term,
            meaning: e.meaning,
            example: e.example ?? null,
            category: e.category,
            copy_intents: e.copy_intents ?? [],
            requires: e.requires ?? null,
            note: e.note ?? null,
            sources: e.sources,
            review_status: e.review_status,
          }));
        const body: Glossary = { locale, source_locale: sourceLocale, data };
        return { body, tags: ['glossary'] };
      },
    });
  });
}

// ─── clássicos: carga e montagem ─────────────────────────────────────────────────────────────────

interface LoadedDerby {
  row: typeof derby.$inferSelect;
  teams: (SemanticTeamRef & { countryCode: string; participantId: string | null; profile: ProfileRow })[];
}

/** Clássicos (com os dois perfis) acima do status mínimo; `id` restringe a um clássico. */
async function loadDerbies(db: Database, min: ReviewStatus, id?: string): Promise<LoadedDerby[]> {
  const rows = await db
    .select({ d: derby, slug: derbyTeam.teamSlug })
    .from(derby)
    .innerJoin(derbyTeam, eq(derbyTeam.derbyId, derby.id))
    .where(and(inArray(derby.reviewStatus, statusesFrom(min)), id ? eq(derby.id, id) : undefined))
    .orderBy(asc(derby.slug), asc(derbyTeam.teamSlug));
  const profiles = await profilesBySlug(
    db,
    rows.map((r) => r.slug),
  );
  const out = new Map<string, LoadedDerby>();
  for (const r of rows) {
    const p = profiles.get(r.slug);
    if (!p) continue;
    const d = out.get(r.d.id) ?? { row: r.d, teams: [] };
    out.set(r.d.id, d);
    d.teams.push({
      ...teamRef(p, 'pt-BR'),
      countryCode: p.countryCode,
      participantId: p.participantId,
      profile: p,
    });
  }
  // a ordem dos times segue o YAML? derby_team não guarda ordem: alfabética por slug, estável
  return [...out.values()].filter((d) => d.teams.length === 2);
}

function derbySummary(d: LoadedDerby, locale: string): DerbySummary {
  return {
    slug: d.row.slug,
    name: pickText(d.row.labels as Record<string, string> | null, locale, d.row.name)!,
    aliases: d.row.aliases,
    scope: d.row.scope as DerbySummary['scope'],
    intensity: d.row.intensity,
    teams: d.teams.map((t) => teamRef(t.profile, locale)),
    review_status: d.row.reviewStatus,
  };
}

function competitionRef(
  c: { id: string | null; slug: string | null; name: string | null; labels: unknown },
  locale: string,
) {
  return {
    id: c.id!,
    slug: c.slug!,
    name: pickText(c.labels as Record<string, string> | null, locale, c.name!)!,
  };
}

/** Participantes de cada evento, com o slug do perfil semântico quando houver. */
async function participantsOf(db: Database, eventIds: string[]) {
  const out = new Map<string, UpcomingDerby['participants']>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({
      eventId: eventParticipant.eventId,
      side: eventParticipant.side,
      id: participant.id,
      name: participant.name,
      slug: teamProfile.slug,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .leftJoin(teamProfile, eq(teamProfile.participantId, participant.id))
    .where(inArray(eventParticipant.eventId, eventIds))
    .orderBy(asc(eventParticipant.eventId), sql`${eventParticipant.side} = 'away'`, asc(participant.name));
  for (const r of rows) {
    const list = out.get(r.eventId) ?? [];
    out.set(r.eventId, list);
    if (!list.some((p) => p.id === r.id)) list.push({ side: r.side, id: r.id, name: r.name, slug: r.slug });
  }
  return out;
}

// ─── retrospecto (só core.event — nunca o provedor) ──────────────────────────────────────────────

const home = alias(eventParticipant, 'home');
const away = alias(eventParticipant, 'away');

const pairFilter = (a: string, b: string) =>
  or(
    and(eq(home.participantId, a), eq(away.participantId, b)),
    and(eq(home.participantId, b), eq(away.participantId, a)),
  );

function selectPair(db: Database) {
  return db
    .select({
      e: event,
      homeId: home.participantId,
      awayId: away.participantId,
      c: { id: competition.id, slug: competition.slug, name: competition.name, labels: competition.labels },
    })
    .from(event)
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .$dynamic();
}

type InternalMatch = DerbyMatch & { startsAtMs: number };

async function headToHead(
  db: Database,
  a: string,
  b: string,
  locale: string,
  tz: string,
  teams: LoadedDerby['teams'],
): Promise<InternalMatch[]> {
  const rows = await selectPair(db)
    .where(and(eq(event.status, 'finished'), pairFilter(a, b)))
    .orderBy(desc(event.startsAt), desc(event.id));
  const bySide = (id: string) => teams.find((t) => t.participantId === id)!;
  const out: InternalMatch[] = [];
  for (const r of rows) {
    const s = (r.e.score ?? null) as EventScore | null;
    if (s?.home == null || s.away == null) continue;
    const h = bySide(r.homeId);
    const w = bySide(r.awayId);
    const pen = s.penalty?.home != null && s.penalty.away != null ? s.penalty : null;
    out.push({
      event_id: r.e.id,
      starts_at: formatInstant(r.e.startsAt, tz),
      startsAtMs: r.e.startsAt.getTime(),
      competition: r.c?.id ? competitionRef(r.c, locale) : null,
      home: { slug: h.slug, participant_id: r.homeId, name: profileName(h.profile, locale), score: s.home },
      away: { slug: w.slug, participant_id: r.awayId, name: profileName(w.profile, locale), score: s.away },
      winner: s.home > s.away ? h.slug : s.away > s.home ? w.slug : null,
      penalties: pen ? { home: pen.home!, away: pen.away! } : null,
    });
  }
  return out;
}

async function nextMeeting(db: Database, a: string, b: string, locale: string, tz: string) {
  const [r] = await selectPair(db)
    .where(
      and(gte(event.startsAt, new Date()), notInArray(event.status, [...NOT_UPCOMING]), pairFilter(a, b)),
    )
    .orderBy(asc(event.startsAt))
    .limit(1);
  if (!r) return null;
  const parts = await participantsOf(db, [r.e.id]);
  return {
    event_id: r.e.id,
    starts_at: formatInstant(r.e.startsAt, tz),
    status: r.e.status,
    competition: r.c?.id ? competitionRef(r.c, locale) : null,
    participants: parts.get(r.e.id) ?? [],
  };
}

/** Retrospecto do confronto: V/E/D, gols, maiores goleadas e últimos 5 (pênaltis não mudam o resultado). */
export function retrospect(
  matches: InternalMatch[],
  available: boolean,
  slugA: string,
  slugB: string,
  tz = 'UTC',
): DerbyRetrospect {
  const strip = ({ startsAtMs: _ms, ...m }: InternalMatch): DerbyMatch => m;
  const goalsOf = (slug: string) =>
    matches.reduce(
      (n, m) => n + (m.home.slug === slug ? m.home.score : 0) + (m.away.slug === slug ? m.away.score : 0),
      0,
    );
  const margin = (m: InternalMatch) => Math.abs(m.home.score - m.away.score);
  const biggest = matches
    .filter((m) => m.winner)
    .sort(
      (x, y) =>
        margin(y) - margin(x) ||
        y.home.score + y.away.score - (x.home.score + x.away.score) ||
        y.startsAtMs - x.startsAtMs,
    )
    .slice(0, 3);
  const sorted = [...matches].sort((x, y) => y.startsAtMs - x.startsAtMs);
  const first = sorted.at(-1);
  const last = sorted[0];
  return {
    available,
    source: 'core',
    matches: matches.length,
    draws: matches.filter((m) => !m.winner).length,
    teams: [slugA, slugB].map((slug) => ({
      slug,
      wins: matches.filter((m) => m.winner === slug).length,
      goals: goalsOf(slug),
    })),
    biggest_wins: biggest.map(strip),
    last_5: sorted.slice(0, 5).map(strip),
    first_match_at: first ? formatInstant(new Date(first.startsAtMs), tz) : null,
    last_match_at: last ? formatInstant(new Date(last.startsAtMs), tz) : null,
  };
}

// ─── rivais ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Rivais do time: os declarados no perfil e os dos clássicos que o incluem (mesmo que o outro lado
 * declare sozinho). Rival abaixo do status mínimo é omitido; clássico abaixo dele vira `derby: null`.
 */
async function rivalsOf(
  db: Database,
  p: ProfileRow,
  locale: string,
  min: ReviewStatus,
): Promise<TeamRival[]> {
  const declared = new Map(p.rivals.map((r) => [r.team, r]));
  const derbyRows = await db
    .select({ d: derby, other: derbyTeam.teamSlug })
    .from(derbyTeam)
    .innerJoin(derby, eq(derby.id, derbyTeam.derbyId))
    .where(
      and(
        sql`${derbyTeam.derbyId} in (select derby_id from semantic.derby_team where team_slug = ${p.slug})`,
        sql`${derbyTeam.teamSlug} <> ${p.slug}`,
      ),
    );
  const derbyBySlug = new Map(derbyRows.map((r) => [r.d.slug, r.d]));
  const derbyByOther = new Map<string, typeof derby.$inferSelect>();
  for (const r of derbyRows) {
    const prev = derbyByOther.get(r.other);
    if (!prev || r.d.intensity > prev.intensity) derbyByOther.set(r.other, r.d);
  }
  const slugs = [...new Set([...declared.keys(), ...derbyByOther.keys()])];
  const profiles = await profilesBySlug(db, slugs);
  const out: TeamRival[] = [];
  for (const slug of slugs) {
    const other = profiles.get(slug);
    if (!other || !meetsReview(other.reviewStatus, min)) continue;
    const decl = declared.get(slug);
    const d = (decl?.derby ? derbyBySlug.get(decl.derby) : undefined) ?? derbyByOther.get(slug) ?? null;
    const derbyOk = d && meetsReview(d.reviewStatus, min) ? d : null;
    out.push({
      team: teamRef(other, locale),
      derby: derbyOk
        ? {
            slug: derbyOk.slug,
            name: pickText(derbyOk.labels as Record<string, string> | null, locale, derbyOk.name)!,
            intensity: derbyOk.intensity,
          }
        : null,
      intensity: decl?.intensity ?? d?.intensity ?? null,
      mutual: !!decl && other.rivals.some((r) => r.team === p.slug),
    });
  }
  return out.sort(
    (a, b) => (b.intensity ?? 0) - (a.intensity ?? 0) || a.team.slug.localeCompare(b.team.slug),
  );
}

/** Lista localizada de apelidos do perfil, preferindo os do mercado (usada pela copy). */
export function nicknamesFor(p: ProfileRow, locale: string): string[] {
  return [...new Set([...copyHintsFor(p.copyHints, locale).nicknames, ...pickList(p.nicknames, locale)])];
}
