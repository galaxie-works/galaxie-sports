import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Token do torcedor pela sessão (#1369): quem está logado, com perfil, e o token guardado até perto de vencer. */

const getSession = vi.fn();
const issue = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
  isAccessExpired: (u: { expired?: boolean }) => u.expired === true,
}));
vi.mock('./token', () => ({
  issueDemoFanToken: (...a: unknown[]) => issue(...a),
}));

const { sessionFanAuthorization, clearSessionFanTokens } = await import('./session-token');

const user = (over: Record<string, unknown> = {}) => ({
  user: {
    id: 'u1',
    locale: 'pt-BR',
    fanNickname: 'Torcedor10',
    fanAgeBand: '18plus',
    fanCountry: 'BR',
    ...over,
  },
});
const req = () => new Request('http://demo.test/api/galaxie/v1/fans/me');
const HOUR = 3_600_000;

beforeEach(() => {
  clearSessionFanTokens();
  getSession.mockReset();
  issue.mockReset();
  issue.mockImplementation(async () => ({
    token: `gft_${issue.mock.calls.length}`,
    expiresAt: new Date(1_000_000 + HOUR).toISOString(),
  }));
});

describe('token do torcedor pela sessão (#1369)', () => {
  it('sem sessão, sessão vencida ou sem perfil de torcedor: 401, sem pedir token', async () => {
    getSession.mockResolvedValueOnce(null);
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 401 });
    getSession.mockResolvedValueOnce(user({ expired: true }));
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 401 });
    getSession.mockResolvedValueOnce(user({ fanNickname: null }));
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 401 });
    expect(issue).not.toHaveBeenCalled();
  });

  it('guarda o token da pessoa e renova perto de vencer ou quando o perfil muda', async () => {
    getSession.mockResolvedValue(user());
    const now = 1_000_000;
    expect(await sessionFanAuthorization(req(), () => now)).toEqual({
      ok: true,
      authorization: 'Bearer gft_1',
    });
    expect(await sessionFanAuthorization(req(), () => now + 1000)).toEqual({
      ok: true,
      authorization: 'Bearer gft_1',
    });
    expect(issue).toHaveBeenCalledTimes(1);
    // a 30 s de vencer: sai outro
    expect((await sessionFanAuthorization(req(), () => now + HOUR - 30_000)).ok).toBe(true);
    expect(issue).toHaveBeenCalledTimes(2);
    // trocou o apelido: outro token, com o perfil novo
    getSession.mockResolvedValue(user({ fanNickname: 'OutroNome' }));
    await sessionFanAuthorization(req(), () => now);
    expect(issue).toHaveBeenCalledTimes(3);
  });

  it('cada pessoa tem o seu token', async () => {
    getSession.mockResolvedValueOnce(user()).mockResolvedValueOnce(user({ id: 'u2' }));
    const a = await sessionFanAuthorization(req(), () => 1_000_000);
    const b = await sessionFanAuthorization(req(), () => 1_000_000);
    expect(a).not.toEqual(b);
    expect(issue.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
  });

  it('a API recusou o perfil: 401; fora do ar: 503 ou 502', async () => {
    getSession.mockResolvedValue(user());
    issue.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 400 }));
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 401 });
    issue.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }));
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 503 });
    issue.mockRejectedValueOnce(new Error('rede'));
    expect(await sessionFanAuthorization(req())).toEqual({ ok: false, status: 502 });
  });
});
