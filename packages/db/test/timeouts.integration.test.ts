import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Database } from '../src/index.js';
import { isLockTimeout } from '../src/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const opened: Database[] = [];
const open = (...args: Parameters<typeof createDb>) => {
  const db = createDb(...args);
  opened.push(db);
  return db;
};

afterAll(async () => {
  await Promise.all(opened.map((db) => closeDb(db)));
});

async function settings(db: Database) {
  const [row] = await db.execute<{ st: string; lt: string; it: string; app: string }>(sql`
    select current_setting('statement_timeout') as st, current_setting('lock_timeout') as lt,
      current_setting('idle_in_transaction_session_timeout') as it, current_setting('application_name') as app`);
  return row!;
}

describe('freios da sessão por perfil', () => {
  it('a API sai com os três tempos curtos e o nome no pg_stat_activity', async () => {
    const s = await settings(open(url, { profile: 'api', applicationName: 'galaxie-api-teste' }));
    expect(s).toEqual({ st: '10s', lt: '3s', it: '15s', app: 'galaxie-api-teste' });
  });

  it('o migrate não tem teto de consulta, só de trava', async () => {
    const s = await settings(open(url, { profile: 'migrate', max: 1 }));
    expect(s.st).toBe('0');
    expect(s.lt).toBe('5s');
  });

  it('a consulta que passa do statement_timeout é cancelada (57014)', async () => {
    const db = open(url, { profile: 'api', timeouts: { statementMs: 200 } });
    const err: unknown = await db.execute(sql`select pg_sleep(2)`).then(
      () => null,
      (e: unknown) => e,
    );
    // o drizzle embrulha o erro do driver (cause); o SQLSTATE é o do Postgres
    const code = (e: unknown): unknown =>
      (e as { code?: unknown })?.code ??
      ((e as { cause?: unknown })?.cause && code((e as { cause: unknown }).cause));
    expect(code(err)).toBe('57014');
    // a conexão volta para o pool e segue servindo
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
  });

  it('o migrate desiste de esperar a trava de outra sessão (55P03), o sinal para tentar de novo', async () => {
    const holder = open(url, { max: 1 });
    const table = `ops_lock_test_${Math.random().toString(36).slice(2, 8)}`;
    await holder.execute(sql.raw(`create table ${table} (id int)`));
    try {
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holding = holder.transaction(async (tx) => {
        await tx.execute(sql.raw(`lock table ${table} in access exclusive mode`));
        locked();
        await released;
      });
      await isLocked;
      const migrate = open(url, { profile: 'migrate', max: 1, timeouts: { lockMs: 200 } });
      const err: unknown = await migrate.execute(sql.raw(`alter table ${table} add column x int`)).then(
        () => null,
        (e: unknown) => e,
      );
      release();
      await holding;
      expect(isLockTimeout(err)).toBe(true);
    } finally {
      await holder.execute(sql.raw(`drop table if exists ${table}`));
    }
  });
});
