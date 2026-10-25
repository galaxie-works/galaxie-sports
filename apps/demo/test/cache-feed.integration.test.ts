import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, publishChange, runMigrations, type Database } from '@galaxie/db';

import { pgFeedStore } from '../src/lib/cache/feed-store';
import { ChangeFeedFollower } from '../src/lib/cache/follower';

/*
 * Seguidor do change feed da demo contra um Postgres descartável: LISTEN/NOTIFY de verdade, a leitura com
 * a marca d'água tolerante a lacunas e o cursor salvo em demo_auth.cache_feed_cursor. A revalidação (rota
 * interna do Next) é trocada por um gravador.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let db: Database;
const followers: ChangeFeedFollower[] = [];
const calls: string[][] = [];
const revalidate = async (tags: string[]) => {
  calls.push(tags);
};

const follow = async (options: ConstructorParameters<typeof ChangeFeedFollower>[2] = {}) => {
  const f = new ChangeFeedFollower(pgFeedStore(db), revalidate, {
    settleMs: 50,
    pollIntervalMs: 60_000,
    confirmMs: 0,
    ...options,
  });
  followers.push(f);
  await f.start();
  return f;
};

/** Espera a condição (o NOTIFY chega em milissegundos). */
async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
});

afterAll(async () => {
  for (const f of followers) await f.stop();
  await closeDb(db);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('seguidor do change feed (Postgres)', () => {
  it('não reprocessa o histórico na primeira subida; revalida o que chega pelo NOTIFY', async () => {
    await publishChange(db, { topic: 'semantic.review', entityType: 'f1_editorial', entityId: 'velho' });
    const f = await follow();
    expect(calls).toEqual([]);

    await publishChange(db, {
      topic: 'semantic.review',
      entityType: 'f1_editorial',
      entityId: 'lendas.senna',
      payload: { item_id: 'editorial:lendas.senna', review_status: 'approved' },
    });
    await until(() => calls.length === 1);
    expect(calls[0]).toEqual(['f1_editorial:lendas.senna', 'f1_editorial']);

    await f.stop();
    const [saved] = await db.$client<{ last_change_id: string }[]>`
      select last_change_id::text from demo_auth.cache_feed_cursor where name = 'demo-cache'`;
    expect(Number(saved!.last_change_id)).toBe(f.floor);
  });

  it('reinício: retoma do cursor salvo e revalida o que mudou com a demo fora', async () => {
    calls.length = 0;
    await publishChange(db, {
      topic: 'catalog',
      entityType: 'team',
      entityId: 'p1',
      payload: { reason: 'commons_photos', tags: ['asset'] },
    });
    await follow();
    await until(() => calls.length === 1);
    expect(calls[0]).toEqual(['team:p1', 'team', 'asset']);
  });

  it('transação lenta: o ID menor que fica visível depois do maior também é revalidado', async () => {
    calls.length = 0;
    const slow = new Client({ connectionString: testUrl });
    await slow.connect();
    try {
      await slow.query('begin');
      await slow.query(`select ops.publish_change('semantic.review', 'team_profile', 'lento', null)`);
      await publishChange(db, { topic: 'semantic.review', entityType: 'team_profile', entityId: 'rapido' });
      await until(() => calls.flat().includes('team_profile:rapido'));
      await slow.query('commit');
    } finally {
      await slow.end();
    }
    await until(() => calls.flat().includes('team_profile:lento'));
  });
});
