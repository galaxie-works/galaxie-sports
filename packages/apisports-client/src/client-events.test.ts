import { describe, expect, it } from 'vitest';
import { ApiSportsClient, type CallEvent } from './client.js';
import { ApiSportsError } from './errors.js';
import { FREE_PLAN, PlanRules } from './plan.js';
import { InMemoryQuotaGovernor } from './quota/governor.js';
import { defaultPolicy } from './quota/policy.js';
import { RateLimiter, type Clock } from './rate-limiter.js';
import { InMemoryRawStore } from './raw-store.js';

function setup(respond: () => Response, onCall: (e: CallEvent) => void) {
  const clock: Clock & { t: number } = {
    t: Date.parse('2026-10-21T14:00:00Z'),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  };
  const fetchFn = (async () => {
    clock.t += 250;
    return respond();
  }) as typeof globalThis.fetch;
  return new ApiSportsClient({
    apiKey: 'test-key',
    store: new InMemoryRawStore(),
    governor: new InMemoryQuotaGovernor(
      () => defaultPolicy(100),
      () => new Date(clock.t),
    ),
    fetch: fetchFn,
    clock,
    plan: new PlanRules(FREE_PLAN),
    rateLimiter: new RateLimiter(10, clock),
    onCall,
  });
}

const ok = () =>
  new Response(JSON.stringify({ get: 'leagues', parameters: {}, errors: [], results: 0, response: [] }), {
    headers: { 'x-ratelimit-requests-remaining': '88' },
  });

describe('onCall', () => {
  it('informa chamadas de rede e de cache com sport, endpoint, job e desfecho', async () => {
    const events: CallEvent[] = [];
    const client = setup(ok, (e) => events.push(e));
    const req = { sport: 'football', endpoint: '/leagues', priority: 'DAILY', jobId: 'job-run:1' } as const;
    await client.get(req);
    await client.get(req);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      sport: 'football',
      endpoint: '/leagues',
      priority: 'DAILY',
      jobId: 'job-run:1',
      source: 'network',
      outcome: 'ok',
      statusCode: 200,
      quotaRemaining: 88,
      durationMs: 250,
    });
    expect(events[1]).toMatchObject({ source: 'cache', endpoint: '/leagues' });
  });

  it('informa o desfecho de erro e não deixa um observador com defeito derrubar a chamada', async () => {
    const events: CallEvent[] = [];
    const failing = setup(
      () => new Response(JSON.stringify({ errors: { plan: 'x' }, response: [] })),
      (e) => events.push(e),
    );
    await expect(failing.get({ sport: 'football', endpoint: '/leagues', priority: 'DAILY' })).rejects.toThrow(
      ApiSportsError,
    );
    expect(events[0]).toMatchObject({ source: 'network', outcome: 'plan_error' });

    const throwing = setup(ok, () => {
      throw new Error('observador quebrado');
    });
    await expect(
      throwing.get({ sport: 'football', endpoint: '/leagues', priority: 'DAILY' }),
    ).resolves.toMatchObject({ source: 'network' });
  });
});
