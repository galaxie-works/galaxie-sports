/**
 * Mundo falso da api-sports para testes (unitários e de integração) — nenhuma chamada real.
 * Gera ligas, times, partidas, h2h, elencos e técnicos determinísticos e registra cada requisição recebida.
 */
import {
  ApiSportsClient,
  defaultPolicy,
  FREE_PLAN,
  InMemoryQuotaGovernor,
  InMemoryRawStore,
  PlanRules,
  RateLimiter,
  type Clock,
  type PlanLimits,
} from '@galaxie/apisports-client';
import type { CatalogCompetition } from '../catalog/catalog-config.js';
import type { ApiLeague } from '../catalog/football-catalog.js';
import { StaticCatalogSource, type CompetitionInfo, type Coverage } from '../jobs/catalog-source.js';
import { InMemoryCursorStore } from '../jobs/runtime/cursor-store.js';
import { InMemoryJobRunStore } from '../jobs/runtime/job-run-store.js';
import { InMemoryRawSource } from '../jobs/runtime/raw-source.js';
import type { RunDeps } from '../jobs/runtime/runner.js';

export const NOW = '2026-10-21T01:00:00Z';
export const CURRENT_SEASON = 2026;

export interface FakeLeague {
  id: number;
  name: string;
  type: 'league' | 'cup';
  seasons: number[];
  teams: number[];
}

/** 71: tier 1 (liga) · 13: tier 1 (copa) · 72: tier 2 · 999: fora do catálogo (tier 3). 121 × 131 é clássico. */
export const LEAGUES: FakeLeague[] = [
  {
    id: 71,
    name: 'Serie A',
    type: 'league',
    seasons: [2021, 2022, 2023, 2024, 2025, 2026],
    teams: [121, 131, 126, 128],
  },
  {
    id: 13,
    name: 'CONMEBOL Libertadores',
    type: 'cup',
    seasons: [2023, 2024, 2026],
    teams: [121, 435, 451, 1062],
  },
  {
    id: 72,
    name: 'Serie B',
    type: 'league',
    seasons: [2022, 2023, 2024, 2025, 2026],
    teams: [7201, 7202, 7203, 7204],
  },
  {
    id: 999,
    name: 'Liga Qualquer',
    type: 'league',
    seasons: [2024, 2026],
    teams: [99901, 99902, 99903, 99904],
  },
];

export const FULL_COVERAGE: Coverage = {
  fixtures: { events: true, lineups: true, statistics_fixtures: true, statistics_players: true },
  standings: true,
  players: true,
  top_scorers: true,
  top_assists: true,
  top_cards: true,
  injuries: true,
};

const COVERAGE_BY_LEAGUE: Record<number, Coverage> = {
  71: FULL_COVERAGE,
  13: { ...FULL_COVERAGE, injuries: false },
  72: { ...FULL_COVERAGE, standings: false, top_cards: false },
  999: FULL_COVERAGE,
};

/** Resposta de /leagues do mundo falso (formato da api-sports). */
export function fakeLeaguesResponse(): ApiLeague[] {
  return LEAGUES.map((l) => ({
    league: {
      id: l.id,
      name: l.name,
      type: l.type === 'cup' ? 'Cup' : 'League',
      logo: `https://media.api-sports.io/football/leagues/${l.id}.png`,
    },
    country:
      l.id === 13
        ? { name: 'World', code: null, flag: null }
        : { name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
    seasons: l.seasons.map((y) => ({
      year: y,
      start: `${y}-01-15`,
      end: `${y}-12-15`,
      current: y === CURRENT_SEASON,
      coverage: COVERAGE_BY_LEAGUE[l.id],
    })),
  }));
}

/** Equivalente ao config/competitions/football.yaml do mundo falso (999 fica fora: tier 3). */
export function fakeCatalogConfig(): CatalogCompetition[] {
  return fakeCatalog().map((c) => ({
    slug: c.slug,
    name: c.name,
    country: c.countryName ?? 'World',
    type: c.type === 'cup' ? 'cup' : 'league',
    api_sports_id: c.leagueId,
    tier: c.tier,
    live_priority: c.tier === 1 ? 'high' : 'low',
  }));
}

/** Catálogo como o core o teria depois do bootstrap:catalog. */
export function fakeCatalog(): CompetitionInfo[] {
  const info = (
    l: FakeLeague,
    tier: number,
    coverage: Coverage,
    country: [string | null, string | null],
  ) => ({
    leagueId: l.id,
    slug: `liga-${l.id}`,
    name: l.name,
    type: l.type,
    tier,
    livePriority: tier === 1 ? 'high' : 'low',
    countryCode: country[0],
    countryName: country[1],
    seasons: l.seasons.map((y) => ({
      year: y,
      current: y === CURRENT_SEASON,
      startDate: `${y}-01-15`,
      endDate: `${y}-12-15`,
      coverage,
    })),
  });
  return [
    info(LEAGUES[0]!, 1, COVERAGE_BY_LEAGUE[71]!, ['BR', 'Brazil']),
    info(LEAGUES[1]!, 1, COVERAGE_BY_LEAGUE[13]!, ['WORLD', null]),
    info(LEAGUES[2]!, 2, COVERAGE_BY_LEAGUE[72]!, ['BR', 'Brazil']),
  ];
}

const DAY = 86_400_000;

export interface FakeFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; season: number; round: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

/**
 * Turno e returno entre os 4 times (12 jogos por temporada). Temporada atual: um jogo por dia de
 * 15/10 a 26/10/2026 (encerrados antes de "hoje", ao vivo hoje, a disputar depois). Copa: o último é a "Final".
 */
export function seasonFixtures(l: FakeLeague, season: number, now: Date): FakeFixture[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < l.teams.length; i++)
    for (let j = i + 1; j < l.teams.length; j++) pairs.push([l.teams[i]!, l.teams[j]!]);
  const games = [...pairs, ...pairs.map(([a, b]) => [b, a] as [number, number])];
  const base =
    season === CURRENT_SEASON ? Date.parse('2026-10-15T20:00:00Z') : Date.parse(`${season}-05-01T20:00:00Z`);
  const today = now.toISOString().slice(0, 10);
  return games.map(([home, away], k) => {
    const date = new Date(base + k * DAY).toISOString();
    const day = date.slice(0, 10);
    const status = day < today ? 'FT' : day === today ? '1H' : 'NS';
    const finished = status === 'FT';
    return {
      fixture: { id: season * 100_000 + l.id * 100 + k, date, status: { short: status } },
      league: {
        id: l.id,
        season,
        round: l.type === 'cup' && k === games.length - 1 ? 'Final' : `Regular Season - ${k + 1}`,
      },
      teams: { home: { id: home, name: `Time ${home}` }, away: { id: away, name: `Time ${away}` } },
      goals: { home: finished ? 1 : null, away: finished ? 0 : null },
    };
  });
}

export function allFixtures(now: Date): FakeFixture[] {
  return LEAGUES.flatMap((l) => l.seasons.flatMap((s) => seasonFixtures(l, s, now)));
}

const envelope = (
  endpoint: string,
  params: Record<string, string>,
  response: unknown[],
  paging?: number,
) => ({
  get: endpoint.slice(1),
  parameters: params,
  errors: [],
  results: response.length,
  paging: { current: Number(params.page ?? 1), total: paging ?? 1 },
  response,
});

export interface FakeApi {
  calls: URL[];
  fetchFn: typeof globalThis.fetch;
  /** Faz a próxima resposta voltar com este objeto de erro (ex.: `{ plan: '...' }`). */
  failNext(errors: Record<string, string>, times?: number): void;
}

/** Servidor falso: responde cada endpoint do futebol (e `/games` dos demais esportes) a partir do mundo acima. */
export function fakeApi(now: () => Date): FakeApi {
  const calls: URL[] = [];
  let failing: { errors: Record<string, string>; times: number } | undefined;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    if (new Headers(init?.headers).get('x-apisports-key') !== 'test-key') {
      return new Response(JSON.stringify({ errors: { token: 'invalid' }, response: [] }));
    }
    const params = Object.fromEntries(url.searchParams);
    if (failing && failing.times > 0) {
      failing.times -= 1;
      return new Response(JSON.stringify({ ...envelope(url.pathname, params, []), errors: failing.errors }));
    }
    const body = route(url.pathname, params, now());
    // sem header de cota: o fornecedor falso não tem conta para contar, e o piso fica com o ledger
    return new Response(JSON.stringify(body));
  }) as typeof globalThis.fetch;
  return {
    calls,
    fetchFn,
    failNext(errors, times = 1) {
      failing = { errors, times };
    },
  };
}

function route(path: string, p: Record<string, string>, now: Date) {
  const fixtures = () => allFixtures(now);
  const league = LEAGUES.find((l) => String(l.id) === p.league);
  switch (path) {
    case '/leagues':
      return envelope(path, p, fakeLeaguesResponse());
    case '/countries':
      return envelope(path, p, [
        { name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
      ]);
    case '/fixtures': {
      if (p.id) return envelope(path, p, detail(fixtures().filter((f) => String(f.fixture.id) === p.id)));
      if (p.ids) {
        const ids = new Set(p.ids.split('-'));
        return envelope(path, p, detail(fixtures().filter((f) => ids.has(String(f.fixture.id)))));
      }
      if (p.date)
        return envelope(
          path,
          p,
          fixtures().filter((f) => f.fixture.date.startsWith(p.date!)),
        );
      if (league && p.season) return envelope(path, p, seasonFixtures(league, Number(p.season), now));
      return envelope(path, p, []);
    }
    case '/fixtures/headtohead': {
      const [a, b] = (p.h2h ?? '').split('-').map(Number);
      return envelope(
        path,
        p,
        fixtures().filter(
          (f) =>
            (f.teams.home.id === a && f.teams.away.id === b) ||
            (f.teams.home.id === b && f.teams.away.id === a),
        ),
      );
    }
    case '/teams':
      return envelope(
        path,
        p,
        (league?.teams ?? []).map((id) => ({
          team: { id, name: `Time ${id}`, country: 'Brazil', national: false },
          venue: { id: id + 50_000, name: `Estádio ${id}` },
        })),
      );
    case '/players/squads':
      return envelope(path, p, [
        {
          team: { id: Number(p.team) },
          players: Array.from({ length: 25 }, (_, i) => ({
            id: Number(p.team) * 1000 + i,
            name: `Jogador ${i}`,
          })),
        },
      ]);
    case '/coachs':
      return envelope(path, p, [
        {
          id: Number(p.team) * 10,
          career: [{ team: { id: Number(p.team) }, start: '2025-01-01', end: null }],
        },
        {
          id: Number(p.team) * 10 + 1,
          career: [{ team: { id: Number(p.team) }, start: '2020-01-01', end: '2024-12-31' }],
        },
      ]);
    case '/players':
      return envelope(path, p, [{ player: { id: Number(p.page ?? 1) } }], 3);
    default:
      return envelope(path, p, []);
  }
}

function detail(list: FakeFixture[]) {
  return list.map((f) => ({ ...f, events: [], lineups: [], statistics: [], players: [] }));
}

export interface Harness {
  clock: Clock & { t: number };
  api: FakeApi;
  store: InMemoryRawStore;
  governor: InMemoryQuotaGovernor;
  client: ApiSportsClient;
  cursors: InMemoryCursorStore;
  runs: InMemoryJobRunStore;
  raw: InMemoryRawSource;
  catalog: StaticCatalogSource;
  plan: PlanRules;
  deps: RunDeps;
  /** Libera a folga do dia para o BOOTSTRAP (como o `--sem-live`). */
  dayWithoutLive(): Promise<void>;
  nextDay(): void;
}

export interface HarnessOptions {
  plan?: PlanLimits;
  dailyLimit?: number;
  now?: string;
}

/** Cliente real + servidor falso + stores em memória, com relógio controlado. */
export function harness(opts: HarnessOptions = {}): Harness {
  const clock: Clock & { t: number } = {
    t: Date.parse(opts.now ?? NOW),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  };
  const now = () => new Date(clock.t);
  const api = fakeApi(now);
  const store = new InMemoryRawStore();
  const limits = opts.plan ?? FREE_PLAN;
  const governor = new InMemoryQuotaGovernor(() => defaultPolicy(opts.dailyLimit ?? limits.dailyLimit), now);
  const plan = new PlanRules(limits);
  const client = new ApiSportsClient({
    apiKey: 'test-key',
    store,
    governor,
    fetch: api.fetchFn,
    clock,
    plan,
    rateLimiter: new RateLimiter(600_000, clock),
  });
  const cursors = new InMemoryCursorStore();
  const runs = new InMemoryJobRunStore();
  const raw = new InMemoryRawSource(store.records);
  const catalog = new StaticCatalogSource(fakeCatalog());
  return {
    clock,
    api,
    store,
    governor,
    client,
    cursors,
    runs,
    raw,
    catalog,
    plan,
    deps: { client, cursors, runs, raw, plan, now },
    async dayWithoutLive() {
      const day = now().toISOString().slice(0, 10);
      await governor.plan('football', day, { LIVE: 0, DAILY: 0 });
    },
    nextDay() {
      clock.t += DAY;
    },
  };
}
