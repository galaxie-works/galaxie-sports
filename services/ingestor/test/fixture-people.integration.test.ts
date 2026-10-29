/** Quem jogou e quem dirigiu cada partida (`football_fixture.player_pids`/`coach_pids`): trigger e job `fixture-people`. */
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event, footballFixture, sport, type Database } from '@galaxie/db';
import { fillFixturePeople } from '../src/ops/fixture-people.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
}, 60_000);
afterAll(() => testDb.teardown());

const detailOf = (players: (number | string)[][], coaches: (number | string | null)[]) => ({
  players: players.map((ids, i) => ({
    team: { id: 100 + i },
    players: ids.map((id) => ({ player: { id } })),
  })),
  lineups: coaches.map((id, i) => ({ team: { id: 100 + i }, coach: id === null ? null : { id } })),
});

async function fixture(seq: number, detail: unknown): Promise<string> {
  const startsAt = new Date('2026-09-01T20:00:00Z');
  const [e] = await db
    .insert(event)
    .values({ sport: 'football', startsAt, endsAtExpected: new Date(startsAt.getTime() + 7_200_000) })
    .returning();
  await db
    .insert(footballFixture)
    .values({ eventId: e!.id, providerFixtureId: 900_000 + seq, summary: {}, detail });
  return e!.id;
}

const people = async (eventId: string) => {
  const [row] = await db
    .select({ players: footballFixture.playerPids, coaches: footballFixture.coachPids })
    .from(footballFixture)
    .where(eq(footballFixture.eventId, eventId));
  return {
    players: row?.players ? [...row.players].sort((a, b) => a - b) : null,
    coaches: row?.coaches ?? null,
  };
};

describe('pessoas da partida', () => {
  it('o trigger preenche na inserção e recalcula quando o detalhe muda; detalhe nulo vira lista vazia', async () => {
    const id = await fixture(
      1,
      detailOf(
        [
          [10, 11, 11],
          [20, 'x9'],
        ],
        [7, null],
      ),
    );
    expect(await people(id)).toEqual({ players: [10, 11, 20], coaches: [7] });

    await db
      .update(footballFixture)
      .set({ detail: detailOf([[10], [21]], [8, 9]) })
      .where(eq(footballFixture.eventId, id));
    expect(await people(id)).toEqual({ players: [10, 21], coaches: [8, 9] });

    const empty = await fixture(2, null);
    expect(await people(empty)).toEqual({ players: [], coaches: [] });
  });

  it('o job preenche as linhas antigas em lotes e, sem nada nulo, só confere', async () => {
    const ids = [await fixture(3, detailOf([[30]], [3])), await fixture(4, detailOf([[40]], [4]))];
    // linhas de antes do trigger: o UPDATE sem o detalhe não dispara o trigger
    await db.execute(sql`update core.football_fixture set player_pids = null, coach_pids = null`);
    const all = await db
      .select({ id: footballFixture.eventId })
      .from(footballFixture)
      .orderBy(asc(footballFixture.eventId));

    expect(await fillFixturePeople(db, { dryRun: true })).toMatchObject({ filled: all.length, dryRun: true });
    const sleeps: number[] = [];
    const first = await fillFixturePeople(db, {
      batchSize: 1,
      pauseMs: 5,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(first).toEqual({ filled: all.length, batches: all.length, partial: false, dryRun: false });
    expect(sleeps).toHaveLength(all.length);
    expect(await people(ids[0]!)).toEqual({ players: [30], coaches: [3] });
    expect(await people(ids[1]!)).toEqual({ players: [40], coaches: [4] });

    expect(await fillFixturePeople(db)).toEqual({ filled: 0, batches: 0, partial: false, dryRun: false });
  });

  it('para no teto de tempo e continua na próxima execução', async () => {
    await db.execute(sql`update core.football_fixture set player_pids = null, coach_pids = null`);
    const partial = await fillFixturePeople(db, { batchSize: 1, maxMs: 0, sleep: async () => {} });
    expect(partial).toMatchObject({ filled: 1, batches: 1, partial: true });
    const rest = await fillFixturePeople(db, { batchSize: 2, sleep: async () => {} });
    expect(rest.partial).toBe(false);
    const [left] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.football_fixture where player_pids is null or coach_pids is null`,
    );
    expect(left?.n).toBe(0);
  });
});
