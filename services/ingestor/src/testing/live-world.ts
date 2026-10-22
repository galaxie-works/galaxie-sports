/**
 * Mundo falso do ao vivo para testes e simulações (nenhuma chamada real): partidas com roteiro
 * (apito, gols, prorrogação, pênaltis, atraso), um `fetch` falso da api-sports que responde
 * `fixtures?live=` e `fixtures?id=` pelo relógio simulado, janelas de pane (5xx) e o cliente real
 * (`ApiSportsClient` + `InMemoryQuotaGovernor`) para que a cota seja contada como em produção.
 */
import {
  ApiSportsClient,
  defaultPolicy,
  FREE_PLAN,
  InMemoryQuotaGovernor,
  InMemoryRawStore,
  PlanRules,
  PRO_PLAN,
  RateLimiter,
  type Clock,
  type PlanLimits,
  type QuotaGovernor,
  type RawStore,
} from '@galaxie/apisports-client';
import type { ApiFixture } from '@galaxie/providers';
import { InMemoryLiveStore, type SeedEvent } from '../live/memory-store.js';
import type { LiveClock } from '../live/runner.js';
import type { LivePriority } from '../live/types.js';

const MIN = 60_000;

/** Relógio simulado: `sleep` avança o tempo na hora. Serve ao RateLimiter e ao runner. */
export class SimClock implements Clock, LiveClock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.t += Math.max(0, ms);
    await Promise.resolve();
  }
  set(at: Date): void {
    this.t = at.getTime();
  }
}

export interface WorldGoal {
  /** Minuto de jogo (1–90, 91–120 na prorrogação). */
  minute: number;
  side: 'home' | 'away';
}

export interface WorldMatch {
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  round: string;
  home: string;
  away: string;
  kickoff: Date;
  /** Atraso real do apito (min). */
  delayMin?: number;
  goals: WorldGoal[];
  /** Vai à prorrogação (e, com `penalties`, aos pênaltis). */
  extraTime?: boolean;
  penalties?: { home: number; away: number };
  /** Metadados do catálogo/core para o seed. */
  tier: number;
  livePriority: LivePriority;
  stageKind: string;
  derby?: boolean;
  importance?: number;
}

export interface MatchState {
  short: string;
  elapsed: number | null;
  extra: number | null;
  home: number | null;
  away: number | null;
  inPlay: boolean;
  goals: WorldGoal[];
}

const IN_PLAY = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);

/** Instante real (min depois do apito efetivo) em que um minuto de jogo acontece. */
export function realOffset(minute: number): number {
  if (minute <= 45) return minute;
  if (minute <= 90) return 62 + (minute - 46);
  return 115 + (minute - 91);
}

/** Estado da partida em `at`, pelo roteiro. */
export function matchState(m: WorldMatch, at: Date): MatchState {
  const t = (at.getTime() - m.kickoff.getTime()) / MIN - (m.delayMin ?? 0);
  const scored = m.goals.filter((g) => realOffset(g.minute) <= t);
  const count = (side: 'home' | 'away') => scored.filter((g) => g.side === side).length;
  const base = { home: count('home'), away: count('away'), goals: scored };
  if (t < 0)
    return { short: 'NS', elapsed: null, extra: null, home: null, away: null, inPlay: false, goals: [] };
  if (t < 47) {
    const e = Math.floor(t);
    return { short: '1H', elapsed: Math.min(45, e), extra: e > 45 ? e - 45 : null, inPlay: true, ...base };
  }
  if (t < 62) return { short: 'HT', elapsed: 45, extra: null, inPlay: true, ...base };
  if (t < 110) {
    const e = 46 + Math.floor(t - 62);
    return { short: '2H', elapsed: Math.min(90, e), extra: e > 90 ? e - 90 : null, inPlay: true, ...base };
  }
  if (!m.extraTime) return { short: 'FT', elapsed: 90, extra: null, inPlay: false, ...base };
  if (t < 115) return { short: 'BT', elapsed: 90, extra: null, inPlay: true, ...base };
  if (t < 147)
    return {
      short: 'ET',
      elapsed: Math.min(120, 91 + Math.floor(t - 115)),
      extra: null,
      inPlay: true,
      ...base,
    };
  if (!m.penalties) return { short: 'AET', elapsed: 120, extra: null, inPlay: false, ...base };
  if (t < 160) return { short: 'P', elapsed: 120, extra: null, inPlay: true, ...base };
  return { short: 'PEN', elapsed: 120, extra: null, inPlay: false, ...base };
}

const LONG: Record<string, string> = {
  NS: 'Not Started',
  '1H': 'First Half',
  HT: 'Halftime',
  '2H': 'Second Half',
  BT: 'Break Time',
  ET: 'Extra Time',
  P: 'Penalty In Progress',
  FT: 'Match Finished',
  AET: 'Match Finished',
  PEN: 'Match Finished',
};

/** Partida no formato da api-sports em `at`. */
export function apiFixture(m: WorldMatch, at: Date, teamIds: (name: string) => number): ApiFixture {
  const s = matchState(m, at);
  const started = s.short !== 'NS';
  const actual = m.kickoff.getTime() + (m.delayMin ?? 0) * MIN;
  const ft = (side: 'home' | 'away') => s.goals.filter((g) => g.side === side && g.minute <= 90).length;
  const et = (side: 'home' | 'away') => s.goals.filter((g) => g.side === side && g.minute > 90).length;
  const ht = (side: 'home' | 'away') => s.goals.filter((g) => g.side === side && g.minute <= 45).length;
  const inEt = ['ET', 'BT', 'P', 'AET', 'PEN'].includes(s.short) && m.extraTime;
  const penaltyDone = s.short === 'PEN' && m.penalties;
  return {
    fixture: {
      id: m.fixtureId,
      referee: null,
      timezone: 'UTC',
      date: m.kickoff.toISOString(),
      timestamp: Math.floor(m.kickoff.getTime() / 1000),
      periods: { first: started ? Math.floor(actual / 1000) : null, second: null },
      venue: { id: null, name: null, city: null },
      status: { long: LONG[s.short] ?? s.short, short: s.short, elapsed: s.elapsed, extra: s.extra },
    },
    league: {
      id: m.leagueId,
      name: m.leagueName,
      country: 'World',
      logo: null,
      flag: null,
      season: 2026,
      round: m.round,
    },
    teams: {
      home: { id: teamIds(m.home), name: m.home, logo: null, winner: null },
      away: { id: teamIds(m.away), name: m.away, logo: null, winner: null },
    },
    goals: { home: s.home, away: s.away },
    score: {
      halftime:
        started && s.short !== '1H' ? { home: ht('home'), away: ht('away') } : { home: null, away: null },
      fulltime: s.inPlay || !started ? { home: null, away: null } : { home: ft('home'), away: ft('away') },
      extratime: inEt ? { home: et('home'), away: et('away') } : { home: null, away: null },
      penalty: penaltyDone
        ? { home: m.penalties!.home, away: m.penalties!.away }
        : { home: null, away: null },
    },
    events: s.goals.map((g) => ({
      time: { elapsed: g.minute, extra: null },
      team: { id: teamIds(g.side === 'home' ? m.home : m.away), name: g.side === 'home' ? m.home : m.away },
      player: { id: null, name: null },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    })),
  };
}

export interface Outage {
  from: Date;
  to: Date;
  status?: number;
}

export interface LiveWorldOptions {
  matches: WorldMatch[];
  plan?: 'free' | 'pro';
  start: Date;
  outages?: Outage[];
  reservePercent?: number;
  /** Integração: Governor e raw sobre o Postgres (padrão: em memória). */
  governor?: (now: () => Date) => QuotaGovernor;
  rawStore?: RawStore;
  /** Embrulha o `fetch` falso (ex.: a simulação de desenvolvimento acrescenta cartões e substituições). */
  wrapFetch?: (fetchFn: typeof globalThis.fetch) => typeof globalThis.fetch;
}

/** Mundo completo: relógio, servidor falso, cliente real com Governor em memória e armazenamento. */
export function liveWorld(opts: LiveWorldOptions) {
  const clock = new SimClock(opts.start.getTime());
  const limits: PlanLimits = opts.plan === 'pro' ? PRO_PLAN : FREE_PLAN;
  const teamIdsByName = new Map<string, number>();
  const teamIds = (name: string) => {
    if (!teamIdsByName.has(name)) teamIdsByName.set(name, 1000 + teamIdsByName.size);
    return teamIdsByName.get(name)!;
  };
  const requests: { at: Date; path: string; params: Record<string, string>; status: number }[] = [];

  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const at = new Date(clock.now());
    const params = Object.fromEntries(url.searchParams);
    const outage = (opts.outages ?? []).find((o) => at >= o.from && at < o.to);
    if (outage) {
      requests.push({ at, path: url.pathname, params, status: outage.status ?? 503 });
      return new Response('Service Unavailable', { status: outage.status ?? 503 });
    }
    requests.push({ at, path: url.pathname, params, status: 200 });
    let response: ApiFixture[] = [];
    if (url.pathname === '/fixtures' && params.live) {
      const leagues = params.live === 'all' ? null : new Set(params.live.split('-').map(Number));
      response = opts.matches
        .filter((m) => (!leagues || leagues.has(m.leagueId)) && IN_PLAY.has(matchState(m, at).short))
        .map((m) => apiFixture(m, at, teamIds));
    } else if (url.pathname === '/fixtures' && params.id) {
      response = opts.matches
        .filter((m) => String(m.fixtureId) === params.id)
        .map((m) => ({ ...apiFixture(m, at, teamIds), lineups: [], statistics: [], players: [] }));
    }
    return new Response(
      JSON.stringify({
        get: 'fixtures',
        parameters: params,
        errors: [],
        results: response.length,
        paging: { current: 1, total: 1 },
        response,
      }),
      { headers: { 'x-ratelimit-requests-remaining': '100' } },
    );
  }) as typeof globalThis.fetch;

  const memoryGovernor = new InMemoryQuotaGovernor(
    () => defaultPolicy(limits.dailyLimit, opts.reservePercent ?? 15),
    () => new Date(clock.now()),
  );
  const governor: QuotaGovernor = opts.governor?.(() => new Date(clock.now())) ?? memoryGovernor;
  const client = new ApiSportsClient({
    apiKey: 'test-key',
    store: opts.rawStore ?? new InMemoryRawStore(),
    governor,
    plan: new PlanRules(limits),
    rateLimiter: new RateLimiter(limits.perMinute, clock),
    fetch: opts.wrapFetch ? opts.wrapFetch(fetchFn) : fetchFn,
    clock,
  });

  const seeds: SeedEvent[] = opts.matches.map((m) => ({
    eventId: `ev-${m.fixtureId}`,
    providerEventId: String(m.fixtureId),
    sport: 'football',
    competitionId: `comp-${m.leagueId}`,
    providerCompetitionId: String(m.leagueId),
    seasonId: `season-${m.leagueId}`,
    startsAt: m.kickoff,
    tier: m.tier,
    livePriority: m.livePriority,
    stageKind: m.stageKind,
    derby: m.derby ?? false,
    importance: m.importance ?? 0,
    label: `${m.home} x ${m.away}`,
  }));
  const store = new InMemoryLiveStore().seed(seeds);

  return { clock, client, governor, store, requests, limits, matches: opts.matches, fetchFn, teamIds };
}

/** Uma quarta-feira cheia (21/10/2026, UTC): Champions à tarde, Brasil e Argentina à noite, México de madrugada. */
export function wednesdayNight(): WorldMatch[] {
  const at = (iso: string) => new Date(iso);
  const g = (...goals: [number, 'home' | 'away'][]) => goals.map(([minute, side]) => ({ minute, side }));
  const ucl = {
    leagueId: 2,
    leagueName: 'UEFA Champions League',
    round: 'League Stage - 3',
    tier: 1,
    livePriority: 'high' as const,
    stageKind: 'league_phase',
  };
  const bra = {
    leagueId: 71,
    leagueName: 'Serie A',
    round: 'Regular Season - 30',
    tier: 1,
    livePriority: 'high' as const,
    stageKind: 'regular',
  };
  return [
    {
      ...ucl,
      fixtureId: 9001,
      home: 'Bayern',
      away: 'Brugge',
      kickoff: at('2026-10-21T16:45:00Z'),
      goals: g([12, 'home'], [58, 'home'], [77, 'away']),
    },
    {
      ...ucl,
      fixtureId: 9002,
      home: 'Real Madrid',
      away: 'Juventus',
      kickoff: at('2026-10-21T19:00:00Z'),
      goals: g([33, 'home']),
    },
    {
      ...ucl,
      fixtureId: 9003,
      home: 'Liverpool',
      away: 'Frankfurt',
      kickoff: at('2026-10-21T19:00:00Z'),
      goals: g([5, 'home'], [44, 'away'], [88, 'home']),
    },
    {
      ...bra,
      fixtureId: 9101,
      home: 'Palmeiras',
      away: 'Corinthians',
      kickoff: at('2026-10-21T22:00:00Z'),
      derby: true,
      importance: 30,
      goals: g([21, 'home'], [90, 'away']),
    },
    {
      ...bra,
      fixtureId: 9102,
      home: 'Bahia',
      away: 'Fortaleza',
      kickoff: at('2026-10-21T22:00:00Z'),
      delayMin: 4,
      goals: g([66, 'away']),
    },
    {
      ...bra,
      fixtureId: 9103,
      home: 'Gremio',
      away: 'Cruzeiro',
      kickoff: at('2026-10-21T23:30:00Z'),
      goals: [],
    },
    {
      leagueId: 128,
      leagueName: 'Liga Profesional Argentina',
      round: '2nd Phase - 14',
      tier: 1,
      livePriority: 'high',
      stageKind: 'regular',
      fixtureId: 9201,
      home: 'Racing',
      away: 'Huracan',
      kickoff: at('2026-10-21T23:00:00Z'),
      goals: g([50, 'home']),
    },
    {
      ...bra,
      fixtureId: 9104,
      home: 'Flamengo',
      away: 'Vasco',
      kickoff: at('2026-10-22T00:30:00Z'),
      derby: true,
      importance: 30,
      goals: g([9, 'home'], [47, 'home'], [80, 'away']),
    },
    {
      leagueId: 13,
      leagueName: 'CONMEBOL Libertadores',
      round: 'Semi-finals',
      tier: 1,
      livePriority: 'high',
      stageKind: 'semi_final',
      fixtureId: 9301,
      home: 'Racing Club',
      away: 'Botafogo',
      kickoff: at('2026-10-22T00:30:00Z'),
      importance: 40,
      goals: g([30, 'away']),
    },
    {
      leagueId: 262,
      leagueName: 'Liga MX',
      round: 'Apertura - 14',
      tier: 1,
      livePriority: 'medium',
      stageKind: 'regular',
      fixtureId: 9401,
      home: 'America',
      away: 'Guadalajara',
      kickoff: at('2026-10-22T02:00:00Z'),
      derby: true,
      goals: g([70, 'away']),
    },
    // fora do ao vivo: liga sem prioridade
    {
      leagueId: 999,
      leagueName: 'Liga Qualquer',
      round: 'Regular Season - 3',
      tier: 3,
      livePriority: 'none',
      stageKind: 'regular',
      fixtureId: 9901,
      home: 'Time A',
      away: 'Time B',
      kickoff: at('2026-10-21T22:00:00Z'),
      goals: g([10, 'home']),
    },
  ];
}

/** Final em jogo único com prorrogação e pênaltis (1 x 1, 2 x 2 na prorrogação, 4 x 3 nos pênaltis). */
export function cupFinal(): WorldMatch {
  return {
    fixtureId: 9500,
    leagueId: 73,
    leagueName: 'Copa Do Brasil',
    round: 'Final',
    home: 'Atletico-MG',
    away: 'Flamengo',
    kickoff: new Date('2026-10-21T22:00:00Z'),
    goals: [
      { minute: 30, side: 'home' },
      { minute: 75, side: 'away' },
      { minute: 98, side: 'home' },
      { minute: 117, side: 'away' },
    ],
    extraTime: true,
    penalties: { home: 4, away: 3 },
    tier: 1,
    livePriority: 'high',
    stageKind: 'final',
    importance: 60,
  };
}
