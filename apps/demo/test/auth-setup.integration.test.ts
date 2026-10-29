import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, type AuthTestDb } from './support/auth-db';

/*
 * Setup do banco da demo (lib/auth/setup.ts) numa segunda subida, com o contêiner anterior ainda gravando e lendo
 * (o deploy troca um pelo outro): o DDL que não tem nada a fazer não pode esperar trava. Antes, `create index if not
 * exists` esperava os inserts abertos e o `alter table activity add column if not exists`, qualquer leitura; com o
 * lock_timeout de 3 s do pool, o setup caía a cada deploy e o resto dele (proteção do código, primeiro admin) não rodava.
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);

let db: AuthTestDb;

beforeAll(async () => {
  db = await createAuthTestDb();
});

afterAll(async () => {
  await db?.drop();
});

describe('setup do banco da demo', () => {
  it('roda de novo sem esperar trava com inserts e leituras abertos nas tabelas próprias', async () => {
    await db.sql.query('begin');
    await db.sql.query(`insert into activity (user_id, kind) values ('u1', 'page')`);
    await db.sql.query(`insert into invite (user_id, kind, delivered) values ('u1', 'invite', true)`);
    await db.sql.query(`insert into otp_failure (email) values ('a@b.c')`);
    await db.sql.query(`insert into otp_request (email) values ('a@b.c')`);
    try {
      const { setupAuthDatabase } = await import('../src/lib/auth/setup');
      await expect(setupAuthDatabase()).resolves.toBeUndefined();
    } finally {
      await db.sql.query('rollback');
    }
  });
});
