import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
  isAccessExpired: () => false,
}));

const { proxy } = await import('./proxy');

const get = (path: string) => proxy(new NextRequest(new URL(path, 'http://demo.test')));
const admin = { user: { id: 'u1', role: 'admin', email: 'a@galaxie.test' }, session: { id: 's1' } };

describe('proxy por papel (APP_ROLE)', () => {
  beforeEach(() => getSession.mockResolvedValue(admin));
  afterEach(() => {
    vi.unstubAllEnvs();
    getSession.mockReset();
  });

  it('site responde 404 ao portal e ao painel, sem olhar a sessão', async () => {
    vi.stubEnv('APP_ROLE', 'site');
    for (const path of ['/ajustes', '/cliente/builder', '/pt-BR/ajustes/operacao']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
    const api = await get('/api/ajustes/operacao');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ title: 'Não encontrado' });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('console responde 404 ao público e à demo', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    for (const path of [
      '/',
      '/sobre',
      '/times/1',
      '/docs',
      '/embed.js',
      '/r/x.json',
      '/api/interno/revalidar',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('cada um segue com o que é dele e com o que é dos dois', async () => {
    vi.stubEnv('APP_ROLE', 'site');
    expect((await get('/times/1')).status).toBe(200);
    expect((await get('/login')).status).toBe(200);
    vi.stubEnv('APP_ROLE', 'console');
    expect((await get('/ajustes')).status).toBe(200);
    expect((await get('/cliente/builder')).status).toBe(200);
    expect((await get('/login')).status).toBe(200);
    expect((await get('/api/version')).status).toBe(200);
  });

  it('a sessão continua valendo no console (mesmo cookie, mesmo banco)', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    getSession.mockResolvedValue(null);
    const res = await get('/cliente');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://demo.test/login?voltar=%2Fcliente');
  });

  it('sem APP_ROLE atende tudo, como antes', async () => {
    for (const path of ['/', '/times/1', '/ajustes', '/cliente/builder'])
      expect((await get(path)).status, path).toBe(200);
  });

  it('404 em espanhol para quem navega em espanhol', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    const res = await proxy(
      new NextRequest(new URL('http://demo.test/sobre'), { headers: { 'accept-language': 'es-AR' } }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No encontrado');
  });
});
