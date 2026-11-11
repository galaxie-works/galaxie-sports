import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Permissões por cargo configuráveis pelo Dono (#1019) com logins de verdade: a configuração fica no banco do
 * tenant, o can() da sessão passa a lê-la, cada mudança entra na auditoria dos cargos e as travas (Dono, ações fixas,
 * Escada) seguram pedidos forjados.
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);
const request = vi.hoisted(() => ({ cookie: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: request.cookie }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/root-params', () => ({ locale: async () => 'pt-BR' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

let db: AuthTestDb;
let actions: typeof import('../src/app/[locale]/(app)/cliente/usuarios/actions');
let session: typeof import('../src/lib/client/session');
let permissions: typeof import('../src/lib/client/permissions');
const T1 = randomUUID();
const T2 = randomUUID();
const cookies: Record<string, string> = {};

const as = (who: string) => {
  request.cookie = cookies[who]!;
};
const context = async () => (await session.readClientContext())!;
const events = async (tenant: string) =>
  (
    await db.sql.query<{
      action: string;
      to_role: string;
      subject: string;
      actor: string;
      member_id: string | null;
    }>(
      `select action, to_role, subject, actor, member_id from api.tenant_member_event
        where tenant_id = $1 and action like 'permission_%' order by id`,
      [tenant],
    )
  ).rows;
const stored = async (tenant: string) =>
  (
    await db.sql.query(
      `select role, action, allowed from api.tenant_role_permission where tenant_id = $1 order by role, action`,
      [tenant],
    )
  ).rows;

beforeAll(async () => {
  db = await createAuthTestDb();
  const { runMigrations } = await import('@galaxie/db');
  await runMigrations(process.env.DEMO_DATABASE_URL!);
  for (const [id, slug] of [
    [T1, 'permissoes-um'],
    [T2, 'permissoes-dois'],
  ])
    await db.sql.query(
      `insert into api.tenant (id, slug, name, plan, modules) values ($1, $2, $2, 'core_data', '{core_data}')`,
      [id, slug],
    );
  for (const email of ['dono@p1.test', 'admin@p1.test', 'mod@p1.test', 'dono@p2.test'])
    cookies[email] = await signInAs(email, 'client');
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'dono@p1.test'`, [T1]);
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'dono@p2.test'`, [T2]);
  session = await import('../src/lib/client/session');
  permissions = await import('../src/lib/client/permissions');
  actions = await import('../src/app/[locale]/(app)/cliente/usuarios/actions');
  as('dono@p1.test');
  await context();
  expect((await actions.inviteMember({ email: 'admin@p1.test', name: 'Admin', role: 'admin' })).ok).toBe(
    true,
  );
  expect((await actions.inviteMember({ email: 'mod@p1.test', name: 'Mod', role: 'moderator' })).ok).toBe(
    true,
  );
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

describe('permissões por cargo (#1019)', () => {
  it('sem configuração, vale a matriz padrão (Admin vê a Cosmos, não gerencia)', async () => {
    as('admin@p1.test');
    const ctx = await context();
    expect(ctx.actor).toEqual({ kind: 'member', tenantId: T1, role: 'admin', scope: null });
    expect(permissions.can(ctx, 'cosmos.view')).toBe(true);
    expect(permissions.can(ctx, 'cosmos.manage')).toBe(false);
    expect(await stored(T1)).toEqual([]);
  });

  it('o Dono libera cosmos.manage ao Admin: o can() da sessão passa a ler a configuração, com auditoria', async () => {
    as('dono@p1.test');
    expect(
      await actions.changeRolePermission({ role: 'admin', action: 'cosmos.manage', allowed: true }),
    ).toEqual({ ok: true });
    expect(await stored(T1)).toEqual([{ role: 'admin', action: 'cosmos.manage', allowed: true }]);
    expect(await events(T1)).toEqual([
      {
        action: 'permission_granted',
        to_role: 'admin',
        subject: 'cosmos.manage',
        actor: expect.stringMatching(/^panel:/),
        member_id: null,
      },
    ]);
    as('admin@p1.test');
    expect(permissions.can(await context(), 'cosmos.manage')).toBe(true);
    // o Moderador, abaixo, continua sem
    as('mod@p1.test');
    expect(permissions.can(await context(), 'cosmos.manage')).toBe(false);
  });

  it('a Escada: dar ao Moderador dá ao Moderador sênior; tirar do Admin tira dos de baixo', async () => {
    as('dono@p1.test');
    expect(
      (await actions.changeRolePermission({ role: 'moderator', action: 'moderation.ban', allowed: true })).ok,
    ).toBe(true);
    const granted = (await events(T1)).slice(1).map((e) => [e.action, e.to_role, e.subject]);
    expect(granted).toEqual([
      ['permission_granted', 'senior_moderator', 'moderation.ban'],
      ['permission_granted', 'moderator', 'moderation.ban'],
    ]);
    expect(
      (await actions.changeRolePermission({ role: 'admin', action: 'moderation.ban', allowed: false })).ok,
    ).toBe(true);
    as('mod@p1.test');
    expect(permissions.can(await context(), 'moderation.ban')).toBe(false);
    as('admin@p1.test');
    expect(permissions.can(await context(), 'moderation.ban')).toBe(false);
  });

  it('Admin não muda permissões, nem as próprias, e não volta ao padrão', async () => {
    as('admin@p1.test');
    const before = await stored(T1);
    expect(
      await actions.changeRolePermission({ role: 'admin', action: 'billing.buy_credits', allowed: true }),
    ).toEqual({
      ok: false,
      error: 'Só o Dono muda as permissões por cargo.',
    });
    expect((await actions.resetPermissions()).ok).toBe(false);
    expect(await stored(T1)).toEqual(before);
  });

  it('o Dono não se tranca fora e as ações fixas não mudam', async () => {
    as('dono@p1.test');
    for (const input of [
      { role: 'owner', action: 'permissions.manage', allowed: false },
      { role: 'admin', action: 'legal.export', allowed: true },
      { role: 'admin', action: 'members.manage', allowed: false },
      { role: 'volunteer', action: 'cosmos.view', allowed: true },
    ])
      expect((await actions.changeRolePermission(input)).ok).toBe(false);
    const ctx = await context();
    for (const a of ['permissions.manage', 'legal.export', 'members.manage', 'cosmos.manage'] as const)
      expect(permissions.can(ctx, a)).toBe(true);
    // configuração gravada à mão contra o Dono não vale
    await db.sql.query(
      `insert into api.tenant_role_permission (tenant_id, role, action, allowed, updated_by)
       values ($1, 'admin', 'legal.export', true, 'teste')`,
      [T1],
    );
    const { invalidateRoleOverrides } = await import('../src/lib/client/role-permissions');
    invalidateRoleOverrides(T1);
    as('admin@p1.test');
    expect(permissions.can(await context(), 'legal.export')).toBe(false);
  });

  it('a Escada de cargos segue com qualquer configuração: Admin não convida Admin nem Dono', async () => {
    as('admin@p1.test');
    expect((await actions.inviteMember({ email: 'novo@p1.test', name: 'Novo', role: 'admin' })).ok).toBe(
      false,
    );
    expect((await actions.inviteMember({ email: 'novo@p1.test', name: 'Novo', role: 'owner' })).ok).toBe(
      false,
    );
  });

  it('a configuração de um tenant não vale no outro', async () => {
    as('dono@p2.test');
    await context();
    expect(await stored(T2)).toEqual([]);
    expect(await events(T2)).toEqual([]);
  });

  it('voltar ao padrão apaga a configuração e registra cada permissão que mudou', async () => {
    as('dono@p1.test');
    const before = (await events(T1)).length;
    expect((await actions.resetPermissions()).ok).toBe(true);
    expect(await stored(T1)).toEqual([]);
    const reset = (await events(T1)).slice(before);
    expect(reset.length).toBeGreaterThan(0);
    expect(reset).toContainEqual(
      expect.objectContaining({ action: 'permission_revoked', to_role: 'admin', subject: 'cosmos.manage' }),
    );
    as('admin@p1.test');
    const ctx = await context();
    expect(ctx.actor).toEqual({ kind: 'member', tenantId: T1, role: 'admin', scope: null });
    expect(permissions.can(ctx, 'cosmos.manage')).toBe(false);
    expect(permissions.can(ctx, 'moderation.ban')).toBe(true);
  });
});
