import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeFeed, changeFeedCursor, closeDb, createDb, runMigrations, type Database } from '@galaxie/db';
import { ChangeFeedListener } from '../src/cache/change-feed.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { MemoryResponseCache, type CachedResponse } from '../src/cache/store.js';

/**
 * Cursor do purge do cache salvo no banco (lote 5 da auditoria): as mudanças que caem com a API fora do ar
 * (deploy) são purgadas na subida seguinte, em vez de a resposta velha ficar no Valkey até o TTL.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

const entry = (tags: string[]): CachedResponse => ({
  status: 200,
  body: '{}',
  etag: '"x"',
  tags,
  storedAt: Date.now(),
  ttl: 3600,
});

const change = (entityId: string) => ({
  topic: 'event.score',
  entityType: 'event',
  entityId,
  payload: { event_id: entityId },
});

const latestId = async () =>
  Number((await db.select({ max: sql<string>`max(${changeFeed.id})` }).from(changeFeed))[0]!.max);

const savedCursor = async () =>
  (await db.select().from(changeFeedCursor).where(eq(changeFeedCursor.name, 'cache-purge')))[0];

const listener = (cache: MemoryResponseCache, cdn: RecordingCdnPurger) =>
  new ChangeFeedListener(db, cache, cdn, { listen: false, pollIntervalMs: 60_000, saveEveryMs: 0 });

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
  await db.insert(changeFeed).values([change('e0'), change('e0')]);
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('ChangeFeedListener — cursor salvo em api.change_feed_cursor', () => {
  it('primeira subida: parte do fim do change feed e grava o ponto de partida', async () => {
    const cache = new MemoryResponseCache();
    const cdn = new RecordingCdnPurger();
    await cache.set('antigo', entry(['event:e0']), 3600);
    const l = listener(cache, cdn);
    await l.start();
    await l.poll();
    await l.stop();
    expect((await savedCursor())?.lastChangeId).toBe(await latestId());
    // o histórico de antes da primeira subida não é purgado
    expect(await cache.get('antigo')).toBeDefined();
    expect(cdn.purged).toEqual([]);
  });

  it('mudança com a API fora do ar é purgada na subida seguinte', async () => {
    const cache = new MemoryResponseCache();
    const cdn = new RecordingCdnPurger();
    await cache.set('placar-e1', entry(['event:e1', 'event']), 3600);
    await cache.set('placar-e2', entry(['event:e2']), 3600);
    const before = (await savedCursor())!.lastChangeId;
    // a API está fora (deploy): o ingestor grava o gol do e1
    const [gol] = await db.insert(changeFeed).values(change('e1')).returning({ id: changeFeed.id });

    const l = listener(cache, cdn);
    await l.start();
    await l.poll();
    expect(await cache.get('placar-e1')).toBeUndefined();
    expect(await cache.get('placar-e2')).toBeDefined();
    expect(cdn.purged.flat()).toContain('event:e1');
    expect(l.floor).toBe(gol!.id);
    await l.stop();
    expect((await savedCursor())!.lastChangeId).toBe(gol!.id);
    expect(gol!.id).toBeGreaterThan(before);
  });

  it('cursor velho demais (mais de 24 h): parte do mais recente, sem purgar o histórico', async () => {
    await db.insert(changeFeed).values(change('e3'));
    await db
      .update(changeFeedCursor)
      .set({ updatedAt: sql`now() - interval '2 days'` })
      .where(eq(changeFeedCursor.name, 'cache-purge'));
    const cache = new MemoryResponseCache();
    const cdn = new RecordingCdnPurger();
    await cache.set('placar-e3', entry(['event:e3']), 3600);
    const l = listener(cache, cdn);
    await l.start();
    await l.poll();
    await l.stop();
    expect(await cache.get('placar-e3')).toBeDefined();
    expect((await savedCursor())!.lastChangeId).toBe(await latestId());
  });
});
