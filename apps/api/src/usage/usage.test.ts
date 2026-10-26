import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';
import { MemoryUsageBackend, UsageCounter, utcDay, type UsageBackend } from './counter.js';
import { UsageQuery } from './query.js';
import { combineUsage, liveDays, usageByDay } from './store.js';

describe('UsageCounter', () => {
  it('agrega em memória e envia um único lote por flush', async () => {
    const backend = new MemoryUsageBackend();
    const calls: number[] = [];
    const counting: UsageBackend = {
      ...backend,
      incr: async (entries) => {
        calls.push(entries.length);
        return backend.incr(entries);
      },
      tenants: backend.tenants.bind(backend),
      get: backend.get.bind(backend),
      snapshot: backend.snapshot.bind(backend),
      lock: backend.lock.bind(backend),
    };
    const now = new Date('2026-10-21T23:59:59Z');
    const counter = new UsageCounter(counting, { now: () => now });
    for (let i = 0; i < 1000; i++) counter.record('t1', 'GET /v1/sports');
    counter.record('t1', 'GET /v1/countries');
    counter.record('t2', 'GET /v1/sports');
    await counter.flush();
    expect(calls).toEqual([3]);
    expect(await backend.get('2026-10-21', 't1')).toEqual({ 'GET /v1/sports': 1000, 'GET /v1/countries': 1 });
    expect((await backend.tenants('2026-10-21')).sort()).toEqual(['t1', 't2']);
    await counter.flush();
    expect(calls).toEqual([3]);
  });

  it('em falha do backend devolve as contagens ao buffer', async () => {
    const backend = new MemoryUsageBackend();
    let fail = true;
    const flaky: UsageBackend = {
      incr: async (e) => {
        if (fail) throw new Error('valkey fora');
        return backend.incr(e);
      },
      tenants: backend.tenants.bind(backend),
      get: backend.get.bind(backend),
      snapshot: backend.snapshot.bind(backend),
      lock: backend.lock.bind(backend),
    };
    const counter = new UsageCounter(flaky);
    counter.record('t1', 'r');
    counter.record('t1', 'r');
    await expect(counter.flush()).rejects.toThrow('valkey fora');
    fail = false;
    counter.record('t1', 'r');
    await counter.flush();
    expect(await backend.get(utcDay(), 't1')).toEqual({ r: 3 });
  });

  it('o servidor conta requisições autenticadas por tenant e padrão de rota', async () => {
    const { store, key } = await memoryTenant({ id: 'tenant-a' });
    const usage = new MemoryUsageBackend();
    const app = buildServer({ tenantStore: store, usage });
    await app.inject({ method: 'GET', url: '/v1/sports', headers: { 'x-galaxie-key': key } });
    await app.inject({ method: 'GET', url: '/v1/competitions/abc', headers: { 'x-galaxie-key': key } });
    await app.inject({ method: 'GET', url: '/v1/competitions/xyz', headers: { 'x-galaxie-key': key } });
    await app.inject({ method: 'GET', url: '/v1/sports' }); // sem chave: não conta
    await app.close(); // flush final
    expect(await usage.get(utcDay(), 'tenant-a')).toEqual({
      'GET /v1/sports': 1,
      'GET /v1/competitions/:id': 2,
    });
  });
});

describe('épocas do contador (Codex C17)', () => {
  it('mesma época: maior entre consolidado e base + contador; época nova soma; velha é ignorada', () => {
    const row = { requests: 100, epoch: '000001700000000-b', epochBase: 60 };
    expect(combineUsage(row, { epoch: row.epoch, n: 50 })).toBe(110); // 60 de épocas anteriores + 50
    expect(combineUsage(row, { epoch: row.epoch, n: 30 })).toBe(100); // AOF truncado: não regride
    expect(combineUsage(row, { epoch: '000001700000099-a', n: 3 })).toBe(103); // Valkey zerado: soma
    expect(combineUsage(row, { epoch: '000001600000000-z', n: 3 })).toBe(100); // snapshot atrasado
    expect(combineUsage({ ...row, epoch: null }, { epoch: 'x', n: 3 })).toBe(100);
    expect(combineUsage(undefined, { epoch: 'x', n: 7 })).toBe(7);
  });

  it('a memória abre uma época nova depois de um reset', async () => {
    const backend = new MemoryUsageBackend();
    await backend.incr([{ day: '2026-10-21', tenantId: 't', route: 'r', n: 2 }]);
    const a = await backend.snapshot('2026-10-21', 't');
    backend.reset();
    await backend.incr([{ day: '2026-10-21', tenantId: 't', route: 'r', n: 1 }]);
    const b = await backend.snapshot('2026-10-21', 't');
    expect(a.epoch).toBeTruthy();
    expect(b.epoch).not.toBe(a.epoch);
    expect(b.counts).toEqual({ r: 1 });
  });
});

describe('consulta de uso', () => {
  it('UsageQuery: padrão 7 dias até hoje; valida datas e intervalo', () => {
    const q = UsageQuery.parse({});
    expect(q.to).toBe(utcDay());
    expect((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000).toBe(6);
    expect(UsageQuery.parse({ from: '2026-10-01', to: '2026-10-21' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-21',
    });
    expect(UsageQuery.safeParse({ from: '2026-10-22', to: '2026-10-21' }).success).toBe(false);
    expect(UsageQuery.safeParse({ from: '2026-01-01', to: '2026-10-21' }).success).toBe(false);
    expect(UsageQuery.safeParse({ to: '2026-02-30' }).success).toBe(false);
    expect(UsageQuery.safeParse({ from: '2026-13-01' }).success).toBe(false);
  });

  it('agrupa por dia com rotas em ordem de volume', () => {
    const days = usageByDay([
      { tenantId: 't', day: '2026-10-20', route: 'a', requests: 1 },
      { tenantId: 't', day: '2026-10-20', route: 'b', requests: 5 },
      { tenantId: 't', day: '2026-10-21', route: 'a', requests: 2 },
    ]);
    expect(days).toEqual([
      {
        day: '2026-10-20',
        total: 6,
        routes: [
          { route: 'b', requests: 5 },
          { route: 'a', requests: 1 },
        ],
      },
      { day: '2026-10-21', total: 2, routes: [{ route: 'a', requests: 2 }] },
    ]);
    // os 4 dias retidos no Valkey (TTL), não só ontem e hoje (Codex C16)
    expect(liveDays(new Date('2026-10-21T00:30:00Z'))).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
  });
});
