import { describe, expect, it } from 'vitest';
import { ApiSportsClient } from './client.js';
import { ApiSportsError, PlanViolationError, QuotaExceededError } from './errors.js';
import { FREE_PLAN, PlanRules } from './plan.js';
import { InMemoryQuotaGovernor } from './quota/governor.js';
import { defaultPolicy } from './quota/policy.js';
import { RateLimiter, type Clock } from './rate-limiter.js';
import { InMemoryRawStore } from './raw-store.js';

type Route = (url: URL) => { status?: number; body: unknown; remaining?: number };

/** Servidor falso da api-sports: registra cada requisição recebida. */
function fakeApi(route: Route) {
  const calls: URL[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const headers = new Headers(init?.headers);
    if (headers.get('x-apisports-key') !== 'test-key') {
      return new Response(JSON.stringify({ errors: { token: 'invalid' }, response: [] }), { status: 200 });
    }
    const r = route(url);
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'x-ratelimit-requests-remaining': String(r.remaining ?? 90) },
    });
  }) as typeof globalThis.fetch;
  return { calls, fetchFn };
}

const envelope = (response: unknown, extra: Record<string, unknown> = {}) => ({
  get: 'x',
  parameters: {},
  errors: [],
  results: Array.isArray(response) ? response.length : 1,
  paging: { current: 1, total: 1 },
  response,
  ...extra,
});

function setup(route: Route, dailyLimit = 100) {
  const clock: Clock & { t: number } = {
    t: Date.parse('2026-10-21T14:00:00Z'),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  };
  const api = fakeApi(route);
  const store = new InMemoryRawStore();
  const governor = new InMemoryQuotaGovernor(
    () => defaultPolicy(dailyLimit),
    () => new Date(clock.t),
  );
  const client = new ApiSportsClient({
    apiKey: 'test-key',
    store,
    governor,
    fetch: api.fetchFn,
    clock,
    plan: new PlanRules(FREE_PLAN),
    rateLimiter: new RateLimiter(10, clock),
  });
  return { client, store, governor, api, clock };
}

describe('ApiSportsClient', () => {
  it('chama o fornecedor, grava o raw e registra o ledger', async () => {
    const { client, store, governor, api } = setup(() => ({ body: envelope([{ id: 1 }]), remaining: 97 }));
    const res = await client.get({ sport: 'football', endpoint: '/leagues', priority: 'DAILY' });

    expect(res.source).toBe('network');
    expect(res.quotaRemaining).toBe(97);
    expect(api.calls[0]?.href).toBe('https://v3.football.api-sports.io/leagues');
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      sport: 'football',
      apiVersion: 'v3',
      statusCode: 200,
      results: 1,
    });
    expect((await governor.usage('football')).used.DAILY).toBe(1);
  });

  it('não repete chamada idêntica dentro do TTL (mesmo com parâmetros em outra ordem)', async () => {
    const { client, api } = setup(() => ({ body: envelope([]) }));
    await client.get({
      sport: 'football',
      endpoint: '/fixtures',
      params: { league: 71, season: 2024 },
      priority: 'BOOTSTRAP',
    });
    const again = await client.get({
      sport: 'football',
      endpoint: '/fixtures',
      params: { season: '2024', league: '71' },
      priority: 'BOOTSTRAP',
    });
    expect(again.source).toBe('cache');
    expect(api.calls).toHaveLength(1);
  });

  it('volta à rede quando o TTL expira', async () => {
    const { client, api, clock } = setup(() => ({ body: envelope([]) }));
    await client.get({
      sport: 'football',
      endpoint: '/fixtures',
      params: { date: '2026-10-21' },
      priority: 'DAILY',
    });
    clock.t += 6 * 60_000;
    const res = await client.get({
      sport: 'football',
      endpoint: '/fixtures',
      params: { date: '2026-10-21' },
      priority: 'DAILY',
    });
    expect(res.source).toBe('network');
    expect(api.calls).toHaveLength(2);
  });

  it('bloqueia antes de chamar o que o plano não permite (sem gastar cota)', async () => {
    const { client, api, governor } = setup(() => ({ body: envelope([]) }));
    await expect(
      client.get({
        sport: 'football',
        endpoint: '/fixtures',
        params: { league: 71, season: 2026 },
        priority: 'DAILY',
      }),
    ).rejects.toBeInstanceOf(PlanViolationError);
    expect(api.calls).toHaveLength(0);
    expect((await governor.usage('football')).totalUsed).toBe(0);
  });

  it('erro de plano do fornecedor: grava raw, conta no ledger, aprende a janela e não é reaproveitado', async () => {
    const { client, store, governor, api } = setup(() => ({
      body: envelope([], {
        errors: { plan: 'Free plans do not have access to this season, try from 2023 to 2025.' },
      }),
    }));
    await expect(
      client.get({
        sport: 'football',
        endpoint: '/fixtures',
        params: { league: 71, season: 2023 },
        priority: 'DAILY',
      }),
    ).rejects.toMatchObject({ outcome: 'plan_error' });
    expect(store.records).toHaveLength(1);
    expect((await governor.usage('football')).used.DAILY).toBe(1);
    expect(client.planRules.current.seasons).toEqual({ min: 2023, max: 2025 });
    // a resposta com erro não serve de cache: nova tentativa vai à rede
    await expect(
      client.get({
        sport: 'football',
        endpoint: '/fixtures',
        params: { league: 71, season: 2023 },
        priority: 'DAILY',
      }),
    ).rejects.toBeInstanceOf(ApiSportsError);
    expect(api.calls).toHaveLength(2);
  });

  it('cota diária esgotada no fornecedor vira quota_exhausted', async () => {
    const { client } = setup(() => ({
      body: envelope([], { errors: { requests: 'You have reached the request limit for the day.' } }),
    }));
    await expect(
      client.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' }),
    ).rejects.toMatchObject({
      outcome: 'quota_exhausted',
    });
  });

  it('HTTP 429 vira rate_limited', async () => {
    const { client } = setup(() => ({ status: 429, body: { message: 'Too many requests' } }));
    await expect(
      client.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' }),
    ).rejects.toMatchObject({
      outcome: 'rate_limited',
    });
  });

  it('o Governor nega quando o orçamento da prioridade acaba', async () => {
    const { client, api } = setup(() => ({ body: envelope([]) }), 10);
    // limite 10, reserva 2 → DAILY tem fatia de 4; BOOTSTRAP só vive de folga
    for (let i = 0; i < 4; i++) {
      await client.get({ sport: 'football', endpoint: '/teams', params: { id: i }, priority: 'DAILY' });
    }
    await expect(
      client.get({ sport: 'football', endpoint: '/teams', params: { id: 99 }, priority: 'BOOTSTRAP' }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(api.calls).toHaveLength(4);
  });

  it('percorre a paginação (cada página é uma requisição)', async () => {
    const { client, api } = setup((url) => {
      const page = Number(url.searchParams.get('page'));
      return { body: envelope([{ page }], { paging: { current: page, total: 3 } }) };
    });
    const pages = await client.getAllPages({
      sport: 'football',
      endpoint: '/players',
      params: { team: 121, season: 2024 },
      priority: 'BOOTSTRAP',
      maxAgeMs: 0,
    });
    expect(pages.map((p) => p.envelope.response)).toEqual([[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]]);
    expect(api.calls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3']);
  });

  it('respeita o limite por minuto do plano', async () => {
    const { client, clock } = setup(() => ({ body: envelope([]) }), 1000);
    const start = clock.t;
    for (let i = 0; i < 11; i++) {
      await client.get({ sport: 'football', endpoint: '/teams', params: { id: i }, priority: 'DAILY' });
    }
    expect(clock.t - start).toBeGreaterThanOrEqual(6_000);
  });

  it('/status não consome cota e reconcilia o contador do fornecedor', async () => {
    const { client, governor, api } = setup((url) =>
      url.pathname === '/status'
        ? {
            body: {
              response: {
                subscription: { plan: 'Free', active: true },
                requests: { current: 42, limit_day: 100 },
              },
            },
          }
        : { body: envelope([]) },
    );
    const status = await client.status('football');
    expect(status).toMatchObject({ plan: 'Free', used: 42, limitDay: 100 });
    const usage = await governor.usage('football');
    expect(usage.totalUsed).toBe(0);
    expect(usage.providerUsed).toBe(42);
    expect(api.calls).toHaveLength(1);
  });
});
