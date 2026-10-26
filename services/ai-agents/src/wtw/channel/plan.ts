/**
 * Quem o job do canal do jogo pesquisa agora (docs/07 §2.2.4): jogos tier ≤ 2 no momento vigente
 * (consulta semanal, retentativas, depois do jogo — windows.ts) e os encerrados há até 72 h, por mercado
 * com direitos conhecidos que DIVIDEM os jogos (exclusivo e todos os jogos já dizem o canal pela tabela),
 * com relevância ≥ WTW_MIN_RELEVANCE no mercado — ou da liga principal do país (futebol, tier 1, liga
 * nacional), que entra sempre e vai na frente da fila. Jogo × mercado com canal confirmado nunca entra.
 */
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { competition, event, matchChannel, season, stage, type Database } from '@galaxie/db';
import {
  rightsAnswer,
  type ResearchedRightsIndex,
  type RightsEntry,
  type WtwConfig,
} from '@galaxie/where-to-watch';
import { groupKeyOf, roundKeyOf } from '../groups.js';
import { marketRelevance, priorityOf, type WtwPolicy } from '../relevance.js';
import { rightsForEvent } from '../scheduler.js';
import {
  CHANNEL_POST_CLOSES_MS,
  channelHorizonMs,
  channelMoments,
  dayBucket,
  dueChannelWindow,
  POST_STATUSES,
  type ChannelMoments,
  type ChannelSchedule,
  type ChannelWindow,
} from './windows.js';

export interface ChannelEvent {
  id: string;
  startsAt: Date;
  status: string;
  tier: number;
  sport: string;
  slug: string;
  name: string;
  type: string;
  countryCode: string | null;
  round: string | null;
  season: number;
  importance: number;
  participantCountries: (string | null)[];
}

export interface ChannelEventFilter {
  competition?: string;
  /** Rótulo da rodada (ex.: "Regular Season - 32") ou só o número ("32"). */
  round?: string;
  season?: number;
}

const roundMatches = (label: string | null, wanted: string) =>
  !!label && (label === wanted || (/^\d+$/.test(wanted) && new RegExp(`(^|\\D)${wanted}$`).test(label)));

/** Jogos candidatos: futuros no horizonte e encerrados há até 72 h (ou os da rodada pedida). */
export async function loadChannelEvents(
  db: Database,
  opts: { now: Date; horizonMs: number; filter?: ChannelEventFilter },
): Promise<ChannelEvent[]> {
  const f = opts.filter;
  const conds = [lte(competition.tier, 2)];
  if (f?.competition) conds.push(eq(competition.slug, f.competition));
  if (f?.season) conds.push(eq(season.year, f.season));
  if (!f?.competition)
    conds.push(
      or(
        and(
          inArray(event.status, ['scheduled', 'starting']),
          gte(event.startsAt, opts.now),
          lte(event.startsAt, new Date(opts.now.getTime() + opts.horizonMs)),
        )!,
        and(
          inArray(event.status, ['finished', 'abandoned']),
          gte(event.startsAt, new Date(opts.now.getTime() - CHANNEL_POST_CLOSES_MS)),
          lte(event.startsAt, opts.now),
        )!,
      )!,
    );
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      status: event.status,
      tier: competition.tier,
      sport: competition.sport,
      slug: competition.slug,
      name: competition.name,
      labels: competition.labels,
      type: competition.type,
      countryCode: competition.countryCode,
      round: stage.providerLabel,
      seasonYear: season.year,
      importance: event.importance,
      participantCountries: sql<(string | null)[]>`coalesce((
        select array_agg(p.country_code) from core.event_participant ep
          join core.participant p on p.id = ep.participant_id
         where ep.event_id = ${event.id}), '{}')`,
    })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(and(...conds))
    .orderBy(asc(event.startsAt));
  return rows
    .filter((r) => !f?.round || roundMatches(r.round, f.round))
    .map((r) => ({
      id: r.id,
      startsAt: r.startsAt,
      status: r.status,
      tier: r.tier,
      sport: r.sport,
      slug: r.slug,
      name: (r.labels as Record<string, string> | null)?.['pt-BR'] ?? r.name,
      type: r.type,
      countryCode: r.countryCode,
      round: r.round,
      season: r.seasonYear ?? r.startsAt.getUTCFullYear(),
      importance: r.importance,
      participantCountries: r.participantCountries ?? [],
    }));
}

/** Liga principal do mercado: futebol, liga nacional, tier 1 do país. */
export const isMainLeague = (
  e: Pick<ChannelEvent, 'sport' | 'type' | 'tier' | 'countryCode'>,
  market: string,
) => e.sport === 'football' && e.type === 'league' && e.tier === 1 && e.countryCode === market;

export type TargetSkip = 'no_rights' | 'deterministic' | 'low_relevance' | 'already_confirmed' | 'no_window';

export interface ChannelTarget {
  event: ChannelEvent;
  country: string;
  rights: RightsEntry;
  holders: string[];
  relevance: number;
  mainLeague: boolean;
}

export interface ChannelGroup {
  /** competição|rodada|momento|bucket */
  key: string;
  competition: { slug: string; name: string };
  round: string;
  season: number;
  window: ChannelWindow;
  targets: ChannelTarget[];
  mainLeague: boolean;
  priority: number;
}

export interface ChannelPlan {
  groups: ChannelGroup[];
  /** Jogo × mercado fora da pesquisa, por motivo. */
  skipped: Record<TargetSkip, number>;
  events: ChannelEvent[];
}

/** Jogos × países (`evento:país`) com canal do jogo confirmado. */
async function confirmedTargets(db: Database, eventIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({ eventId: matchChannel.eventId, country: matchChannel.countryCode })
    .from(matchChannel)
    .where(and(inArray(matchChannel.eventId, eventIds), eq(matchChannel.status, 'confirmed')));
  for (const r of rows) out.add(`${r.eventId}:${r.country}`);
  return out;
}

export interface PlanChannelOptions {
  now: Date;
  markets: string[];
  config: WtwConfig;
  researched: ResearchedRightsIndex;
  policy: WtwPolicy;
  /** Momentos (WTW_CHANNEL_*): consulta semanal, retentativas e pós-jogo. */
  schedule: ChannelSchedule;
  filter?: ChannelEventFilter;
  /** Com o filtro de rodada, devolve os alvos mesmo fora dos momentos (prévia/reexecução). */
  ignoreWindows?: boolean;
}

/** Monta os grupos devidos agora (ordem: liga principal primeiro, depois prioridade). */
export async function planChannelResearch(db: Database, opts: PlanChannelOptions): Promise<ChannelPlan> {
  const moments = channelMoments(opts.schedule, opts.now);
  const events = await loadChannelEvents(db, {
    now: opts.now,
    horizonMs: channelHorizonMs(moments, opts.now),
    ...(opts.filter ? { filter: opts.filter } : {}),
  });
  const confirmed = await confirmedTargets(
    db,
    events.map((e) => e.id),
  );
  return buildChannelPlan(events, { ...opts, moments, confirmed });
}

export interface BuildChannelPlanOptions extends Omit<PlanChannelOptions, 'schedule' | 'filter'> {
  moments: ChannelMoments;
  /** `evento:país` com canal confirmado. */
  confirmed: ReadonlySet<string>;
}

/**
 * Parte pura do plano: momento vigente de cada jogo e quem entra por mercado. Exclusivo e "todos os
 * jogos" saem pela tabela de direitos (`deterministic`) e nunca são pesquisados; com canal confirmado
 * no mercado, o jogo não volta à pesquisa — nem antes (retentativas) nem depois (pós-jogo).
 */
export function buildChannelPlan(events: ChannelEvent[], opts: BuildChannelPlanOptions): ChannelPlan {
  const { now, moments } = opts;
  const skipped: Record<TargetSkip, number> = {
    no_rights: 0,
    deterministic: 0,
    low_relevance: 0,
    already_confirmed: 0,
    no_window: 0,
  };
  // âncoras: primeiro jogo ainda por começar da rodada; último jogo de cada dia da rodada (pós-jogo)
  const roundStart = new Map<string, number>();
  const dayLast = new Map<string, number>();
  for (const e of events) {
    const g = groupKeyOf(e.slug, roundKeyOf(e.round, e.startsAt));
    const t = e.startsAt.getTime();
    if (!POST_STATUSES.has(e.status) && t > now.getTime())
      roundStart.set(g, Math.min(roundStart.get(g) ?? t, t));
    const d = `${g}|${dayBucket(e.startsAt)}`;
    dayLast.set(d, Math.max(dayLast.get(d) ?? t, t));
  }
  const groups = new Map<string, ChannelGroup>();
  for (const e of events) {
    const round = roundKeyOf(e.round, e.startsAt);
    const g = groupKeyOf(e.slug, round);
    const finished = POST_STATUSES.has(e.status);
    const due =
      dueChannelWindow(
        e,
        {
          roundStart: new Date(roundStart.get(g) ?? e.startsAt.getTime()),
          dayLastStart: new Date(dayLast.get(`${g}|${dayBucket(e.startsAt)}`)!),
        },
        moments,
        now,
      ) ??
      (opts.ignoreWindows
        ? ({
            window: 'manual',
            phase: finished ? 'post' : 'pre',
            bucket: 'manual',
            opensAt: now,
          } satisfies ChannelWindow)
        : null);
    for (const country of opts.markets) {
      const rights = rightsForEvent(opts.config, opts.researched, e, country);
      if (!rights || !rights.holders.length) {
        skipped.no_rights++;
        continue;
      }
      // exclusive / all_matches (e linhas cujos detentores têm todos os jogos): a tabela já responde
      const answer = rightsAnswer(rights, { home: null, away: null, participants: [], round: e.round });
      if (!answer.needsAllocation) {
        skipped.deterministic++;
        continue;
      }
      const mainLeague = isMainLeague(e, country);
      const relevance = marketRelevance(
        {
          importance: e.importance,
          participantCountries: e.participantCountries,
          competitionCountry: e.countryCode,
          competition: { sport: e.sport, slug: e.slug },
        },
        country,
      );
      if (!mainLeague && relevance < opts.policy.minRelevance) {
        skipped.low_relevance++;
        continue;
      }
      if (opts.confirmed.has(`${e.id}:${country}`)) {
        skipped.already_confirmed++;
        continue;
      }
      if (!due) {
        skipped.no_window++;
        continue;
      }
      const key = `${g}|${due.window}|${due.bucket}`;
      const grp =
        groups.get(key) ??
        ({
          key,
          competition: { slug: e.slug, name: e.name },
          round,
          season: e.season,
          window: due,
          targets: [],
          mainLeague: false,
          priority: 0,
        } satisfies ChannelGroup);
      grp.targets.push({ event: e, country, rights, holders: answer.toAllocate, relevance, mainLeague });
      grp.mainLeague ||= mainLeague;
      grp.priority = Math.max(grp.priority, priorityOf(relevance, e.startsAt, now));
      groups.set(key, grp);
    }
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) => Number(b.mainLeague) - Number(a.mainLeague) || b.priority - a.priority,
    ),
    skipped,
    events,
  };
}
