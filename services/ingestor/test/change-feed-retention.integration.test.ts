/** Retenção do `ops.change_feed` (job `change-feed-prune`). */
import { asc, sql } from 'drizzle-orm';
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

  it('a marca é gravada com cada lote: falha no meio não deixa evento apagado sem marca', async () => {
    await db.delete(changeFeed);
    await db.delete(changeFeedPrune);
    await db.delete(webhookCursor);
    const old = [];
    for (let i = 0; i < 4; i++) old.push(await add(`x${i}`, daysAgo(20)));
    for (let i = 0; i < 4; i++) await add(`x${i}`, daysAgo(1)); // última de cada entidade: fica
    // a marca falha a partir do 2º lote: o 1º lote (com a marca) fica, o 2º é desfeito inteiro
    await db.execute(sql`
      create or replace function ops.test_fail_mark() returns trigger language plpgsql as $$
      begin
        if old.max_deleted_id is not null then raise exception 'falha simulada na marca'; end if;
        return new;
      end $$`);
    await db.execute(sql`
      create trigger test_fail_mark before update on ops.change_feed_prune
      for each row execute function ops.test_fail_mark()`);
    try {
      await expect(pruneChangeFeed(db, { now: NOW, retentionDays: 7, batchSize: 2 })).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger test_fail_mark on ops.change_feed_prune`);
      await db.execute(sql`drop function ops.test_fail_mark()`);
    }
    const left = await ids();
    expect(left).toEqual(expect.arrayContaining([old[2], old[3]]));
    expect(left).not.toContain(old[0]);
    expect(await mark()).toBe(old[1]); // tudo o que sumiu está coberto pela marca
  });

  it('respeita o piso do GapCursor do cache da demo enquanto ela ainda retomaria dele', async () => {
    await db.delete(changeFeed);
    await db.delete(changeFeedPrune);
    await db.delete(webhookCursor);
    await db.execute(sql`create schema if not exists demo_auth`);
    await db.execute(sql`
      create table if not exists demo_auth.cache_feed_cursor (
        name text primary key, last_change_id bigint not null, updated_at timestamptz not null default now())`);
    const e1 = await add('e', daysAgo(20));
    const e2 = await add('e', daysAgo(15));
    await add('e', daysAgo(1));
    // a demo processou só até e1 (o cursor salvo é o piso do GapCursor dela)
    await db.execute(
      sql`insert into demo_auth.cache_feed_cursor (name, last_change_id) values ('demo-cache', ${e1})`,
    );
    const plan = await pruneChangeFeed(db, { now: NOW, retentionDays: 7, dryRun: true });
    expect(plan).toMatchObject({ deleted: 1, webhookCursor: e1 });
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(1);
    expect(await ids()).toContain(e2);
    // cursor parado há mais de 24 h: a demo não retoma dele (resumeMaxAgeMs), então não segura a poda
    await db.execute(sql`update demo_auth.cache_feed_cursor set updated_at = now() - interval '2 days'`);
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(1);
    expect(await ids()).not.toContain(e2);
    await db.execute(sql`drop schema demo_auth cascade`);
  });

  it('respeita o cursor do purge do cache da API (api.change_feed_cursor) do mesmo jeito', async () => {
    await db.delete(changeFeed);
    await db.delete(changeFeedPrune);
    await db.delete(webhookCursor);
    // a tabela vem na migration do lote 5; aqui é criada se ainda não existir
    await db.execute(sql`
      create table if not exists api.change_feed_cursor (
        name text primary key, last_change_id bigint not null, updated_at timestamptz not null default now())`);
    const f1 = await add('f', daysAgo(20));
    const f2 = await add('f', daysAgo(15));
    await add('f', daysAgo(1));
    await db.execute(sql`delete from api.change_feed_cursor`);
    await db.execute(
      sql`insert into api.change_feed_cursor (name, last_change_id) values ('cache-purge', ${f1})`,
    );
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(1);
    expect(await ids()).toContain(f2);
    await db.execute(sql`update api.change_feed_cursor set updated_at = now() - interval '2 days'`);
    expect((await pruneChangeFeed(db, { now: NOW, retentionDays: 7 })).deleted).toBe(1);
    expect(await ids()).not.toContain(f2);
    await db.execute(sql`delete from api.change_feed_cursor`);
  });

  it('recusa retenção menor que 1 dia', async () => {
    await expect(pruneChangeFeed(db, { retentionDays: 0 })).rejects.toThrow('≥ 1 dia');
  });
});
