import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Rota da aba Atividade (POST /api/atividade) com sessão de verdade: o que o navegador manda vira link no
 * painel do admin, então só entram caminhos da própria demo, e há teto de registros por minuto.
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);

let db: AuthTestDb;
let route: typeof import('../src/app/api/atividade/route');
let cookie: string;
let userId: string;

beforeAll(async () => {
  db = await createAuthTestDb();
  route = await import('../src/app/api/atividade/route');
  cookie = await signInAs('navegante@galaxie.test');
  userId = (
    await db.sql.query<{ id: string }>(`select id from "user" where email = 'navegante@galaxie.test'`)
  ).rows[0]!.id;
});

afterAll(async () => {
  await db?.drop();
});

const post = (body: unknown, headers: Record<string, string> = { cookie }) =>
  route.POST(
    new Request('http://demo.test/api/atividade', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      body: JSON.stringify(body),
    }),
  );

const pages = async () =>
  (
    await db.sql.query<{ path: string; from_path: string | null }>(
      `select path, from_path from activity where user_id = $1 and kind = 'page' order by id`,
      [userId],
    )
  ).rows;

describe('POST /api/atividade', () => {
  it('sem sessão → 401', async () => {
    expect((await post({ path: '/times/1' }, {})).status).toBe(401);
  });

  it('CSRF: outra origem → 403, corpo sem JSON → 415, nada gravado', async () => {
    const before = (await pages()).length;
    expect((await post({ path: '/times/1' }, { cookie, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(
      (
        await post(
          { path: '/times/1' },
          { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        )
      ).status,
    ).toBe(415);
    expect((await pages()).length).toBe(before);
  });

  it('grava caminho interno; recusa o que levaria para outra origem', async () => {
    expect((await post({ path: '/times/1', from: '/competicoes/71', depth: 2 })).status).toBe(204);
    for (const evil of ['//evil.com/x', '/\\evil.com', '/\t/evil.com', '/.//evil.com', 'https://evil.com'])
      expect((await post({ path: evil })).status).toBe(204);
    // origem forjada: a página entra, o "veio de" não
    await post({ path: '/eventos/9', from: '//evil.com/x' });
    // Ajustes não entra (nem disfarçado)
    await post({ path: '/ajustes/usuarios' });
    await post({ path: '/x/../ajustes/usuarios' });
    expect(await pages()).toEqual([
      { path: '/times/1', from_path: '/competicoes/71' },
      { path: '/eventos/9', from_path: null },
    ]);
  });

  it('teto por minuto: o excedente é descartado', async () => {
    await db.sql.query('delete from activity where user_id = $1', [userId]);
    for (let i = 0; i < 70; i++) await post({ path: `/times/${i}` });
    expect((await pages()).length).toBe(60);
  });
});
