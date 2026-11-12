import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  listTenantSecretKeyStates,
  listTenantUsageByRoute,
  runMigrations,
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
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  const tenant = async (slug: string) =>
    (
      await pg`insert into api.tenant (slug, name, plan, modules)
        values (${slug}, ${slug}, 'enterprise', ${['core_data']}) returning id`
    )[0]!.id as string;
  tenantA = await tenant('diagnostico-a');
  tenantB = await tenant('diagnostico-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('dados do diagnóstico da Cosmos (#1007)', () => {
  it('chaves secretas: só as do tenant, sem o hash do segredo', async () => {
    await pg`insert into api.api_key (tenant_id, prefix, env, secret_hash, label, revoked_at)
      values (${tenantA}, 'aaaaaaaaaaaa', 'live', 'scrypt$hash-a', 'servidor', null),
             (${tenantA}, 'bbbbbbbbbbbb', 'test', 'scrypt$hash-b', null, now()),
             (${tenantB}, 'cccccccccccc', 'live', 'scrypt$hash-c', 'outro', null)`;
    const keys = await listTenantSecretKeyStates(db, tenantA);
    expect(keys.map((k) => [k.prefix, k.env, k.revokedAt !== null]).sort()).toEqual([
      ['aaaaaaaaaaaa', 'live', false],
      ['bbbbbbbbbbbb', 'test', true],
    ]);
    expect(JSON.stringify(keys)).not.toContain('scrypt');
  });

  it('uso por rota: desde o dia pedido e só do tenant', async () => {
    await pg`insert into api.usage_daily (tenant_id, day, route, requests)
      values (${tenantA}, '2026-10-31', '/v1/fixtures', 50),
             (${tenantA}, '2026-11-01', '/v1/fixtures', 10),
             (${tenantA}, '2026-11-02', '/v1/standings', 3),
             (${tenantB}, '2026-11-01', '/v1/fixtures', 99)`;
    const rows = await listTenantUsageByRoute(db, tenantA, '2026-11-01');
    expect(rows.sort((a, b) => a.day.localeCompare(b.day))).toEqual([
      { day: '2026-11-01', route: '/v1/fixtures', requests: 10 },
      { day: '2026-11-02', route: '/v1/standings', requests: 3 },
    ]);
  });

  it('as funções da ajuda de integração entram ativas, com o mínimo aprovado', async () => {
    const rows = await pg<{ name: string; min_credits: number; permission: string; active: boolean }[]>`
      select name, min_credits::int as min_credits, permission, active from cosmos.function_def
       where name in ('key.diagnose', 'webhook.diagnose', 'usage.report') order by name`;
    expect(rows.map((r) => [r.name, r.min_credits, r.permission, r.active])).toEqual([
      ['key.diagnose', 5, 'settings.manage', true],
      ['usage.report', 15, 'settings.manage', true],
      ['webhook.diagnose', 5, 'settings.manage', true],
    ]);
  });
});
