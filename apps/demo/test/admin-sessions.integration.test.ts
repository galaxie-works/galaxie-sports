import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Sessões no painel de usuários (Ajustes → Usuários → Sessões) com logins de verdade: o token de cada
 * sessão (que vale como a própria sessão) não sai do servidor; encerrar vai pelo id.
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
let admin: typeof import('../src/lib/auth/admin');
let actions: typeof import('../src/app/[locale]/(app)/ajustes/actions');
const idOf = async (email: string) =>
  (await db.sql.query<{ id: string }>('select id from "user" where email = $1', [email])).rows[0]!.id;

beforeAll(async () => {
  db = await createAuthTestDb();
  admin = await import('../src/lib/auth/admin');
  actions = await import('../src/app/[locale]/(app)/ajustes/actions');
  await signInAs('convidado@galaxie.test');
  await signInAs('outra@galaxie.test');
  request.cookie = await signInAs('admin@galaxie.test', 'admin');
});

afterAll(async () => {
  await db?.drop();
});

describe('sessões no painel do admin', () => {
  it('o detalhe do usuário não leva o token das sessões', async () => {
    const detail = await admin.getDemoUser(await idOf('convidado@galaxie.test'));
    expect(detail?.sessions).toHaveLength(1);
    const tokens = (await db.sql.query<{ token: string }>('select token from session')).rows.map(
      (r) => r.token,
    );
    const payload = JSON.stringify(detail);
    for (const token of tokens) expect(payload).not.toContain(token);
  });

  it('encerra pelo id, só entre as sessões daquele usuário', async () => {
    const guest = await idOf('convidado@galaxie.test');
    const other = await idOf('outra@galaxie.test');
    const [session] = (await admin.getDemoUser(guest))!.sessions;

    // id de sessão de outra pessoa: nada é encerrado
    expect((await actions.revokeSession(other, session!.id)).ok).toBe(false);
    expect((await admin.getDemoUser(guest))!.sessions).toHaveLength(1);

    expect(await actions.revokeSession(guest, session!.id)).toEqual({ ok: true });
    expect((await admin.getDemoUser(guest))!.sessions).toHaveLength(0);
    expect((await admin.getDemoUser(other))!.sessions).toHaveLength(1);
  });
});
