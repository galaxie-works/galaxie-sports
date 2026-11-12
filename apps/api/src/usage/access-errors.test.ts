import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import { AccessErrorRecorder } from './access-errors.js';

/** Banco falso: guarda os lotes do upsert (o SQL de verdade roda no teste de integração). */
function fakeDb(fail: boolean | Error = false) {
  const batches: Record<string, unknown>[][] = [];
  const db = {
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: () =>
          fail
            ? Promise.reject(fail instanceof Error ? fail : new Error('fora'))
            : (batches.push(rows), Promise.resolve()),
      }),
    }),
  } as unknown as Database;
  return { db, batches };
}

const NOW = new Date('2026-11-12T10:00:00Z');

describe('AccessErrorRecorder (#1007)', () => {
  it('soma em memória por tenant × dia × motivo × prefixo × detalhe e grava um lote', async () => {
    const { db, batches } = fakeDb();
    const rec = new AccessErrorRecorder(db, { now: () => NOW });
    rec.record({ tenantId: 't1', reason: 'revoked', keyPrefix: 'abc' });
    rec.record({ tenantId: 't1', reason: 'revoked', keyPrefix: 'abc' });
    rec.record({ tenantId: 't1', reason: 'origin_not_allowed', keyPrefix: 'pk', detail: 'https://x.test' });
    rec.record({ tenantId: 't2', reason: 'rate_limited', detail: 'GET /v1/events\n\u0000' });
    await rec.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      {
        tenantId: 't1',
        day: '2026-11-12',
        reason: 'revoked',
        keyPrefix: 'abc',
        detail: '',
        count: 2,
        lastAt: NOW,
      },
      {
        tenantId: 't1',
        day: '2026-11-12',
        reason: 'origin_not_allowed',
        keyPrefix: 'pk',
        detail: 'https://x.test',
        count: 1,
        lastAt: NOW,
      },
      {
        tenantId: 't2',
        day: '2026-11-12',
        reason: 'rate_limited',
        keyPrefix: '',
        detail: 'GET /v1/events',
        count: 1,
        lastAt: NOW,
      },
    ]);
    await rec.flush();
    expect(batches).toHaveLength(1);
  });

  it('teto de combinações: o excedente é descartado, a combinação já vista segue contando', async () => {
    const { db, batches } = fakeDb();
    const rec = new AccessErrorRecorder(db, { now: () => NOW, maxEntries: 2 });
    for (let i = 0; i < 50; i++)
      rec.record({ tenantId: 't1', reason: 'origin_not_allowed', detail: `https://${i}.test` });
    rec.record({ tenantId: 't1', reason: 'origin_not_allowed', detail: 'https://0.test' });
    expect(rec.dropped).toBe(48);
    await rec.flush();
    expect(batches[0]!.map((r) => r.count)).toEqual([2, 1]);
  });

  it('falha ao gravar devolve as contagens para a próxima consolidação', async () => {
    const bad = fakeDb(true);
    const errors: unknown[] = [];
    const rec = new AccessErrorRecorder(bad.db, { now: () => NOW, onError: (e) => errors.push(e) });
    rec.record({ tenantId: 't1', reason: 'expired', keyPrefix: 'abc' });
    await rec.flush();
    rec.record({ tenantId: 't1', reason: 'expired', keyPrefix: 'abc' });
    expect(errors).toHaveLength(1);
    const good = fakeDb();
    (rec as unknown as { db: Database }).db = good.db;
    await rec.flush();
    expect(good.batches[0]!.map((r) => r.count)).toEqual([2]);
  });

  it('violação de FK (tenant removido), mesmo embrulhada pelo Drizzle em `cause`: o lote é descartado', async () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: { code: '23503' } });
    const bad = fakeDb(wrapped);
    const errors: unknown[] = [];
    const rec = new AccessErrorRecorder(bad.db, { now: () => NOW, onError: (e) => errors.push(e) });
    rec.record({ tenantId: 't-sumiu', reason: 'expired' });
    await rec.flush();
    expect(errors).toEqual([wrapped]);
    const good = fakeDb();
    (rec as unknown as { db: Database }).db = good.db;
    await rec.flush();
    expect(good.batches).toEqual([]);
  });

  it('teto por tenant: origens aleatórias de um tenant viram "(outros)" e não tomam o lugar dos outros', async () => {
    const { db, batches } = fakeDb();
    const dropped: number[] = [];
    const rec = new AccessErrorRecorder(db, {
      now: () => NOW,
      maxEntries: 10,
      maxPerTenant: 3,
      onDropped: (n) => dropped.push(n),
    });
    for (let i = 0; i < 100; i++)
      rec.record({ tenantId: 'atacado', reason: 'origin_not_allowed', detail: `https://${i}.test` });
    rec.record({ tenantId: 'outro', reason: 'revoked', keyPrefix: 'abc' });
    await rec.flush();
    const rows = batches[0]!;
    expect(rows.filter((r) => r.tenantId === 'atacado').map((r) => [r.detail, r.count])).toEqual([
      ['https://0.test', 1],
      ['https://1.test', 1],
      ['https://2.test', 1],
      ['(outros)', 97],
    ]);
    expect(rows.find((r) => r.tenantId === 'outro')).toMatchObject({ count: 1 });
    expect(dropped).toEqual([]);
  });

  it('stop() espera o flush em andamento e grava o que chegou depois', async () => {
    const { db, batches } = fakeDb();
    const rec = new AccessErrorRecorder(db, { now: () => NOW });
    rec.record({ tenantId: 't1', reason: 'expired' });
    const first = rec.flush();
    rec.record({ tenantId: 't1', reason: 'revoked' });
    await rec.stop();
    await first;
    expect(batches.map((b) => b.map((r) => r.reason))).toEqual([['expired'], ['revoked']]);
  });

  it('um "|" no detalhe não junta combinações diferentes', async () => {
    const { db, batches } = fakeDb();
    const rec = new AccessErrorRecorder(db, { now: () => NOW });
    rec.record({ tenantId: 't1', reason: 'rate_limited', keyPrefix: 'a|b', detail: 'c' });
    rec.record({ tenantId: 't1', reason: 'rate_limited', keyPrefix: 'a', detail: 'b|c' });
    await rec.flush();
    expect(batches[0]).toHaveLength(2);
  });
});
