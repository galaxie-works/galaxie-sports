import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybackReportLimiter } from './limiter';

const getSession = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));
vi.mock('@/lib/galaxie/server', () => ({
  API_URL: 'http://api.test',
  apiHeaders: (extra?: HeadersInit) => new Headers(extra),
}));

const { POST } = await import('./route');

const item = (n: number) => `01a16029-9283-77d0-b2e5-${String(n).padStart(12, '0')}`;
const report = (body: unknown) =>
  POST(
    new Request('http://localhost/api/related/playback-error', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

describe('PlaybackReportLimiter', () => {
  it('um aviso por item e no máximo N por usuário na janela; a janela anda', () => {
    const l = new PlaybackReportLimiter(2, 1_000);
    expect(l.take('u1', 'a', 0)).toBe('ok');
    expect(l.take('u1', 'a', 10)).toBe('duplicate');
    expect(l.take('u1', 'b', 20)).toBe('ok');
    expect(l.take('u1', 'c', 30)).toBe('limited');
    // outro usuário tem o próprio teto
    expect(l.take('u2', 'c', 30)).toBe('ok');
    // passada a janela, volta a aceitar (inclusive o mesmo item)
    expect(l.take('u1', 'c', 1_500)).toBe('ok');
    expect(l.take('u1', 'a', 1_500)).toBe('ok');
  });
});

describe('POST /api/related/playback-error', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    getSession.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sem sessão: 401, nada vai para a API', async () => {
    getSession.mockResolvedValue(null);
    expect((await report({ item_id: item(1), code: 150 })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('corpo inválido: 400', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-bad', role: 'user' } });
    expect((await report({ item_id: 'x', code: 150 })).status).toBe(400);
    expect((await report({ item_id: item(1), code: 5 })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('repassa só item e código, registra quem avisou, ignora o repetido e limita o convidado', async () => {
    getSession.mockResolvedValue({ user: { id: 'guest-1', role: 'user' } });
    expect((await report({ item_id: item(1), code: 150 })).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/related/playback-errors');
    expect(JSON.parse(init.body)).toEqual({ item_id: item(1), code: 150 });
    expect(console.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"user":"guest-1"'),
    );

    // o mesmo item de novo não chega à API
    expect((await report({ item_id: item(1), code: 150 })).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 10; i++) expect((await report({ item_id: item(i), code: 101 })).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect((await report({ item_id: item(11), code: 101 })).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    // outro usuário não herda o teto
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    expect((await report({ item_id: item(11), code: 101 })).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });
});
