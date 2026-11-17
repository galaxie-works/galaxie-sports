/**
 * Relógio dos eventos em páginas (`advanceEventClock`, migration 0183): os candidatos saem por `(starts_at, id)` com
 * `limit`; jogos com o mesmo `starts_at` na borda entre duas páginas não podem ser pulados nem repetidos.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event, sport, type Database } from '@galaxie/db';
import { advanceEventClock } from '@galaxie/core-writer';
import { disposableDb } from './db.js';

const env = disposableDb();
let db: Database;
const NOW = new Date('2026-11-17T20:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

beforeAll(async () => {
  db = await env.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('relógio dos eventos em páginas', () => {
  it('3 páginas com empate de starts_at na borda: cada jogo examinado uma vez', async () => {
    // 5 candidatos (3 com o mesmo horário, atravessando a borda das páginas de 2), 1 depois do horizonte e 1 encerrado
    const starts = [at(2), at(5), at(5), at(5), at(8)];
    const candidates = await db
      .insert(event)
      .values(starts.map((s) => ({ sport: 'football', startsAt: s, endsAtExpected: at(120) })))
      .returning({ id: event.id });
    const [later] = await db
      .insert(event)
      .values({ sport: 'football', startsAt: at(30), endsAtExpected: at(150) })
      .returning({ id: event.id });
    const [done] = await db
      .insert(event)
      .values({ sport: 'football', startsAt: at(-200), endsAtExpected: at(-80), status: 'finished' })
      .returning({ id: event.id });

    const first = await advanceEventClock(db, NOW, { pageSize: 2 });
    expect(first).toMatchObject({ examined: 5, changed: 5 });
    const rows = await db
      .select({ id: event.id, status: event.status })
      .from(event)
      .where(
        inArray(
          event.id,
          candidates.map((c) => c.id),
        ),
      );
    expect(rows.map((r) => r.status)).toEqual(Array(5).fill('starting'));
    const [laterRow] = await db.select().from(event).where(eq(event.id, later!.id));
    expect(laterRow?.status).toBe('scheduled');
    const [doneRow] = await db.select().from(event).where(eq(event.id, done!.id));
    expect(doneRow?.status).toBe('finished');

    // de novo no mesmo instante: os mesmos 5 examinados (página exata no fim: 2 + 2 + 1), nada muda
    expect(await advanceEventClock(db, NOW, { pageSize: 2 })).toMatchObject({ examined: 5, changed: 0 });
    // página do tamanho exato do total: uma página cheia e uma vazia
    expect(await advanceEventClock(db, NOW, { pageSize: 5 })).toMatchObject({ examined: 5, changed: 0 });
  });
});
