import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import { ModerationLists } from './moderation.js';

/** Banco falso: devolve as linhas da vez, ou falha. */
function fakeDb(
  results: Array<Array<{ tenantId: string | null; list: string; locale: string; terms: string[] }> | Error>,
) {
  let calls = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          const r = results[Math.min(calls, results.length - 1)]!;
          calls += 1;
          if (r instanceof Error) throw r;
          return r;
        },
      }),
    }),
  } as unknown as Database;
  return { db, calls: () => calls };
}

const base = [{ tenantId: null, list: 'hate', locale: 'pt', terms: ['gamba'] }];

describe('listas da moderação na API (cache por cliente)', () => {
  it('guarda por 60 s e lê de novo depois', async () => {
    let now = 0;
    const { db, calls } = fakeDb([base]);
    const m = new ModerationLists(db, () => now);
    await m.forTenant('t');
    await m.forTenant('t');
    expect(calls()).toBe(1);
    now = 61_000;
    await m.forTenant('t');
    expect(calls()).toBe(2);
  });

  it('banco fora depois do cache vencer: usa a última lista boa', async () => {
    let now = 0;
    const { db } = fakeDb([base, new Error('db fora')]);
    const m = new ModerationLists(db, () => now);
    const first = await m.forTenant('t');
    now = 61_000;
    expect(await m.forTenant('t')).toBe(first);
  });

  it('falha sem lista boa não fica no cache', async () => {
    const { db, calls } = fakeDb([new Error('db fora'), base]);
    const m = new ModerationLists(db, () => 0);
    await expect(m.forTenant('t')).rejects.toThrow('db fora');
    await m.forTenant('t');
    expect(calls()).toBe(2);
  });
});
