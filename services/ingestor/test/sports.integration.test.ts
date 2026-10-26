import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiSportsClient,
  defaultPolicy,
  FREE_PLAN,
  normalizeParams,
  PgQuotaGovernor,
  PgRawStore,
  PlanRules,
  RateLimiter,
  requestHash,
} from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  competition,
  jobRun,
  participant,
  providerMap,
  season,
  venue,
  type Database,
} from '@galaxie/db';
import { planSportCatalog, runSportCatalogJob } from '../src/bootstrap/sport-catalog-job.js';
import type { SportCatalogCompetition } from '../src/catalog/catalog-config.js';
import { upsertCatalog } from '../src/catalog/persist.js';
import { SPORT_PROFILES } from '../src/catalog/sport-catalog.js';
import { BASKETBALL_CATALOG, BASKETBALL_COUNTRIES, BASKETBALL_LEAGUES } from './fixtures.js';
import { disposableDb, envelope } from './db.js';

const TODAY = new Date();
const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
}, 60_000);
afterAll(() => testDb.teardown());

/** fetch falso das APIs de dados: devolve `responses[endpoint]` e registra as chamadas. */
function fakeApi(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(`${url.hostname.split('.')[1]}${url.pathname}${url.search}`);
    const params = Object.fromEntries(url.searchParams.entries());
    return new Response(envelope(url.pathname.slice(1), responses[url.pathname] ?? [], params));
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, calls };
}

async function clientFor(
  sport: string,
  fetchFn: typeof globalThis.fetch,
  freeDay = true,
): Promise<ApiSportsClient> {
  const governor = new PgQuotaGovernor(db, () => defaultPolicy(100));
  // dia sem ao vivo: libera a folga para o BOOTSTRAP (sem isso a política padrão só cede 5 chamadas)
  if (freeDay) await governor.plan(sport, new Date().toISOString().slice(0, 10), { LIVE: 0, DAILY: 0 });
  return new ApiSportsClient({
    apiKey: 'k',
    store: new PgRawStore(db),
    governor,
    plan: new PlanRules(FREE_PLAN),
    fetch: fetchFn,
    rateLimiter: new RateLimiter(60_000),
  });
}

describe('upsertCatalog (outros esportes)', () => {
  it('é idempotente e mantém os IDs do fornecedor no escopo do esporte', async () => {
    const basketball = SPORT_PROFILES.basketball.build(
      new Map<string, unknown>([
        ['/countries', BASKETBALL_COUNTRIES],
        ['/leagues', BASKETBALL_LEAGUES],
      ]),
      { catalog: BASKETBALL_CATALOG, today: TODAY },
    );
    const first = await upsertCatalog(db, 'basketball', basketball);
    expect(first.competitions).toEqual({ inserted: 3, updated: 0 });
    const second = await upsertCatalog(db, 'basketball', basketball);
    expect(second.competitions).toEqual({ inserted: 0, updated: 3 });

    // o mesmo ID 192 no vôlei é outra competição
    const volleyball = SPORT_PROFILES.volleyball.build(
      new Map<string, unknown>([
        ['/countries', []],
        [
          '/leagues',
          [
            {
              id: 192,
              name: 'Liga Vôlei Teste',
              type: 'League',
              logo: 'https://media.api-sports.io/volley/leagues/192.png',
              country: {
                id: 1,
                name: 'Brazil',
                code: 'BR',
                flag: 'https://media.api-sports.io/flags/br.svg',
              },
              seasons: [{ season: 2024, current: false, start: '2024-10-01', end: '2025-04-01' }],
            },
          ],
        ],
      ]),
      { catalog: [], today: TODAY },
    );
    await upsertCatalog(db, 'volleyball', volleyball);

    const mapped = await db
      .select({ sport: providerMap.sport, entityId: providerMap.entityId })
      .from(providerMap)
      .where(and(eq(providerMap.providerId, '192'), eq(providerMap.entityType, 'competition')));
    expect(mapped.map((m) => m.sport).sort()).toEqual(['basketball', 'volleyball']);
    expect(new Set(mapped.map((m) => m.entityId)).size).toBe(2);

    const [nbb] = await db.select().from(competition).where(eq(competition.slug, 'nbb'));
    expect(nbb).toMatchObject({ sport: 'basketball', tier: 1, livePriority: 'high', countryCode: 'BR' });
    const nbbSeasons = await db.select().from(season).where(eq(season.competitionId, nbb!.id));
    expect(nbbSeasons.map((s) => s.label).sort()).toEqual(['2022/23', '2024/25', '2026/27']);
    // bandeira do Brasil compartilhada entre esportes: um asset só
    const flags = await db
      .select()
      .from(asset)
      .where(eq(asset.sourceUrl, 'https://media.api-sports.io/flags/br.svg'));
    expect(flags).toHaveLength(1);
  });

  it('grava construtores e circuitos da F1 com imagens para o Asset Mirror', async () => {
    const responses = new Map<string, unknown>([
      ['/seasons', [2023, 2024]],
      [
        '/teams',
        [{ id: 1, name: 'Red Bull Racing', logo: 'https://media.api-sports.io/formula-1/teams/1.png' }],
      ],
      [
        '/circuits',
        [
          {
            id: 16,
            name: 'Autodromo Nazionale Monza',
            image: 'https://media.api-sports.io/formula-1/circuits/16.png',
            competition: { id: 16, name: 'Italy Grand Prix', location: { country: 'Brazil', city: 'Monza' } },
            capacity: 113860,
          },
        ],
      ],
    ]);
    const rows = SPORT_PROFILES['formula-1'].build(responses, { catalog: [], today: TODAY });
    const a = await upsertCatalog(db, 'formula-1', rows);
    const b = await upsertCatalog(db, 'formula-1', rows);
    expect(a.participants).toEqual({ inserted: 1, updated: 0 });
    expect(b.participants).toEqual({ inserted: 0, updated: 1 });
    expect(b.venues).toEqual({ inserted: 0, updated: 1 });
    const [team] = await db.select().from(participant).where(eq(participant.name, 'Red Bull Racing'));
    expect(team).toMatchObject({ sport: 'formula-1', kind: 'constructor' });
    expect(team!.logoAssetId).not.toBeNull();
    const [monza] = await db.select().from(venue).where(eq(venue.name, 'Autodromo Nazionale Monza'));
    expect(monza).toMatchObject({ city: 'Monza', capacity: 113860, countryCode: 'BR' });
    const [img] = await db.select().from(asset).where(eq(asset.id, monza!.imageAssetId!));
    expect(img).toMatchObject({ kind: 'circuit' });
  });
});

const VOLLEY_CATALOG: SportCatalogCompetition[] = [
  {
    slug: 'superliga-masculina',
    name: 'SuperLiga',
    country: 'Brazil',
    type: 'league',
    api_sports_id: 25,
    tier: 1,
    live_priority: 'high',
  },
  { slug: 'lva', name: 'LVA', country: 'Argentina', type: 'league', api_sports_id: 4, tier: 2 },
];

const VOLLEY_RESPONSES = {
  '/countries': [
    { id: 1, name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
    { id: 2, name: 'Argentina', code: 'AR', flag: 'https://media.api-sports.io/flags/ar.svg' },
  ],
  '/leagues': [
    {
      id: 25,
      name: 'SuperLiga',
      type: 'League',
      logo: 'https://media.api-sports.io/volley/leagues/25.png',
      country: { id: 1, name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
      seasons: [2021, 2022, 2023, 2024, 2025].map((y) => ({
        season: y,
        current: y === 2025,
        start: `${y}-10-01`,
        end: `${y + 1}-04-30`,
      })),
    },
    {
      id: 4,
      name: 'LVA',
      type: 'League',
      logo: 'https://media.api-sports.io/volley/leagues/4.png',
      country: { id: 2, name: 'Argentina', code: 'AR', flag: 'https://media.api-sports.io/flags/ar.svg' },
      seasons: [{ season: 2024, current: false, start: '2024-10-01', end: '2025-04-30' }],
    },
  ],
  '/games': [{ id: 1 }],
};

describe('runSportCatalogJob', () => {
  it('busca a referência, grava o catálogo, confere o YAML e (com --jogos) as temporadas do plano', async () => {
    const api = fakeApi(VOLLEY_RESPONSES);
    const client = await clientFor('volleyball', api.fetch);

    const before = await planSportCatalog(db, 'volleyball', VOLLEY_CATALOG, {
      plan: FREE_PLAN,
      games: { maxTier: 1, latestSeasons: 3 },
    });
    expect(before.estimated).toBe(true); // ainda não há /leagues no raw
    expect(before.calls.filter((c) => c.source === 'network')).toHaveLength(6 + 3);

    const result = await runSportCatalogJob(db, client, 'volleyball', VOLLEY_CATALOG, {
      games: { maxTier: 1, latestSeasons: 3 },
    });
    expect(api.calls).toEqual([
      'volleyball/timezone',
      'volleyball/seasons',
      'volleyball/countries',
      'volleyball/leagues',
      'volleyball/odds/bets',
      'volleyball/odds/bookmakers',
      'volleyball/games?league=25&season=2022',
      'volleyball/games?league=25&season=2023',
      'volleyball/games?league=25&season=2024',
    ]);
    expect(result.check.map((c) => c.status)).toEqual(['ok', 'ok']);
    expect(result.stats.competitions).toEqual({ inserted: 2, updated: 0 });

    const [run] = await db.select().from(jobRun).where(eq(jobRun.job, 'bootstrap:volleyball-catalog'));
    expect(run).toMatchObject({ status: 'ok', callsSpent: 9 });
    const raw = await db.select().from(apiResponse).where(eq(apiResponse.sport, 'volleyball'));
    expect(raw).toHaveLength(9);

    // segunda execução e plano: tudo do raw, nenhuma cota
    const after = await planSportCatalog(db, 'volleyball', VOLLEY_CATALOG, {
      plan: FREE_PLAN,
      games: { maxTier: 1, latestSeasons: 3 },
    });
    expect(after.estimated).toBe(false);
    expect(after.calls.filter((c) => c.source === 'network')).toHaveLength(0);
    const again = await runSportCatalogJob(db, client, 'volleyball', VOLLEY_CATALOG, {
      games: { maxTier: 1, latestSeasons: 3 },
    });
    expect(again.calls.every((c) => c.source === 'cache')).toBe(true);
    expect(api.calls).toHaveLength(9);
  });

  it('adia o que não cabe na cota do dia em vez de falhar', async () => {
    const api = fakeApi({ ...VOLLEY_RESPONSES, '/leagues': VOLLEY_RESPONSES['/leagues'] });
    // sem planejar o dia: a política padrão cede só 5 chamadas ao BOOTSTRAP
    const client = await clientFor('handball', api.fetch, false);
    const result = await runSportCatalogJob(db, client, 'handball', [], {
      games: { maxTier: 3, latestSeasons: 3 },
    });
    expect(result.calls.filter((c) => c.source === 'network')).toHaveLength(5);
    expect(result.calls.find((c) => c.endpoint === '/odds/bookmakers')?.source).toBe('deferred');
    expect(result.calls.filter((c) => c.endpoint === '/games').every((c) => c.source === 'deferred')).toBe(
      true,
    );
    expect(result.stats.competitions.inserted).toBe(2);
  });

  it('AFL: quartos guardados antes de o jogo virar definitivo são buscados uma última vez', async () => {
    const games = [
      { game: { id: 3058 }, date: '2024-09-28T04:30:00+00:00', status: { short: 'FT' } },
      { game: { id: 2952 }, date: '2024-03-07T08:30:00+00:00', status: { short: 'FT' } },
    ];
    const leagues = [
      {
        id: 1,
        name: 'AFL Premiership',
        type: 'League',
        logo: 'https://media.api-sports.io/afl/leagues/1.png',
        seasons: [{ season: 2024, current: false, start: '2024-03-07', end: '2024-09-28' }],
      },
    ];
    const api = fakeApi({ '/leagues': leagues, '/games': games });
    const client = await clientFor('afl', api.fetch);
    const seed = async (
      endpoint: string,
      raw: Record<string, string>,
      response: unknown[],
      fetchedAt: string,
    ) => {
      const params = normalizeParams(raw);
      const body = { get: endpoint.slice(1), parameters: params, errors: [], results: 0, response };
      await db.insert(apiResponse).values({
        provider: 'api-sports',
        sport: 'afl',
        apiVersion: 'v1',
        endpoint,
        params,
        requestHash: requestHash('api-sports', 'afl', endpoint, params),
        statusCode: 200,
        results: response.length,
        errors: [],
        body,
        bodyHash: `${endpoint}-${JSON.stringify(params)}-${fetchedAt}`,
        fetchedAt: new Date(fetchedAt),
        jobId: 'teste',
      });
    };
    // ligas e temporada encerrada já no raw (o plano só mostra os quartos dos jogos que conhece)
    await seed('/leagues', {}, leagues, new Date().toISOString());
    await seed('/games', { league: '1', season: '2024' }, games, '2024-10-01T00:00:00Z');
    // 3058: buscado horas depois do jogo (ainda podia ser corrigido); 2952: semanas depois (definitivo)
    await seed('/games/quarters', { id: '3058' }, [], '2024-09-28T10:00:00Z');
    await seed('/games/quarters', { id: '2952' }, [], '2024-03-20T00:00:00Z');

    const opts = { games: { maxTier: 3, latestSeasons: 3 } };
    const plan = await planSportCatalog(db, 'afl', [], { plan: FREE_PLAN, ...opts });
    const planned = (id: string) => plan.calls.find((c) => c.params?.id === id)?.source;
    expect([planned('3058'), planned('2952')]).toEqual(['network', 'cache']);

    await runSportCatalogJob(db, client, 'afl', [], opts);
    const fetched = api.calls.filter((c) => c.startsWith('afl/games/quarters'));
    expect(fetched).toEqual(['afl/games/quarters?id=3058']);

    // a resposta nova (buscada agora) vale para sempre: a próxima execução não busca de novo
    await runSportCatalogJob(db, client, 'afl', [], opts);
    expect(api.calls.filter((c) => c.startsWith('afl/games/quarters'))).toHaveLength(1);
  });

  it('falha (e registra) quando falta uma resposta obrigatória', async () => {
    const failing = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/leagues') return new Response('erro', { status: 500 });
      return new Response(envelope(url.pathname.slice(1), []));
    }) as typeof globalThis.fetch;
    const client = await clientFor('rugby', failing);
    await expect(runSportCatalogJob(db, client, 'rugby', [])).rejects.toThrow();
    const [run] = await db.select().from(jobRun).where(eq(jobRun.job, 'bootstrap:rugby-catalog'));
    expect(run?.status).toBe('error');
  });
});
