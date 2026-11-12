import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Perfil de torcedor (#1020): o apelido passa pela moderação (#969) no idioma do token antes de ir para o banco. */

const session = vi.fn();
const query = vi.fn(async () => ({ rowCount: 1 }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...a: unknown[]) => query(...(a as [])) } }));
vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => session(...a) } },
  isAccessExpired: () => false,
}));

import { saveFanProfile } from './actions';

const as = (locale: string) => session.mockResolvedValue({ user: { id: 'u_1', locale } });
const save = (nickname: string) => saveFanProfile({ nickname, ageBand: '18plus', country: 'BR' });

beforeEach(() => {
  session.mockReset();
  query.mockClear();
});

describe('saveFanProfile', () => {
  it('apelido aceito vai para o banco', async () => {
    as('pt-BR');
    expect(await save('Tricolor_77')).toEqual({ ok: true });
    expect(query).toHaveBeenCalledOnce();
  });

  it('apelido que a moderação recusa não vai para o banco', async () => {
    as('pt-BR');
    expect(await save('bet365')).toEqual({ ok: false, error: 'rejected', field: 'nickname' });
    expect(query).not.toHaveBeenCalled();
  });

  it('confere o palavrão no idioma da pessoa, como a API', async () => {
    as('es-AR');
    expect(await save('Otario_10')).toEqual({ ok: true });
    query.mockClear();
    as('pt-BR');
    expect(await save('Otario_10')).toEqual({ ok: false, error: 'rejected', field: 'nickname' });
    expect(query).not.toHaveBeenCalled();
  });
});
