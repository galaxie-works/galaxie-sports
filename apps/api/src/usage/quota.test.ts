import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';
import { MemoryUsageBackend } from './counter.js';

/** Backend com leitura lenta e contada: várias requisições chegam enquanto a 1ª leitura está em voo. */
class SlowUsageBackend extends MemoryUsageBackend {
  reads = 0;
  constructor(private readonly delayMs = 20) {
    super();
  }
  override async get(day: string, tenantId: string): Promise<Record<string, number>> {
    this.reads += 1;
    await new Promise((r) => setTimeout(r, this.delayMs));
    return super.get(day, tenantId);
  }
}
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

  it('requisições simultâneas com o cache frio ou vencido compartilham uma leitura e contam todas', async () => {
    const backend = new SlowUsageBackend();
    let now = new Date('2026-10-26T12:00:00Z');
    const guard = new QuotaGuard(backend, { now: () => now, refreshMs: 1_000 });
    const burst = async (n: number) => {
      const out = await Promise.all(Array.from({ length: n }, () => guard.check('t', 10)));
      return out.map((q) => q.level);
    };
    // 20 de uma vez, cota 10: passam 11 (até 110%) e 9 são recusadas, com uma leitura só
    const cold = await burst(20);
    expect(cold.filter((l) => l === 'blocked')).toHaveLength(9);
    expect(backend.reads).toBe(1);
    // entrada vencida: de novo uma leitura só, e as que chegam juntas continuam contadas
    await backend.incr([{ day: '2026-10-26', tenantId: 't', route: 'GET /v1/sports', n: 5 }]);
    now = new Date('2026-10-26T12:00:02Z');
    const stale = await burst(10);
    expect(backend.reads).toBe(2);
    expect(stale.filter((l) => l === 'blocked')).toHaveLength(4); // 5 + 6 = 11 passam
  });

  it('erro na leitura chega a todas as requisições em espera, e a próxima tenta de novo', async () => {
    const backend = new SlowUsageBackend();
    let fail = true;
    const get = backend.get.bind(backend);
    backend.get = async (day, tenantId) => {
      const counts = await get(day, tenantId);
      if (fail) throw new Error('valkey fora');
      return counts;
    };
    const guard = new QuotaGuard(backend);
    const out = await Promise.allSettled([guard.check('t', 10), guard.check('t', 10)]);
    expect(out.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(backend.reads).toBe(1);
    fail = false;
    expect((await guard.check('t', 10)).used).toBe(1);
    expect(backend.reads).toBe(2);
  });
});

describe('cota no servidor', () => {
  it('rajada simultânea no cache frio: passam só até 110% da cota', async () => {
    const live = await memoryTenant({ id: 'tenant-rajada', dailyRequestQuota: 3, rateLimitPerMinute: 1000 });
    // leitura mais lenta que a autenticação das 20 (scrypt), para que todas cheguem à cota com ela em voo
    const backend = new SlowUsageBackend(1_000);
    const app = buildServer({ tenantStore: live.store, usage: backend });
    const res = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({ method: 'GET', url: '/v1/sports', headers: { 'x-galaxie-key': live.key } }),
      ),
    );
    // cota 3: passam 3 (3,3 arredonda para baixo) e as outras 17 levam 429
    expect(res.filter((r) => r.statusCode === 429)).toHaveLength(17);
    expect(backend.reads).toBe(1);
    await app.close();
  });

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
