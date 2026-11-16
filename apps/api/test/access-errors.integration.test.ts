import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accessErrorDaily,
  closeDb,
  createDb,
  listTenantAccessErrors,
  runMigrations,
  tenant,
  type Database,
} from '@galaxie/db';
import { AccessErrorRecorder } from '../src/usage/access-errors.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let pg: postgres.Sql;
let db: Database;
let t1: string;
let t2: string;

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });
  const rows = await db
    .insert(tenant)
    .values([
      { slug: 'erros-a', name: 'A', plan: 'core_data', modules: ['core_data'] },
      { slug: 'erros-b', name: 'B', plan: 'core_data', modules: ['core_data'] },
    ])
    .returning({ id: tenant.id });
  t1 = rows[0]!.id;
  t2 = rows[1]!.id;
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

describe('erros de acesso por tenant (#1007)', () => {
  it('duas consolidações somam na mesma linha; a lista do tenant não mostra os de outro', async () => {
    const at = new Date('2026-11-12T10:00:00Z');
    let now = at;
    const rec = new AccessErrorRecorder(db, { now: () => now });
    rec.record({ tenantId: t1, reason: 'revoked', keyPrefix: 'abc' });
    rec.record({ tenantId: t2, reason: 'revoked', keyPrefix: 'xyz' });
    await rec.flush();
    now = new Date('2026-11-12T10:05:00Z');
    rec.record({ tenantId: t1, reason: 'revoked', keyPrefix: 'abc' });
    await rec.flush();

    const mine = await listTenantAccessErrors(db, t1, { now: at });
    expect(mine).toEqual([
      {
        day: '2026-11-12',
        reason: 'revoked',
        keyPrefix: 'abc',
        detail: '',
        count: 2,
        lastAt: new Date('2026-11-12T10:05:00Z'),
      },
    ]);
    expect((await listTenantAccessErrors(db, t2, { now: at })).map((r) => r.keyPrefix)).toEqual(['xyz']);
    // fora da janela de dias
    expect(await listTenantAccessErrors(db, t1, { now: new Date('2026-11-25T00:00:00Z'), days: 7 })).toEqual(
      [],
    );
  });

  it('tenant que não existe mais (FK): o lote é descartado, sem travar as consolidações seguintes', async () => {
    const errors: unknown[] = [];
    const now = new Date('2026-11-13T10:00:00Z');
    const rec = new AccessErrorRecorder(db, { now: () => now, onError: (e) => errors.push(e) });
    rec.record({ tenantId: '00000000-0000-7000-8000-000000000000', reason: 'expired' });
    await rec.flush();
    expect(errors).toHaveLength(1);
    rec.record({ tenantId: t2, reason: 'expired', keyPrefix: 'xyz' });
    await rec.flush();
    expect(errors).toHaveLength(1);
    const rows = await db.select().from(accessErrorDaily);
    expect(rows.some((r) => r.tenantId === t2 && r.reason === 'expired' && r.count === 1)).toBe(true);
  });
});
