import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ContextParams, ContextQuery, type CompetitionContext, type Event } from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  event,
  eventParticipant,
  participant,
  season,
  stage,
  standing,
} from '@galaxie/db';
import { knockoutStageRules, zoneLabel, type StakeLocale } from '@galaxie/rules';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import {
  buildEvents,
  DECISIVE_FAMILIES,
  eventsTtl,
  goalsOf,
  groupTies,
  KNOCKOUT_KINDS,
  loadStageMatches,
  rulesStageKey,
  type StageMatch,
} from '../../events/builder.js';
import { IN_PLAY } from '../../events/queries.js';
import { formatInstant, pickList, pickText } from '../../i18n.js';
import { competitionLogoId, teamLogoId } from '../../assets/custom-logos.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';
import { buildCtx, localeOf, sportCheck } from './events.js';

const MODULE = { module: 'core_data' } as const;
type Group = CompetitionContext['groups'][number];
type Zone = Group['zones'][number];
type ZoneKind = Zone['kind'];

/** Zonas a partir da descrição do fornecedor (sem regulamento próprio): faixas contíguas com a mesma descrição. */
export function zonesFromDescriptions(
  rows: { rank: number; description: string | null }[],
): { id: string; kind: ZoneKind; label: string; from: number; to: number }[] {
  const zones: { id: string; kind: ZoneKind; label: string; from: number; to: number }[] = [];
  for (const r of [...rows].sort((a, b) => a.rank - b.rank)) {
    if (!r.description) continue;
    const last = zones.at(-1);
    if (last && last.label === r.description && last.to === r.rank - 1) {
      last.to = r.rank;
      continue;
    }
    const kind: ZoneKind = /relegation/i.test(r.description)
      ? /play-?off/i.test(r.description)
        ? 'relegation_playoff'
        : 'relegation'
      : /promotion/i.test(r.description)
        ? 'qualification'
        : 'playoff';
    const id = r.description
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    zones.push({ id, kind, label: r.description, from: r.rank, to: r.rank });
  }
  return zones;
}

/** Contexto competitivo (docs/05 §3.1): líder, zonas, chaveamento e próximos jogos decisivos. */
export async function contextRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/competitions/:id/context', { config: MODULE }, async (request, reply) => {
    const params = parseInput(ContextParams, request.params);
    const query = parseInput(ContextQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.schedule,
      vary: [locale, tz],
      check: sportCheck(request),
      load: async () => {
        const bctx = buildCtx(ctx, locale, tz);
        const db = requireDb(ctx);
        const [c] = await db
          .select({
            c: competition,
            logoKey: asset.storageKey,
            logoUrl: asset.sourceUrl,
            profileLabels: competitionProfile.labels,
            nicknames: competitionProfile.nicknames,
          })
          .from(competition)
          .leftJoin(asset, eq(asset.id, competitionLogoId(ctx.logos.enabled())))
          .leftJoin(competitionProfile, eq(competitionProfile.competitionId, competition.id))
          .where(UUID_RE.test(params.id) ? eq(competition.id, params.id) : eq(competition.slug, params.id))
          .orderBy(sql`(${competition.sport} = 'football') desc`)
          .limit(1);
        if (!c) throw problems.notFound('Competição');
        const [s] = await db
          .select()
          .from(season)
          .where(
            and(
              eq(season.competitionId, c.c.id),
              query.season === 'current' ? eq(season.current, true) : eq(season.year, Number(query.season)),
            ),
          )
          .orderBy(desc(season.year))
          .limit(1);
        if (!s && query.season !== 'current') throw problems.notFound('Temporada');
        const rules = await ctx.rules.get(c.c.slug, s?.year ?? null);
        const labels = { ...(c.c.labels ?? {}), ...(c.profileLabels ?? {}) } as Record<string, string>;

        const ref = (p: {
          id: string;
          name: string;
          shortName: string | null;
          key: string | null;
          url: string | null;
        }) => ({
          id: p.id,
          name: p.name,
          short_name: p.shortName,
          logo: assetUrl(ctx.assetsBaseUrl, p.key, p.url),
        });

        // ── tabela: líder e zonas ──
        const groups: Group[] = [];
        if (s) {
          const rows = await db
            .select({
              st: standing,
              p: { id: participant.id, name: participant.name, shortName: participant.shortName },
              key: asset.storageKey,
              url: asset.sourceUrl,
            })
            .from(standing)
            .innerJoin(participant, eq(participant.id, standing.participantId))
            .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
            .where(eq(standing.seasonId, s.id))
            .orderBy(asc(standing.group), asc(standing.rank));
          const byGroup = new Map<string, typeof rows>();
          for (const r of rows) byGroup.set(r.st.group, [...(byGroup.get(r.st.group) ?? []), r]);
          for (const [name, list] of byGroup) {
            const team = (r: (typeof rows)[number]) => ({
              rank: r.st.rank,
              points: r.st.points,
              played: r.st.played,
              participant: ref({ ...r.p, key: r.key, url: r.url }),
            });
            const zoneDefs = rules?.league?.zones.length
              ? rules.league.zones.map((z) => ({
                  id: z.id,
                  kind: z.kind,
                  label: zoneLabel(z.id, locale as StakeLocale),
                  from: z.from,
                  to: z.to,
                }))
              : zonesFromDescriptions(list.map((r) => ({ rank: r.st.rank, description: r.st.description })));
            groups.push({
              name: name || null,
              leader: list[0] ? team(list[0]) : null,
              zones: zoneDefs.map((z) => ({
                ...z,
                teams: list.filter((r) => r.st.rank >= z.from && r.st.rank <= z.to).map(team),
              })),
            });
          }
        }

        // ── chaveamento ──
        const bracket: CompetitionContext['bracket'] = [];
        if (s) {
          const stages = (
            await db
              .select({
                id: stage.id,
                kind: stage.kind,
                name: stage.name,
                label: stage.providerLabel,
                order: stage.order,
              })
              .from(stage)
              .where(eq(stage.seasonId, s.id))
              .orderBy(asc(stage.order))
          ).filter((st) => KNOCKOUT_KINDS.has(st.kind));
          const matches = await loadStageMatches(
            db,
            stages.map((st) => st.id),
          );
          const ties = groupTies(matches.filter((m) => m.status !== 'cancelled'));
          const ids = [
            ...new Set(matches.flatMap((m) => [m.homeId, m.awayId]).filter((x): x is string => !!x)),
          ];
          const parts = ids.length
            ? await db
                .select({
                  id: participant.id,
                  name: participant.name,
                  shortName: participant.shortName,
                  key: asset.storageKey,
                  url: asset.sourceUrl,
                })
                .from(participant)
                .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
                .where(inArray(participant.id, ids))
            : [];
          const partBy = new Map(parts.map((p) => [p.id, ref(p)]));
          const winners = matches.length
            ? await db
                .select({
                  eventId: eventParticipant.eventId,
                  participantId: eventParticipant.participantId,
                  result: eventParticipant.result,
                })
                .from(eventParticipant)
                .where(
                  inArray(
                    eventParticipant.eventId,
                    matches.map((m) => m.id),
                  ),
                )
            : [];
          const winnerOf = new Map<string, string>();
          for (const w of winners)
            if ((w.result as { winner?: unknown } | null)?.winner === true)
              winnerOf.set(w.eventId, w.participantId);
          for (const st of stages) {
            const stageTies = [...ties.entries()]
              .filter(([k]) => k.startsWith(`${st.id}|`))
              .map(([, v]) => v);
            if (!stageTies.length) continue;
            const expected = rules ? knockoutStageRules(rules, rulesStageKey(st.kind, st.label)).legs : null;
            bracket.push({
              stage: {
                kind: st.kind,
                name: pickText(st.name as Record<string, string>, locale, st.label ?? st.kind),
              },
              ties: stageTies.map((legs) => tieOf(legs, partBy, winnerOf, tz, expected)),
            });
          }
        }

        // ── próximos jogos decisivos ──
        let decisive: Event[] = [];
        if (s) {
          const upcoming = await db
            .select({ id: event.id })
            .from(event)
            .where(
              and(
                eq(event.seasonId, s.id),
                inArray(event.status, ['scheduled', 'starting', ...IN_PLAY]),
                gte(event.startsAt, new Date(bctx.now.getTime() - 3 * 3600_000)),
              ),
            )
            .orderBy(asc(event.startsAt), asc(event.id))
            .limit(60);
          decisive = (
            await buildEvents(
              bctx,
              upcoming.map((u) => u.id),
            )
          )
            .filter(
              (b) => b.stakeFamilies.some((f) => DECISIVE_FAMILIES.has(f)) || b.dto.stage?.kind === 'final',
            )
            .map((b) => b.dto)
            .sort((a, b) => b.importance - a.importance || Date.parse(a.starts_at) - Date.parse(b.starts_at))
            .slice(0, 10);
        }

        const body: CompetitionContext = {
          competition: {
            id: c.c.id,
            slug: c.c.slug,
            name: pickText(labels, locale, c.c.name)!,
            nickname: pickList(c.nicknames, locale)[0] ?? null,
            logo: assetUrl(ctx.assetsBaseUrl, c.logoKey, c.logoUrl),
            type: c.c.type,
          },
          season: s ? { year: s.year, label: s.label } : null,
          format: rules?.format ?? null,
          groups,
          bracket,
          decisive_events: decisive,
        };
        return {
          body,
          tags: [`competition:${c.c.id}`, 'event', ...(s ? [`standing:${s.id}`] : [])],
          ttl: eventsTtl(decisive, bctx.now, CACHE_TTL.schedule),
          meta: { sport: c.c.sport },
        };
      },
    });
  });
}

type PartRef = { id: string; name: string; short_name: string | null; logo: string | null };

/**
 * Um confronto do chaveamento: pernas, agregado, vencedor e situação. `expectedLegs` vem do regulamento;
 * enquanto faltar alguma perna no core, o confronto não é dado como decidido.
 */
export function tieOf(
  legs: StageMatch[],
  parts: Map<string, PartRef>,
  winnerOf: Map<string, string>,
  tz: string,
  expectedLegs: number | null = null,
): CompetitionContext['bracket'][number]['ties'][number] {
  const first = legs[0]!;
  const ids = [first.homeId!, first.awayId!];
  const started = legs.filter((l) => l.status === 'finished' || IN_PLAY.includes(l.status));
  const complete = legs.length >= (expectedLegs ?? legs.length);
  const decided = complete && legs.every((l) => l.status === 'finished');
  const twoLegs = (expectedLegs ?? legs.length) === 2 && legs.length === 2;
  const totals = new Map(ids.map((id) => [id, 0]));
  let any = false;
  for (const l of started) {
    const g = goalsOf(l);
    if (!g) continue;
    any = true;
    for (const [id, n] of g) totals.set(id, (totals.get(id) ?? 0) + n);
  }
  let winner: string | null = null;
  if (decided && any) {
    const [a, b] = ids as [string, string];
    const ga = totals.get(a)!;
    const gb = totals.get(b)!;
    if (ga !== gb) winner = ga > gb ? a : b;
    else {
      const last = legs.at(-1)!;
      const pen = last.score?.penalty;
      if (pen?.home != null && pen.away != null && pen.home !== pen.away && last.homeId && last.awayId)
        winner = pen.home > pen.away ? last.homeId : last.awayId;
      else winner = winnerOf.get(last.id) ?? null;
    }
  }
  return {
    participants: ids.map((id) => parts.get(id) ?? { id, name: '', short_name: null, logo: null }),
    legs: legs.map((l, i) => ({
      event_id: l.id,
      leg: twoLegs ? i + 1 : null,
      starts_at: formatInstant(l.startsAt, tz),
      status: l.status,
      home_id: l.homeId,
      score: { home: l.score?.home ?? null, away: l.score?.away ?? null },
    })),
    aggregate:
      legs.length > 1 && any ? ids.map((id) => ({ participant_id: id, goals: totals.get(id) ?? 0 })) : null,
    winner_id: winner,
    status: decided ? 'decided' : started.length ? 'in_progress' : 'scheduled',
  };
}
