import { describe, expect, it } from 'vitest';
import { ApiSportsClient } from './client.js';
import { ApiSportsError, OfflineMissError, PlanViolationError, QuotaExceededError } from './errors.js';
import { FREE_PLAN, PlanRules } from './plan.js';
import { InMemoryQuotaGovernor } from './quota/governor.js';
import { defaultPolicy } from './quota/policy.js';
import { RateLimiter, type Clock } from './rate-limiter.js';
import { InMemoryRawStore } from './raw-store.js';

type Route = (url: URL) => { status?: number; body: unknown; remaining?: number; limit?: number };

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
      headers: {
        ...(r.remaining !== undefined ? { 'x-ratelimit-requests-remaining': String(r.remaining) } : {}),
        ...(r.limit !== undefined ? { 'x-ratelimit-requests-limit': String(r.limit) } : {}),
      },
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
    () => defaultPolicy(dailyLimit, 15),
    () => new Date(clock.t),
    clock.sleep,
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

  describe('cota esgotada no fornecedor', () => {
    const exhausted =
      (remaining = 0) =>
      () => ({
        body: envelope([], { errors: { requests: 'You have reached the request limit for the day.' } }),
        remaining,
      });
    const live = (id: number) =>
      ({ sport: 'football', endpoint: '/teams', params: { id }, priority: 'LIVE' }) as const;

    it('nega a API por 15 min (até o ao vivo) sem gastar outra tentativa, depois tenta de novo', async () => {
      const { client, api, clock } = setup(exhausted());
      await expect(
        client.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' }),
      ).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      await expect(client.get(live(1))).rejects.toBeInstanceOf(QuotaExceededError);
      // a cota de cada API é separada
      await client
        .get({ sport: 'hockey', endpoint: '/teams', params: { id: 1 }, priority: 'DAILY' })
        .catch(() => {});
      expect(api.calls.map((u) => u.hostname)).toEqual([
        'v3.football.api-sports.io',
        'v1.hockey.api-sports.io',
      ]);
      // não é piso do dia: passada a janela, uma nova tentativa sai
      clock.t += 15 * 60_000;
      await expect(client.get(live(2))).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      expect(api.calls).toHaveLength(3);
    });

    it('não trava o dia novo: resposta "esgotada" nos primeiros minutos do dia UTC é ignorada', async () => {
      const { client, api, clock } = setup(exhausted());
      clock.t = Date.parse('2026-10-22T00:00:20Z'); // contador do fornecedor ainda no dia anterior
      await expect(client.get(live(1))).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      await expect(client.get(live(2))).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      expect(api.calls).toHaveLength(2);
    });

    it('ignora a resposta "esgotada" quando o header ainda informa cota restante', async () => {
      const { client, api } = setup(exhausted(40));
      await expect(client.get(live(1))).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      await expect(client.get(live(2))).rejects.toMatchObject({ outcome: 'quota_exhausted' });
      expect(api.calls).toHaveLength(2);
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

  describe('formato real do fornecedor: limite por minuto e cota da conta compartilhada', () => {
    // corpos copiados do raw.api_response (24/10/2026): o 429 vem sem header de cota; o aviso vem com HTTP 200
    const http429 = {
      get: '',
      parameters: [],
      errors: {
        rateLimit:
          'Too many requests. You have reached your per-minute request limit. Please wait a few seconds before retrying or upgrade your plan for higher limits.',
      },
      results: 0,
      paging: { total: 1, current: 1 },
      response: [],
    };
    const minuteWarning = {
      get: 'games/quarters',
      parameters: { id: '2849' },
      errors: { rateLimit: 'Too many requests. Your rate limit is 10 requests per minute.' },
      results: 0,
      paging: { total: 1, current: 1 },
      response: [],
    };
    const team = (id: number, priority: 'BOOTSTRAP' | 'DAILY' | 'LIVE') =>
      ({ sport: 'football', endpoint: '/teams', params: { id }, priority }) as const;

    it('429 pausa a API por 30 s para todos os jobs, inclusive o ao vivo', async () => {
      let n = 0;
      const { client, api, clock } = setup(() =>
        n++ === 0 ? { status: 429, body: http429 } : { body: envelope([]), remaining: 90 },
      );
      const t0 = clock.t;
      await expect(client.get(team(1, 'BOOTSTRAP'))).rejects.toMatchObject({ outcome: 'rate_limited' });
      await client.get(team(2, 'LIVE'));
      expect(api.calls).toHaveLength(2);
      expect(clock.t - t0).toBeGreaterThanOrEqual(30_000);
    });

    it('o aviso de limite por minuto (HTTP 200 com errors.rateLimit) também pausa, só aquela API', async () => {
      const { client, api, clock } = setup((url) =>
        url.hostname.startsWith('v1.afl') && url.searchParams.get('id') === '2849'
          ? { body: minuteWarning, remaining: 99 }
          : { body: envelope([]), remaining: 98 },
      );
      const t0 = clock.t;
      await expect(
        client.get({ sport: 'afl', endpoint: '/games/quarters', params: { id: 2849 }, priority: 'LIVE' }),
      ).rejects.toMatchObject({ outcome: 'rate_limited' });
      await client.get({ sport: 'hockey', endpoint: '/teams', params: { id: 1 }, priority: 'DAILY' });
      expect(clock.t - t0).toBeLessThan(30_000);
      await client.get({ sport: 'afl', endpoint: '/teams', params: { id: 1 }, priority: 'DAILY' });
      expect(clock.t - t0).toBeGreaterThanOrEqual(30_000);
      expect(api.calls).toHaveLength(3);
    });

    it('o header de cota do dia conta as duas pontas: a produção para os jobs comuns e o ao vivo segue', async () => {
      // Ultra: 75.000/dia; a conta (dev + produção) já gastou 65.000, acima do teto de 63.750 dos jobs comuns
      const { client, api } = setup(() => ({ body: envelope([]), remaining: 10_000, limit: 75_000 }), 75_000);
      await client.get(team(1, 'DAILY'));
      await expect(client.get(team(2, 'DAILY'))).rejects.toThrow(/reserva do ao vivo/);
      await client.get(team(3, 'LIVE'));
      expect(api.calls).toHaveLength(2);
    });
  });

  it('o Governor nega quando o orçamento da prioridade acaba', async () => {
    const { client, api } = setup(() => ({ body: envelope([]) }), 10);
    // limite 10, reserva 2 (do ao vivo) → DAILY tem fatia de 4; BOOTSTRAP só vive de folga: abaixo de 8,
    // tirando o que a reserva não cobre da fatia do ao vivo (4 − 2), sobram 2
    for (let i = 0; i < 4; i++) {
      await client.get({ sport: 'football', endpoint: '/teams', params: { id: i }, priority: 'DAILY' });
    }
    for (const id of [97, 98]) {
      await client.get({ sport: 'football', endpoint: '/teams', params: { id }, priority: 'BOOTSTRAP' });
    }
    await expect(
      client.get({ sport: 'football', endpoint: '/teams', params: { id: 99 }, priority: 'BOOTSTRAP' }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(api.calls).toHaveLength(6);
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
    // 11 chamadas espaçadas de 6 s: a 11ª sai pelo menos 60 s depois da 1ª
    expect(clock.t - start).toBeGreaterThanOrEqual(60_000);
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

  it('não reaproveita resposta HTTP de erro mesmo com envelope sem erros', async () => {
    let n = 0;
    const { client, api } = setup(() => {
      n += 1;
      return n === 1 ? { status: 503, body: envelope([]) } : { body: envelope([{ ok: true }]) };
    });
    await expect(
      client.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' }),
    ).rejects.toMatchObject({
      outcome: 'http_error',
    });
    const res = await client.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' });
    expect(res.source).toBe('network');
    expect(api.calls).toHaveLength(2);
  });

  it('pedidos idênticos simultâneos no mesmo processo geram uma única chamada', async () => {
    const { client, api, governor } = setup(() => ({ body: envelope([{ id: 1 }]) }));
    const req = {
      sport: 'football',
      endpoint: '/teams',
      params: { country: 'Brazil' },
      priority: 'DAILY',
    } as const;
    const [a, b, c] = await Promise.all([client.get(req), client.get(req), client.get(req)]);
    expect(api.calls).toHaveLength(1);
    expect(a.requestHash).toBe(b.requestHash);
    expect(c.envelope.results).toBe(1);
    expect((await governor.usage('football')).totalUsed).toBe(1);
  });

  it('modo offline serve o raw de qualquer idade e nunca chama o fornecedor', async () => {
    const { store, api, governor, clock } = setup(() => ({ body: envelope([]) }));
    const online = new ApiSportsClient({
      apiKey: 'test-key',
      store,
      governor,
      fetch: api.fetchFn,
      clock,
      rateLimiter: new RateLimiter(6000, clock),
    });
    await online.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' });
    clock.t += 30 * 86_400_000; // muito além do TTL de 24 h

    const offline = new ApiSportsClient({
      apiKey: '',
      store,
      governor,
      fetch: api.fetchFn,
      clock,
      offline: true,
    });
    const res = await offline.get({ sport: 'football', endpoint: '/countries', priority: 'DAILY' });
    expect(res.source).toBe('cache');
    await expect(
      offline.get({ sport: 'football', endpoint: '/timezone', priority: 'DAILY' }),
    ).rejects.toBeInstanceOf(OfflineMissError);
    expect(api.calls).toHaveLength(1);
  });
});

describe('ApiSportsClient: falhas depois do fetch', () => {
  /** Cliente cujo corpo e raw podem falhar sob comando; o clock falso faz o polling de em-voo andar sozinho. */
  function failing(opts: { failBody?: () => boolean; failSave?: () => boolean }) {
    const clock: Clock & { t: number } = {
      t: Date.parse('2026-10-21T14:00:00Z'),
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
    };
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (opts.failBody?.()) {
        const body = new ReadableStream({
          start: (c) => c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
        });
        return new Response(body, { status: 200 });
      }
      return new Response(JSON.stringify(envelope([{ id: 1 }])), { status: 200 });
    }) as typeof globalThis.fetch;
    const store = new InMemoryRawStore();
    const save = store.save.bind(store);
    store.save = async (record) => {
      if (opts.failSave?.()) throw new Error('falha ao gravar o raw');
      await save(record);
    };
    const governor = new InMemoryQuotaGovernor(
      () => defaultPolicy(100),
      () => new Date(clock.t),
    );
    const client = new ApiSportsClient({
      apiKey: 'test-key',
      store,
      governor,
      fetch: fetchFn,
      clock,
      timeoutMs: 30_000,
      rateLimiter: new RateLimiter(6000, clock),
    });
    return { client, governor, calls: () => calls };
  }

  const req = { sport: 'football', endpoint: '/teams', params: { id: 7 }, priority: 'DAILY' } as const;

  it('timeout na leitura do corpo vira ApiSportsError timeout e o ticket não fica pending', async () => {
    let fail = true;
    const { client, governor, calls } = failing({ failBody: () => fail });
    await expect(client.get(req)).rejects.toMatchObject({ name: 'ApiSportsError', outcome: 'timeout' });
    fail = false;
    // com o ticket pendurado, a segunda chamada esperaria o "outro processo" até o timeout
    const res = await client.get(req);
    expect(res.source).toBe('network');
    expect(calls()).toBe(2);
    expect((await governor.usage('football')).totalUsed).toBe(2);
  });

  it('falha ao gravar o raw ainda registra o desfecho no ledger', async () => {
    let fail = true;
    const { client, calls } = failing({ failSave: () => fail });
    await expect(client.get(req)).rejects.toThrow('falha ao gravar o raw');
    fail = false;
    const res = await client.get(req);
    expect(res.source).toBe('network');
    expect(calls()).toBe(2);
  });
});

describe('ApiSportsClient: tempo limite por prioridade', () => {
  /** fetch que só termina quando o sinal aborta; registra quanto tempo cada chamada esperou. */
  function hanging() {
    const waited: { endpoint: string; ms: number }[] = [];
    const fetchFn = ((url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const t0 = Date.now();
        init?.signal?.addEventListener('abort', () => {
          waited.push({ endpoint: new URL(url).pathname, ms: Date.now() - t0 });
          reject(init.signal!.reason);
        });
      })) as typeof globalThis.fetch;
    const client = new ApiSportsClient({
      apiKey: 'test-key',
      store: new InMemoryRawStore(),
      governor: new InMemoryQuotaGovernor(() => defaultPolicy(100)),
      fetch: fetchFn,
      timeoutMs: 400,
      liveTimeoutMs: 40,
      rateLimiter: new RateLimiter(6000),
    });
    return { client, waited };
  }

  it('o ao vivo desiste no tempo curto; as outras chamadas, no longo', async () => {
    const { client, waited } = hanging();
    const live = {
      sport: 'football',
      endpoint: '/fixtures',
      params: { live: 'all' },
      priority: 'LIVE',
    } as const;
    await expect(client.get(live)).rejects.toMatchObject({ name: 'ApiSportsError', outcome: 'timeout' });
    const daily = { sport: 'football', endpoint: '/teams', params: { id: 7 }, priority: 'DAILY' } as const;
    await expect(client.get(daily)).rejects.toMatchObject({ outcome: 'timeout' });
    expect(waited[0]!.ms).toBeLessThan(300);
    expect(waited[1]!.ms).toBeGreaterThanOrEqual(350);
  });
});
