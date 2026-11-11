import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Token do torcedor da demo (#1020): mesma origem, sessão e perfil; a chave da demo nunca sai do servidor. */

const session = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => session(...a) } },
  isAccessExpired: () => false,
}));

const upstream = vi.fn(async (_url: string, init?: RequestInit) =>
  Response.json(
    {
      data: {
        token: 'gft_abc.def',
        expires_at: '2026-11-11T22:00:00.000Z',
        expires_in: 900,
        profile_id: 'p',
      },
    },
    { status: init?.method === 'POST' ? 201 : 405 },
  ),
);

let route: typeof import('./route');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GALAXIE_API_URL', 'http://api.test');
  vi.stubEnv('GALAXIE_DEMO_KEY', 'gs_demo_chave');
  vi.stubGlobal('fetch', upstream);
  upstream.mockClear();
  session.mockReset();
  route = await import('./route');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const post = (headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
  route.POST(new Request('http://demo.test/api/torcedor/token', { method: 'POST', headers }));
const user = (over: Record<string, unknown> = {}) => ({
  user: {
    id: 'u_1',
    name: 'Nome Real',
    email: 'pessoa@exemplo.test',
    locale: 'pt-BR',
    fanNickname: 'Tricolor_77',
    fanAgeBand: '18plus',
    fanCountry: 'BR',
    ...over,
  },
});

describe('POST /api/torcedor/token', () => {
  it('emite o token com a chave da demo, sem nome nem e-mail do login, e sem cache', async () => {
    session.mockResolvedValue(user());
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ token: 'gft_abc.def', expires_at: '2026-11-11T22:00:00.000Z' });
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/fans/tokens');
    expect(new Headers(init?.headers).get('x-galaxie-key')).toBe('gs_demo_chave');
    const sent = String(init?.body);
    expect(sent).not.toContain('Nome Real');
    expect(sent).not.toContain('pessoa@exemplo.test');
    expect(JSON.parse(sent)).toMatchObject({ externalProfileId: 'demo:u_1', nickname: 'Tricolor_77' });
  });

  it('outra página (CSRF) → 403; sem sessão → 401; sem perfil de torcedor → 409', async () => {
    session.mockResolvedValue(user());
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ origin: 'https://outro.test' })).status).toBe(403);
    session.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    session.mockResolvedValue(user({ fanAgeBand: null }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'fan_profile_missing' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('apelido que a moderação recusa: 409 para a pessoa trocar no perfil', async () => {
    session.mockResolvedValue(user());
    upstream.mockResolvedValueOnce(
      Response.json({ code: 'INVALID_PARAMS', errors: [{ path: 'nickname' }] }, { status: 400 }),
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'fan_nickname_rejected' });
  });

  it('outro 400 da API não vira apelido recusado: registra e devolve 502', async () => {
    session.mockResolvedValue(user());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    upstream.mockResolvedValueOnce(
      Response.json({ code: 'INVALID_PARAMS', errors: [{ path: 'country' }] }, { status: 400 }),
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'unavailable' });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
