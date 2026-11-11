import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Usuários e cargos do tenant (#1019) com logins de verdade: o cargo vem do banco a cada ação, e id de membro,
 * cargo ou tenant forjados não passam do can().
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
let admin: typeof import('../src/app/[locale]/(app)/ajustes/actions');
let session: typeof import('../src/lib/client/session');
const T1 = randomUUID();
const T2 = randomUUID();
const cookies: Record<string, string> = {};

const as = (who: string) => {
  request.cookie = cookies[who]!;
};
const memberId = async (tenant: string, email: string) =>
  (
    await db.sql.query<{ id: string }>(
      `select m.id::text from api.tenant_member m join "user" u on u.id = m.user_id
        where m.tenant_id = $1 and u.email = $2`,
      [tenant, email],
    )
  ).rows[0]?.id;
const context = async () => {
  session ??= await import('../src/lib/client/session');
  return session.readClientContext();
};

beforeAll(async () => {
  db = await createAuthTestDb();
  const { runMigrations } = await import('@galaxie/db');
  await runMigrations(process.env.DEMO_DATABASE_URL!);
  for (const [id, slug] of [
    [T1, 'cliente-um'],
    [T2, 'cliente-dois'],
  ])
    await db.sql.query(
      `insert into api.tenant (id, slug, name, plan, modules) values ($1, $2, $2, 'core_data', '{core_data}')`,
      [id, slug],
    );
  for (const email of ['dono@um.test', 'mod@um.test', 'dono@dois.test', 'troca@um.test', 'retenta@um.test'])
    cookies[email] = await signInAs(email, 'client');
  cookies['admin@galaxie.test'] = await signInAs('admin@galaxie.test', 'admin');
  // clientes de antes dos cargos: só o tenant gravado no usuário
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'dono@um.test'`, [T1]);
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'dono@dois.test'`, [T2]);
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'troca@um.test'`, [T1]);
  await db.sql.query(`update "user" set tenant_id = $1 where email = 'retenta@um.test'`, [T1]);
  actions = await import('../src/app/[locale]/(app)/cliente/usuarios/actions');
  admin = await import('../src/app/[locale]/(app)/ajustes/actions');
}, 120_000);

const userId = async (email: string) =>
  (await db.sql.query<{ id: string }>(`select id from "user" where email = $1`, [email])).rows[0]!.id;

afterAll(async () => {
  await db?.drop();
});

describe('usuários e cargos (#1019)', () => {
  it('o cliente de antes dos cargos vira Dono do tenant dele, com registro na auditoria', async () => {
    as('dono@um.test');
    const ctx = await context();
    expect(ctx).toMatchObject({ role: 'client', memberRole: 'owner', tenant: { id: T1 } });
    expect(ctx?.actor).toEqual({ kind: 'member', tenantId: T1, role: 'owner', scope: null });
    const { rows } = await db.sql.query(
      `select action, actor, to_role from api.tenant_member_event where tenant_id = $1`,
      [T1],
    );
    expect(rows).toEqual([{ action: 'invited', actor: 'legacy', to_role: 'owner' }]);
  });

  it('o Dono convida; a pessoa entra com o cargo e o aceite fica na auditoria', async () => {
    as('dono@um.test');
    const res = await actions.inviteMember({ email: 'mod@um.test', name: 'Mod', role: 'moderator' });
    expect(res.ok).toBe(true);
    as('mod@um.test');
    const ctx = await context();
    expect(ctx).toMatchObject({ memberRole: 'moderator', tenant: { id: T1 } });
    const { rows } = await db.sql.query<{ action: string }>(
      `select action from api.tenant_member_event where tenant_id = $1 order by id`,
      [T1],
    );
    expect(rows.map((r) => r.action)).toEqual(['invited', 'invited', 'accepted']);
  });

  it('Moderador não convida, não troca nem tira cargo, mesmo forjando o pedido', async () => {
    as('mod@um.test');
    await context();
    const owner = await memberId(T1, 'dono@um.test');
    expect((await actions.inviteMember({ email: 'x@um.test', name: 'X', role: 'owner' })).ok).toBe(false);
    expect((await actions.changeMemberRole({ memberId: owner!, role: 'volunteer' })).ok).toBe(false);
    expect((await actions.removeMember({ memberId: owner! })).ok).toBe(false);
    expect(await memberId(T1, 'dono@um.test')).toBe(owner);
  });

  it('o último Dono não sai nem deixa de ser Dono', async () => {
    as('dono@um.test');
    const owner = await memberId(T1, 'dono@um.test');
    const removed = await actions.removeMember({ memberId: owner! });
    expect(removed).toMatchObject({ ok: false, error: 'O tenant precisa ter pelo menos um Dono.' });
    const demoted = await actions.changeMemberRole({ memberId: owner!, role: 'admin' });
    expect(demoted.ok).toBe(false);
  });

  it('Admin não se promove a Dono nem mexe em quem está acima', async () => {
    as('dono@um.test');
    const mod = await memberId(T1, 'mod@um.test');
    expect((await actions.changeMemberRole({ memberId: mod!, role: 'admin' })).ok).toBe(true);
    as('mod@um.test');
    expect((await actions.changeMemberRole({ memberId: mod!, role: 'owner' })).ok).toBe(false);
    const owner = await memberId(T1, 'dono@um.test');
    expect((await actions.removeMember({ memberId: owner! })).ok).toBe(false);
    const { rows } = await db.sql.query(
      `select from_role, to_role from api.tenant_member_event where tenant_id = $1 and action = 'role_changed'`,
      [T1],
    );
    expect(rows).toEqual([{ from_role: 'moderator', to_role: 'admin' }]);
  });

  it('id de membro de outro tenant não serve', async () => {
    as('dono@dois.test');
    await context();
    const other = await memberId(T1, 'mod@um.test');
    expect(await actions.removeMember({ memberId: other! })).toMatchObject({ ok: false });
    expect(await memberId(T1, 'mod@um.test')).toBe(other);
  });

  it('a mesma pessoa pode ter cargo em dois tenants', async () => {
    as('dono@dois.test');
    expect((await actions.inviteMember({ email: 'mod@um.test', name: 'Mod', role: 'moderator' })).ok).toBe(
      true,
    );
    as('mod@um.test');
    const ctx = await context();
    expect(ctx?.tenants.map((t) => t.id).sort()).toEqual([T1, T2].sort());
  });

  it('tirar o acesso apaga o tenant gravado no usuário: a pessoa não volta como Dono', async () => {
    as('dono@dois.test');
    expect((await actions.inviteMember({ email: 'dono@um.test', name: 'Dono', role: 'owner' })).ok).toBe(
      true,
    );
    // dono@um.test agora é Dono de T2 também; o primeiro tenant em ordem de nome é o cliente-dois (T2)
    as('dono@um.test');
    expect(await context()).toMatchObject({ tenant: { id: T2 }, memberRole: 'owner' });
    const original = await memberId(T2, 'dono@dois.test');
    expect((await actions.removeMember({ memberId: original! })).ok).toBe(true);
    const { rows } = await db.sql.query(`select tenant_id from "user" where email = 'dono@dois.test'`);
    expect(rows).toEqual([{ tenant_id: null }]);
    as('dono@dois.test');
    expect(await context()).toMatchObject({ tenant: null, memberRole: null, actor: null });
  });

  it('cliente trocado de tenant pela Galaxie perde o cargo no tenant anterior', async () => {
    as('troca@um.test');
    expect(await context()).toMatchObject({ tenant: { id: T1 }, memberRole: 'owner' });
    as('admin@galaxie.test');
    const id = await userId('troca@um.test');
    const moved = await admin.updateAccess(id, { role: 'client', accessExpiresAt: null, tenantId: T2 });
    expect(moved.ok).toBe(true);
    as('troca@um.test');
    const ctx = await context();
    expect(ctx?.tenants.map((t) => t.id)).toEqual([T2]);
    expect(await memberId(T1, 'troca@um.test')).toBeUndefined();
    const { rows } = await db.sql.query(
      `select action, actor from api.tenant_member_event
        where tenant_id = $1 and action = 'removed' and subject = 'troca@um.test'`,
      [T1],
    );
    expect(rows).toEqual([{ action: 'removed', actor: expect.stringMatching(/^galaxie:/) }]);
  });

  it('troca de tenant que falha ao tirar o cargo não muda o tenant, e repetir conserta', async () => {
    as('retenta@um.test');
    expect(await context()).toMatchObject({ tenant: { id: T1 }, memberRole: 'owner' });
    as('admin@galaxie.test');
    const id = await userId('retenta@um.test');
    const input = { role: 'client' as const, accessExpiresAt: null, tenantId: T2 };
    // a remoção do cargo falha (banco fora do ar no meio da ação, por exemplo)
    await db.sql.query(`create function api.falha_remocao() returns trigger language plpgsql as $$
      begin raise exception 'falha simulada'; end $$`);
    await db.sql.query(`create trigger falha_remocao before delete on api.tenant_member
      for each row execute function api.falha_remocao()`);
    try {
      expect((await admin.updateAccess(id, input)).ok).toBe(false);
    } finally {
      await db.sql.query('drop trigger falha_remocao on api.tenant_member');
      await db.sql.query('drop function api.falha_remocao()');
    }
    // nada mudou: o tenant gravado continua o anterior, então a próxima tentativa ainda sabe de onde tirar o cargo
    const tenantOf = async () =>
      (await db.sql.query(`select tenant_id from "user" where id = $1`, [id])).rows[0]?.tenant_id;
    expect(await tenantOf()).toBe(T1);
    expect(await memberId(T1, 'retenta@um.test')).toBeDefined();

    expect((await admin.updateAccess(id, input)).ok).toBe(true);
    expect(await tenantOf()).toBe(T2);
    expect(await memberId(T1, 'retenta@um.test')).toBeUndefined();
  });

  it('pessoa apagada do console sai dos cargos e não conta como Dono', async () => {
    as('dono@um.test');
    await context();
    expect(
      (await actions.inviteMember({ email: 'apagado@um.test', name: 'Apagado', role: 'owner' })).ok,
    ).toBe(true);
    as('admin@galaxie.test');
    const apagado = await userId('apagado@um.test');
    // o convite vai para o tenant ativo do Dono, que pode não ser o T1 depois dos testes de vários tenants
    const { rows: held } = await db.sql.query(`select tenant_id from api.tenant_member where user_id = $1`, [
      apagado,
    ]);
    expect(held).toHaveLength(1);
    expect((await admin.removeUser(apagado)).ok).toBe(true);
    const { rows } = await db.sql.query(
      `select count(*)::int as n from api.tenant_member m where not exists (select 1 from "user" u where u.id = m.user_id)
         and m.user_id is not null`,
    );
    expect(rows).toEqual([{ n: 0 }]);
    // a auditoria guarda quem saiu: o cargo sai antes de o usuário ser apagado
    const { rows: events } = await db.sql.query(
      `select subject from api.tenant_member_event
        where tenant_id = $1 and action = 'removed' and actor like 'galaxie:%'`,
      [held[0].tenant_id],
    );
    expect(events).toContainEqual({ subject: 'apagado@um.test' });
    expect(events).not.toContainEqual({ subject: null });
    // o Dono que sobrou continua sendo o último
    as('dono@um.test');
    await context();
    const owner = await memberId(T1, 'dono@um.test');
    expect((await actions.removeMember({ memberId: owner! })).ok).toBe(false);
  });
});
