/**
 * Quem o job do canal do jogo pesquisa agora (docs/07 §2.2.4): jogos tier ≤ 2 dos próximos 5 dias e os
 * encerrados há até 72 h, por mercado com direitos conhecidos que DIVIDEM os jogos (direito exclusivo já
 * diz o canal), com relevância ≥ WTW_MIN_RELEVANCE no mercado — ou da liga principal do país (futebol,
 * tier 1, liga nacional), que entra sempre e vai na frente da fila.
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
  CHANNEL_HORIZON_MS,
  CHANNEL_POST_CLOSES_MS,
  dayBucket,
  dueChannelWindow,
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
  opts: { now: Date; filter?: ChannelEventFilter },
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
          lte(event.startsAt, new Date(opts.now.getTime() + CHANNEL_HORIZON_MS)),
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
  /** competição|rodada|janela|dia */
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

/** Canais do jogo já confirmados: evento × país → (oficial?, confirmado depois do jogo?). */
async function confirmedIndex(
  db: Database,
  eventIds: string[],
): Promise<Map<string, { official: boolean; post: boolean }>> {
  const out = new Map<string, { official: boolean; post: boolean }>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({
      eventId: matchChannel.eventId,
      country: matchChannel.countryCode,
      kind: matchChannel.sourceKind,
      post: matchChannel.postConfirmedAt,
    })
    .from(matchChannel)
    .where(and(inArray(matchChannel.eventId, eventIds), eq(matchChannel.status, 'confirmed')));
  for (const r of rows) {
    const k = `${r.eventId}:${r.country}`;
    const cur = out.get(k) ?? { official: false, post: false };
    out.set(k, { official: cur.official || r.kind === 'official', post: cur.post || r.post !== null });
  }
  return out;
}

export interface PlanChannelOptions {
  now: Date;
  markets: string[];
  config: WtwConfig;
  researched: ResearchedRightsIndex;
  policy: WtwPolicy;
  filter?: ChannelEventFilter;
  /** Com o filtro de rodada, devolve os alvos mesmo fora da janela (prévia/reexecução). */
  ignoreWindows?: boolean;
}

/** Monta os grupos devidos agora (ordem: liga principal primeiro, depois prioridade). */
export async function planChannelResearch(db: Database, opts: PlanChannelOptions): Promise<ChannelPlan> {
  const events = await loadChannelEvents(db, {
    now: opts.now,
    ...(opts.filter ? { filter: opts.filter } : {}),
  });
  const skipped: Record<TargetSkip, number> = {
    no_rights: 0,
    deterministic: 0,
    low_relevance: 0,
    already_confirmed: 0,
    no_window: 0,
  };
  // âncoras: primeiro jogo da rodada; primeiro e último de cada dia da rodada
  const roundStart = new Map<string, number>();
  const dayRange = new Map<string, [number, number]>();
  for (const e of events) {
    const g = groupKeyOf(e.slug, roundKeyOf(e.round, e.startsAt));
    const t = e.startsAt.getTime();
    roundStart.set(g, Math.min(roundStart.get(g) ?? t, t));
    const d = `${g}|${dayBucket(e.startsAt)}`;
    const [a, b] = dayRange.get(d) ?? [t, t];
    dayRange.set(d, [Math.min(a, t), Math.max(b, t)]);
  }
  const done = await confirmedIndex(
    db,
    events.map((e) => e.id),
  );
  const groups = new Map<string, ChannelGroup>();
  for (const e of events) {
    const round = roundKeyOf(e.round, e.startsAt);
    const g = groupKeyOf(e.slug, round);
    const [dayStart, dayLast] = dayRange.get(`${g}|${dayBucket(e.startsAt)}`)!;
    const due =
      dueChannelWindow(
        e,
        {
          roundStart: new Date(roundStart.get(g)!),
          dayStart: new Date(dayStart),
          dayLastStart: new Date(dayLast),
        },
        opts.now,
      ) ??
      (opts.ignoreWindows
        ? ({
            window: ['finished', 'abandoned'].includes(e.status) ? 'post' : 'T-48h',
            phase: ['finished', 'abandoned'].includes(e.status) ? 'post' : 'pre',
            bucket: 'manual',
            opensAt: opts.now,
          } satisfies ChannelWindow)
        : null);
    for (const country of opts.markets) {
      const rights = rightsForEvent(opts.config, opts.researched, e, country);
      if (!rights || !rights.holders.length) {
        skipped.no_rights++;
        continue;
      }
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
      if (!due) {
        skipped.no_window++;
        continue;
      }
      const state = done.get(`${e.id}:${country}`);
      if (state && (due.phase === 'pre' ? state.official : state.post)) {
        skipped.already_confirmed++;
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
      grp.priority = Math.max(grp.priority, priorityOf(relevance, e.startsAt, opts.now));
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
