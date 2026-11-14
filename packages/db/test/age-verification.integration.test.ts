import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

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
let tenantId: string;
let profileId: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  [{ id: tenantId }] = (await pg`insert into api.tenant (slug, name, plan, modules)
    values ('idade-a', 'idade-a', 'enterprise', ${['live_chat', 'age_verification']}) returning id`) as unknown as [
    { id: string },
  ];
  const [acc] =
    await pg`insert into fan.account (tenant_id, external_account_id) values (${tenantId}, 'acc') returning id`;
  const [prof] = await pg`insert into fan.profile
      (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
    values (${tenantId}, ${acc!.id}, 'prof', 'Torcedor', '18plus', 'BR', 'pt-BR') returning id`;
  profileId = prof!.id as string;
}, 60_000);

afterAll(async () => {
  await pg?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const insert = (fields: Record<string, unknown>) =>
  pg`insert into fan.age_verification ${pg({
    tenant_id: tenantId,
    profile_id: profileId,
    provider: 'didit',
    provider_session_id: `s-${randomBytes(4).toString('hex')}`,
    expires_at: new Date(Date.now() + 3_600_000),
    ...fields,
  } as Record<string, postgres.ParameterOrJSON<never>>)} returning id`;

describe('fan.age_verification (#1109)', () => {
  it('pendente sem decisão; aprovada com faixa e data de decisão', async () => {
    await expect(insert({})).resolves.toHaveLength(1);
    await expect(
      insert({ status: 'approved', path: 'estimate', result_band: '18plus', decided_at: new Date() }),
    ).resolves.toHaveLength(1);
  });

  it('o banco recusa aprovada sem faixa, decidida sem data, pendente com data e valores fora da lista', async () => {
    for (const bad of [
      { status: 'approved', decided_at: new Date() },
      { status: 'declined' },
      { decided_at: new Date() },
      { provider: 'outro' },
      { status: 'aprovada', decided_at: new Date() },
      { path: 'selfie' },
      { result_band: '13_17', status: 'approved', decided_at: new Date() },
    ])
      await expect(insert(bad), JSON.stringify(bad)).rejects.toThrow(/violates check constraint/);
  });

  it('a mesma sessão do provedor não entra duas vezes', async () => {
    await insert({ provider_session_id: 'repetida' });
    await expect(insert({ provider_session_id: 'repetida' })).rejects.toThrow(/duplicate key/);
  });

  it('apagar o Perfil apaga as verificações', async () => {
    await pg`delete from fan.profile where tenant_id = ${tenantId} and id = ${profileId}`;
    const [{ n }] = (await pg`select count(*)::int as n from fan.age_verification`) as unknown as [
      { n: number },
    ];
    expect(n).toBe(0);
  });
});
