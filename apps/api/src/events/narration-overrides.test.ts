import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@galaxie/db';
import { loadNarrationOverrides, resetNarrationOverridesCache } from './narration-overrides.js';

/** Banco falso: só o `select().from()` que a leitura usa. */
function fakeDb(rows: () => Promise<unknown[]>) {
  const from = vi.fn(rows);
  return { db: { select: () => ({ from }) } as unknown as Database, from };
}
const row = (variants: string[], updatedAt = new Date('2026-11-12T10:00:00Z')) => ({
  key: 'goal.lead',
  lang: 'pt',
  variants,
  updatedAt,
});

describe('frases editadas em Ajustes: leitura (#1167)', () => {
  beforeEach(() => resetNarrationOverridesCache());

  it('lê uma vez por minuto, e o stamp muda com a gravação', async () => {
    let t = 1_000_000;
    let rows = [row(['A {team}!'])];
    const { db, from } = fakeDb(async () => rows);
    const first = await loadNarrationOverrides(db, () => t);
    expect(first.overrides['goal.lead']?.pt).toEqual(['A {team}!']);
    t += 30_000;
    expect((await loadNarrationOverrides(db, () => t)).stamp).toBe(first.stamp);
    expect(from).toHaveBeenCalledTimes(1);
    // passou o minuto: devolve a leitura anterior na hora e renova ao lado
    rows = [row(['B {team}!'], new Date('2026-11-12T11:00:00Z'))];
    t += 40_000;
    expect((await loadNarrationOverrides(db, () => t)).stamp).toBe(first.stamp);
    await vi.waitFor(async () =>
      expect((await loadNarrationOverrides(db, () => t)).stamp).not.toBe(first.stamp),
    );
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('banco fora: frases padrão, e no máximo uma consulta por minuto', async () => {
    let t = 5_000_000;
    const { db, from } = fakeDb(async () => {
      throw new Error('banco fora');
    });
    const reqs = await Promise.all(Array.from({ length: 20 }, () => loadNarrationOverrides(db, () => t)));
    expect(reqs.every((r) => r.stamp === '0')).toBe(true);
    t += 10_000;
    await loadNarrationOverrides(db, () => t);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
