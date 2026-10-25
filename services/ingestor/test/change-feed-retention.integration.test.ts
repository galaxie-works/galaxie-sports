/** Retenção do `ops.change_feed` (job `change-feed-prune`). */
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeFeed, changeFeedPrune, webhookCursor, type Database } from '@galaxie/db';
import { pruneChangeFeed } from '../src/ops/change-feed-retention.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const NOW = new Date('2026-10-21T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

async function add(entityId: string, createdAt: Date, topic = 'event.score_changed'): Promise<number> {
  const [row] = await db
    .insert(changeFeed)
    .values({ topic, entityType: 'event', entityId, payload: null, createdAt })
    .returning({ id: changeFeed.id });
  return row!.id;
}

const mark = async () => (await db.select().from(changeFeedPrune))[0]?.maxDeletedId;
const ids = async () => (await db.select().from(changeFeed).orderBy(asc(changeFeed.id))).map((r) => r.id);

beforeAll(async () => {
  db = await disposable.setup();
});

afterAll(async () => {
  await disposable.teardown();
});

describe('pruneChangeFeed', () => {
  it('apaga o que passou da retenção, mantém a última mudança de cada entidade e respeita os webhooks', async () => {
    const a1 = await add('a', daysAgo(30));
    const a2 = await add('a', daysAgo(20), 'event.status_changed');
    const a3 = await add('a', daysAgo(10)); // última de "a", mesmo velha: fica
    const b1 = await add('b', daysAgo(15)); // única de "b": fica
    const c1 = await add('c', daysAgo(9));
    const c2 = await add('c', daysAgo(1)); // recente
    const d1 = await add('d', daysAgo(12));
    const d2 = await add('d', daysAgo(8));
    const d3 = await add('d', daysAgo(2));

    // o enfileirador de webhooks ainda não leu além de c1: d1 e d2 (velhas) precisam ficar
    await db.insert(webhookCursor).values({ name: 'webhooks', lastChangeId: c1 });

    const plan = await pruneChangeFeed(db, { now: NOW, retentionDays: 7, dryRun: true });
    expect(plan).toMatchObject({ deleted: 3, webhookCursor: c1, dryRun: true });
    expect(await ids()).toHaveLength(9);

    const done = await pruneChangeFeed(db, { now: NOW, retentionDays: 7, batchSize: 2 });
    expect(done.deleted).toBe(3);
    expect(await ids()).toEqual([a3, b1, c2, d1, d2, d3]);
    expect([a1, a2, c1].some((id) => [a3, b1, c2, d1, d2, d3].includes(id))).toBe(false);
    // marca da poda (o SSE avisa replay_truncated abaixo dela): o maior id apagado, não o menor que ficou
    expect(await mark()).toBe(c1);

    // webhooks em dia: agora d1 e d2 também podem sair
    await db.update(webhookCursor).set({ lastChangeId: d3 });
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(2);
    expect(await ids()).toEqual([a3, b1, c2, d3]);
    expect(await mark()).toBe(d2);
    // idempotente (e a marca não regride)
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(0);
    expect(await mark()).toBe(d2);
  });

  it('recusa retenção menor que 1 dia', async () => {
    await expect(pruneChangeFeed(db, { retentionDays: 0 })).rejects.toThrow('≥ 1 dia');
  });
});
