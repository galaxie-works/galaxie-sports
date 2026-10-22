import { describe, expect, it } from 'vitest';
import { ApiSportsClient } from './client.js';
import { PlanViolationError } from './errors.js';
import type { ApiSport } from './hosts.js';
import { FREE_PLAN, PlanRules, plansFromEnv } from './plan.js';
import { InMemoryQuotaGovernor } from './quota/governor.js';
import { defaultPolicy } from './quota/policy.js';
import type { Clock } from './rate-limiter.js';
import { InMemoryRawStore } from './raw-store.js';

/** Futebol no pro e as demais APIs no free — a configuração real da conta. */
const ENV = { APISPORTS_PLAN: 'free', APISPORTS_PLAN_FOOTBALL: 'pro' };

const envelope = (response: unknown, extra: Record<string, unknown> = {}) => ({
  get: 'x',
  parameters: {},
  errors: [],
  results: Array.isArray(response) ? response.length : 1,
  paging: { current: 1, total: 1 },
  response,
  ...extra,
});

type Route = (url: URL) => unknown;

function setup(
  route: Route = () => envelope([]),
  extra: { onPlanChange?: (p: PlanRules, s: ApiSport) => void } = {},
) {
  const clock: Clock & { t: number } = {
    t: Date.parse('2026-10-21T14:00:00Z'),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  };
  const calls: { url: URL; at: number }[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push({ url, at: clock.t });
    return new Response(JSON.stringify(route(url)), { status: 200 });
  }) as typeof globalThis.fetch;
  const planFor = plansFromEnv(ENV);
  const governor = new InMemoryQuotaGovernor(
    (api) => defaultPolicy(planFor(api).dailyLimit),
    () => new Date(clock.t),
  );
  const resolved: ApiSport[] = [];
  const client = new ApiSportsClient({
    apiKey: 'test-key',
    store: new InMemoryRawStore(),
    governor,
    fetch: fetchFn,
    clock,
    planFor: (sport) => {
      resolved.push(sport);
      return new PlanRules(planFor(sport));
    },
    ...extra,
  });
  return { client, governor, calls, clock, resolved };
}

describe('ApiSportsClient com plano por API', () => {
  it('futebol no pro aceita a temporada atual; basquete no free recusa antes de chamar', async () => {
    const { client, calls, governor } = setup();
    const res = await client.get({
      sport: 'football',
      endpoint: '/fixtures',
      params: { league: 71, season: 2026 },
      priority: 'DAILY',
    });
    expect(res.source).toBe('network');

    await expect(
      client.get({
        sport: 'basketball',
        endpoint: '/games',
        params: { league: 12, season: 2026 },
        priority: 'DAILY',
      }),
    ).rejects.toBeInstanceOf(PlanViolationError);
    await expect(
      client.get({ sport: 'basketball', endpoint: '/games', params: { ids: '1-2' }, priority: 'DAILY' }),
    ).rejects.toThrow(/ids/);

    expect(calls.map((c) => c.url.hostname)).toEqual(['v3.football.api-sports.io']);
    expect((await governor.usage('basketball')).totalUsed).toBe(0);
  });

  it('cada API tem o seu limitador por minuto (pro 300/min, free 10/min)', async () => {
    const { client, calls } = setup();
    for (const id of [1, 2]) {
      await client.get({ sport: 'football', endpoint: '/teams', params: { id }, priority: 'DAILY' });
    }
    for (const id of [1, 2]) {
      await client.get({ sport: 'basketball', endpoint: '/teams', params: { id }, priority: 'DAILY' });
    }
    const [f1, f2, b1, b2] = calls.map((c) => c.at);
    expect(f2! - f1!).toBe(200); // 60 s / 300
    expect(b1).toBe(f2); // o balde do basquete não esperou pelo do futebol
    expect(b2! - b1!).toBe(6_000); // 60 s / 10
  });

  it('o Governor usa o limite diário do plano de cada API', async () => {
    const { governor } = setup();
    expect((await governor.usage('football')).dailyLimit).toBe(7500);
    expect((await governor.usage('basketball')).dailyLimit).toBe(100);
  });

  it('resolve as regras uma vez por API e aprende a janela de temporadas só daquela API', async () => {
    const changes: [ApiSport, PlanRules][] = [];
    const { client, resolved } = setup(
      () =>
        envelope([], {
          errors: { plan: 'Free plans do not have access to this season, try from 2023 to 2025.' },
        }),
      { onPlanChange: (rules, sport) => changes.push([sport, rules]) },
    );
    await expect(
      client.get({
        sport: 'hockey',
        endpoint: '/games',
        params: { league: 57, season: 2023 },
        priority: 'DAILY',
      }),
    ).rejects.toMatchObject({ outcome: 'plan_error' });

    expect(client.planRulesFor('hockey').current.seasons).toEqual({ min: 2023, max: 2025 });
    expect(client.planRulesFor('rugby').current.seasons).toEqual(FREE_PLAN.seasons);
    expect(client.planRulesFor('football').current.seasons).toBeUndefined();
    expect(client.planRules).toBe(client.planRulesFor('football'));
    expect(changes).toEqual([['hockey', client.planRulesFor('hockey')]]);
    expect(resolved.filter((s) => s === 'hockey')).toHaveLength(1);
  });

  it('/status sem limit_day reconcilia com o limite do plano daquela API', async () => {
    const { client } = setup(() => ({ response: { subscription: { plan: 'x' }, requests: { current: 3 } } }));
    expect((await client.status('football')).limitDay).toBe(7500);
    expect((await client.status('volleyball')).limitDay).toBe(100);
  });

  it('a opção `plan` continua valendo para todas as APIs', () => {
    const plan = new PlanRules(FREE_PLAN);
    const client = new ApiSportsClient({
      apiKey: 'k',
      store: new InMemoryRawStore(),
      governor: new InMemoryQuotaGovernor(() => defaultPolicy(100)),
      plan,
    });
    expect(client.planRules).toBe(plan);
    expect(client.planRulesFor('basketball')).toBe(plan);
    expect(client.planRulesFor('formula-1')).toBe(plan);
  });
});
