import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  recordSponsorImpressions,
  runMigrations,
  sponsor,
  sponsorImpressionReport,
  type Database,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let pg: postgres.Sql;
let db: Database;
let tenantId: string;
let otherTenant: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  const tenant = async (slug: string) =>
    (
      await pg`insert into api.tenant (slug, name, plan, modules)
        values (${slug}, ${slug}, 'enterprise', ${['live_chat']}) returning id`
    )[0]!.id as string;
  tenantId = await tenant('patrocinio-a');
  otherTenant = await tenant('patrocinio-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const add = async (name: string, tenant = tenantId, category = 'beverage') =>
  (
    await db
      .insert(sponsor)
      .values({ tenantId: tenant, name, category, updatedBy: 'teste' })
      .returning({ id: sponsor.id })
  )[0]!.id;

/** O drizzle embrulha o erro do driver: o nome da constraint vem na causa. */
const rejectsWith = async (p: Promise<unknown>, constraint: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).not.toBeNull();
  const cause = (err as { cause?: { constraint_name?: string; message?: string } }).cause;
  expect(`${cause?.constraint_name ?? ''} ${cause?.message ?? ''} ${String(err)}`).toMatch(constraint);
};

describe('patrocinadores (B10, #1021)', () => {
  it('o banco recusa categoria de aposta e link sem https', async () => {
    await rejectsWith(add('Casa X', tenantId, 'betting'), /sponsor_category/);
    await expect(
      db
        .insert(sponsor)
        .values({ tenantId, name: 'Y', category: 'food', linkUrl: 'http://y.com', updatedBy: 't' }),
    ).rejects.toThrow();
  });

  it('o mesmo nome uma vez só por cliente (entre os ativos)', async () => {
    await add('Banco Alfa');
    await rejectsWith(add('banco alfa'), /sponsor_tenant_name_uq/);
    await add('Banco Alfa', otherTenant);
  });

  it('o mesmo patrocinador soma impressões na sala e na campanha, sem dado individual', async () => {
    const id = await add('Operadora Sul');
    await recordSponsorImpressions(db, [
      { tenantId, sponsorId: id, surface: 'chat_room', surfaceId: 'sala-1', day: '2026-11-10', count: 10 },
      { tenantId, sponsorId: id, surface: 'chat_room', surfaceId: 'sala-1', day: '2026-11-10', count: 5 },
      { tenantId, sponsorId: id, surface: 'chat_room', surfaceId: 'sala-1', day: '2026-11-11', count: 7 },
      {
        tenantId,
        sponsorId: id,
        surface: 'prediction_campaign',
        surfaceId: 'bolao-1',
        day: '2026-11-11',
        count: 3,
      },
    ]);
    await recordSponsorImpressions(db, [
      { tenantId, sponsorId: id, surface: 'chat_room', surfaceId: 'sala-1', day: '2026-11-11', count: 1 },
    ]);
    expect(await sponsorImpressionReport(db, tenantId, { from: '2026-11-01', to: '2026-11-30' })).toEqual([
      { sponsorId: id, surface: 'chat_room', surfaceId: 'sala-1', impressions: 23, days: 2 },
      { sponsorId: id, surface: 'prediction_campaign', surfaceId: 'bolao-1', impressions: 3, days: 1 },
    ]);
    expect(await sponsorImpressionReport(db, otherTenant, { from: '2026-11-01', to: '2026-11-30' })).toEqual(
      [],
    );
    const cols = await pg`select column_name from information_schema.columns
      where table_schema = 'engage' and table_name = 'sponsor_impression_daily'`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['day', 'impressions', 'sponsor_id', 'surface', 'surface_id', 'tenant_id'].sort(),
    );
  });

  it('impressão de patrocinador de outro cliente é recusada', async () => {
    const id = await add('Varejo Norte', otherTenant);
    await expect(
      recordSponsorImpressions(db, [
        { tenantId, sponsorId: id, surface: 'reward', surfaceId: 'r1', day: '2026-11-11', count: 1 },
      ]),
    ).rejects.toThrow();
    await expect(
      recordSponsorImpressions(db, [
        { tenantId, sponsorId: id, surface: 'reward', surfaceId: 'r1', day: '2026-11-11', count: 0 },
      ]),
    ).rejects.toThrow(/impressão inválida/);
  });
});
