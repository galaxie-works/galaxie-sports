import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';
import { MemoryUsageBackend } from './counter.js';
import { QuotaGuard } from './quota.js';

describe('QuotaGuard (cota diária, docs/politica-de-chaves.md §4)', () => {
  it('aviso a partir de 80%, bloqueio acima de 110%; rotas de teste não contam', async () => {
    const backend = new MemoryUsageBackend();
    const now = new Date('2026-10-26T23:59:30Z');
    await backend.incr([
      { day: '2026-10-26', tenantId: 't', route: 'GET /v1/sports', n: 7 },
      { day: '2026-10-26', tenantId: 't', route: 'test:GET /v1/sports', n: 500 },
    ]);
    const guard = new QuotaGuard(backend, { now: () => now, refreshMs: 60_000 });
    expect(await guard.check('t', 10)).toMatchObject({ used: 8, level: 'warn', resetSec: 30 });
    expect((await guard.check('t', 10)).level).toBe('warn'); // 9
    expect((await guard.check('t', 10)).level).toBe('warn'); // 10
    expect((await guard.check('t', 10)).level).toBe('warn'); // 11 = 110%: ainda passa
    expect(await guard.check('t', 10)).toMatchObject({ used: 12, level: 'blocked' });
    // recusada não conta: a próxima também é a 12ª
    expect(await guard.check('t', 10)).toMatchObject({ used: 12, level: 'blocked' });
  });

  it('relê o Valkey depois de refreshMs e recomeça na virada do dia UTC', async () => {
    const backend = new MemoryUsageBackend();
    let now = new Date('2026-10-26T12:00:00Z');
    const guard = new QuotaGuard(backend, { now: () => now, refreshMs: 1_000 });
    expect((await guard.check('t', 100)).used).toBe(1);
    await backend.incr([{ day: '2026-10-26', tenantId: 't', route: 'GET /v1/sports', n: 50 }]);
    now = new Date('2026-10-26T12:00:02Z');
    expect((await guard.check('t', 100)).used).toBe(51);
    now = new Date('2026-10-27T00:00:01Z');
    expect((await guard.check('t', 100)).used).toBe(1);
  });
});

describe('cota no servidor', () => {
  it('headers de cota, aviso e 429 QUOTA_EXCEEDED; chave de teste fica fora; sem cota, sem headers', async () => {
    const live = await memoryTenant({ id: 'tenant-q', dailyRequestQuota: 3, rateLimitPerMinute: 1000 });
    const test = await memoryTenant({ id: 'tenant-q', dailyRequestQuota: 3, env: 'test' }, live.store);
    const free = await memoryTenant({ id: 'tenant-free', rateLimitPerMinute: 1000 }, live.store);
    const app = buildServer({ tenantStore: live.store, usage: new MemoryUsageBackend() });
    const get = (key: string) =>
      app.inject({ method: 'GET', url: '/v1/sports', headers: { 'x-galaxie-key': key } });

    const first = await get(live.key);
    expect(first.headers).toMatchObject({ 'x-galaxie-quota-limit': '3', 'x-galaxie-quota-remaining': '2' });
    expect(first.headers['x-galaxie-quota-warning']).toBeUndefined();
    await get(live.key);
    const third = await get(live.key);
    expect(third.headers['x-galaxie-quota-warning']).toBe('100%');
    const blocked = await get(live.key);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const viaTest = await get(test.key);
    expect(viaTest.statusCode).not.toBe(429);
    expect(viaTest.headers['x-galaxie-quota-limit']).toBeUndefined();
    expect((await get(free.key)).headers['x-galaxie-quota-limit']).toBeUndefined();
    await app.close();
  });
});
