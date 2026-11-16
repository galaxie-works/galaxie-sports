import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_MEMBER_ROLES, runMigrations } from '../src/index.js';

/*
 * Cargos `developer` e `billing` da plataforma comercial (#1136, PL9; migration 0177): entram em `api.tenant_member`
 * e em `api.tenant_role_permission`, e a lista do schema TS bate com o CHECK do banco.
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
let pg: postgres.Sql;
let tenantId: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  [{ id: tenantId }] = (await pg`insert into api.tenant (slug, name, plan, modules)
    values ('cargos-a', 'Cargos A', 'enterprise', ${['core_data']}) returning id`) as unknown as [
    { id: string },
  ];
}, 60_000);

afterAll(async () => {
  await pg?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const member = (role: string) =>
  pg`insert into api.tenant_member (tenant_id, user_id, role, invited_by)
    values (${tenantId}, ${`user-${role}-${randomBytes(3).toString('hex')}`}, ${role}, 'panel:teste') returning id`;

describe('cargos developer e billing (0177)', () => {
  it('todo cargo da lista do schema entra em tenant_member (o Voluntário é sempre um Perfil, fica fora)', async () => {
    for (const role of TENANT_MEMBER_ROLES.filter((r) => r !== 'volunteer'))
      await expect(member(role), role).resolves.toHaveLength(1);
    expect(TENANT_MEMBER_ROLES).toEqual(
      expect.arrayContaining(['owner', 'admin', 'developer', 'billing', 'senior_moderator', 'moderator']),
    );
  });

  it('cargo fora da lista continua recusado', async () => {
    await expect(member('financeiro')).rejects.toThrow(/tenant_member_role/);
  });

  it('o Dono pode mudar as permissões dos cargos novos', async () => {
    for (const role of ['developer', 'billing'])
      await expect(
        pg`insert into api.tenant_role_permission (tenant_id, role, action, allowed, updated_by)
          values (${tenantId}, ${role}, 'billing.view', true, 'panel:teste')`,
        role,
      ).resolves.toBeDefined();
    await expect(
      pg`insert into api.tenant_role_permission (tenant_id, role, action, allowed, updated_by)
        values (${tenantId}, 'owner', 'billing.view', true, 'panel:teste')`,
    ).rejects.toThrow(/tenant_role_permission_role/);
  });
});
