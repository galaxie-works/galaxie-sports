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
    for (const path of ['/settings', '/client/builder', '/pt-BR/settings/operations']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
    const api = await get('/api/settings/operations');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ title: 'Não encontrado' });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('console responde 404 ao público e à demo', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    for (const path of [
      '/',
      '/about',
      '/teams/1',
      '/docs',
      '/embed.js',
      '/r/x.json',
      '/api/internal/revalidate',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('cada um segue com o que é dele e com o que é dos dois', async () => {
    vi.stubEnv('APP_ROLE', 'site');
    expect((await get('/teams/1')).status).toBe(200);
    expect((await get('/login')).status).toBe(200);
    vi.stubEnv('APP_ROLE', 'console');
    expect((await get('/settings')).status).toBe(200);
    expect((await get('/client/builder')).status).toBe(200);
    expect((await get('/login')).status).toBe(200);
    expect((await get('/api/version')).status).toBe(200);
  });

  it('a sessão continua valendo no console (mesmo cookie, mesmo banco)', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    getSession.mockResolvedValue(null);
    const res = await get('/client');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://demo.test/login?next=%2Fclient');
  });

  it('sem APP_ROLE atende tudo, como antes', async () => {
    for (const path of ['/', '/teams/1', '/settings', '/client/builder'])
      expect((await get(path)).status, path).toBe(200);
  });

  it('404 em espanhol para quem navega em espanhol', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    const res = await proxy(
      new NextRequest(new URL('http://demo.test/about'), { headers: { 'accept-language': 'es-AR' } }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No encontrado');
  });
});

describe('links antigos de Ajustes (#1069)', () => {
  beforeEach(() => getSession.mockResolvedValue(admin));
  afterEach(() => getSession.mockReset());

  it.each([
    ['/ajustes/operacao', '/settings/status'],
    ['/ajustes/sistema?aba=history', '/settings/history'],
    ['/ajustes/sistema?tab=ai', '/settings/ai'],
    ['/ajustes/esportes?aba=related&q=espn', '/settings/videos?q=espn'],
    ['/ajustes/esportes?aba=related&filtro=blocked', '/settings/videos?filter=blocked'],
    ['/ajustes/esportes?aba=sports', '/settings/provider#sports'],
  ])('%s responde 301 para %s', async (from, to) => {
    const res = await get(from);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`http://demo.test${to}`);
  });

  it('as rotas novas seguem sem redirecionar', async () => {
    for (const path of [
      '/settings',
      '/settings/status',
      '/settings/videos',
      '/settings/lineups?tab=requests',
    ]) {
      expect((await get(path)).status, path).toBe(200);
    }
  });
});

describe('rotas em português de antes do #630', () => {
  beforeEach(() => getSession.mockResolvedValue(null));
  afterEach(() => {
    vi.unstubAllEnvs();
    getSession.mockReset();
  });

  it.each([
    ['/times/1?temporada=2025', '/teams/1?season=2025'],
    ['/pt-BR/eventos/abc', '/pt-BR/events/abc'],
    ['/en/hipismo/atletas/9', '/en/equestrian/athletes/9'],
    ['/es-AR/ajustes/usuarios/1', '/es-AR/settings/users/1'],
    ['/sobre', '/about'],
    ['/exemplo/jogo?detalhes=escalacao&escalacao=campo', '/example/match?details=lineups&lineup=pitch'],
    [
      '/cliente/builder/novo?tipo=standings&esporte=basquete',
      '/client/builder/new?type=standings&sport=basketball',
    ],
    ['/api/feedback/anexo/2026-11/x.png?e=1&s=a', '/api/feedback/attachment/2026-11/x.png?e=1&s=a'],
    // slug da família e query num salto só
    ['/pt-BR/esportes/futebol?aba=jogos', '/pt-BR/sports/football?tab=matches'],
    ['/esportes/futebol-americano', '/sports/american-football'],
    ['/sports/basquete', '/sports/basketball'],
    ['/en/sports/automobilismo?temporada=2024', '/en/sports/motorsport?season=2024'],
    // só a query em português, no caminho novo
    [
      '/competitions/brasileirao?aba=jogos&temporada=2025&rodada=Rodada+3',
      '/competitions/brasileirao?tab=matches&season=2025&round=Rodada+3',
    ],
    ['/live?status=ao-vivo%2Cproximos&esporte=football', '/live?status=live%2Cupcoming&sport=football'],
    ['/schedule?pais=br&dia=2026-11-20', '/schedule?country=br&day=2026-11-20'],
    ['/login?voltar=%2Fteams%2F1&motivo=expirado', '/login?next=%2Fteams%2F1&reason=expired'],
  ])('%s responde 301 para %s, sem olhar a sessão', async (from, to) => {
    const res = await get(from);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`http://demo.test${to}`);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('em qualquer papel: o caminho antigo pode ser do outro serviço', async () => {
    vi.stubEnv('APP_ROLE', 'console');
    expect((await get('/times/1')).status).toBe(301);
    vi.stubEnv('APP_ROLE', 'site');
    expect((await get('/cliente')).status).toBe(301);
  });

  it('POST antigo repete o método (308)', async () => {
    const res = await proxy(
      new NextRequest(new URL('/api/ajustes/revisao/lote', 'http://demo.test'), { method: 'POST' }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('http://demo.test/api/settings/review/batch');
  });

  it('a query das rotas de API não se traduz (o proxy da API repassa os parâmetros como vieram)', async () => {
    getSession.mockResolvedValue(admin);
    expect((await get('/api/galaxie/v1/teams?tipo=x&data=1')).status).toBe(200);
  });

  it.each([
    ['/pt-BR/esportes/nba', '/pt-BR/sports/basketball#nba'],
    ['/en/esportes/formula-1', '/en/sports/motorsport'],
    ['/es-AR/sports/nba', '/es-AR/sports/basketball#nba'],
    ['/esportes/nba?temporada=2025&aba=jogos', '/sports/basketball?season=2025&tab=matches#nba'],
  ])('esporte da API (%s) chega à família num salto só', async (from, to) => {
    const res = await get(from);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`http://demo.test${to}`);
  });
});
