import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONSOLE_PATH_REGEXP, ROLE_ROUTES, appRole, routeOwner, serviceName, servesPath } from './app-role';

const APP = join(__dirname, '..', 'app');
const COMPOSE = join(__dirname, '..', '..', '..', '..', 'infra', 'vps-telemetry', 'compose.yml');

describe('dono de cada rota', () => {
  it.each([
    '/cliente',
    '/cliente/builder',
    '/cliente/builder/novo',
    '/cliente/chaves',
    '/ajustes',
    '/ajustes/operacao',
    '/api/ajustes/operacao',
    '/api/ajustes/revisao/lote',
    '/api/cliente/x',
    // como o proxy enxerga: sem o prefixo de idioma e decodificado
    '/pt-BR/ajustes',
    '/en/cliente/builder',
    '/%61justes',
    '/times/../ajustes',
  ])('%s é do console', (path) => expect(routeOwner(path)).toBe('console'));

  it.each([
    '/',
    '/sobre',
    '/termos',
    '/privacidade',
    '/sitemap.xml',
    '/exemplo/jogo',
    '/docs',
    '/docs/referencia',
    '/embed.js',
    '/e/01a16029-9283-77d0-b2e5-1d89336b2dbc.json',
    '/r/01a16029-9283-77d0-b2e5-1d89336b2dbc.json',
    '/times/1',
    '/eventos/abc',
    '/esportes/futebol',
    '/api/related/playback-error',
    '/api/interno/revalidar',
    // sem entrada: o explorador cresce sem mexer na tabela
    '/pagina-nova',
    // prefixo de verdade, não pedaço do nome
    '/clientes',
    '/ajustes-antigos',
  ])('%s é do site', (path) => expect(routeOwner(path)).toBe('site'));

  it.each([
    '/login',
    '/login/x',
    '/api/auth/get-session',
    '/api/auth/sign-in/email-otp',
    '/api/version',
    '/api/galaxie/v1/search',
    '/api/atividade',
    '/robots.txt',
    '/icon.png',
    '/_next/data/x.json',
    '/definir-senha',
  ])('%s abre nos dois', (path) => expect(routeOwner(path)).toBe('comum'));

  it('caminho que não decodifica não tem dono', () => expect(routeOwner('/%E0%A4%A')).toBeNull());
});

describe('o que cada papel atende', () => {
  it('site: público e demo, sem o portal e o painel', () => {
    expect(servesPath('site', '/')).toBe(true);
    expect(servesPath('site', '/times/1')).toBe(true);
    expect(servesPath('site', '/login')).toBe(true);
    expect(servesPath('site', '/ajustes')).toBe(false);
    expect(servesPath('site', '/cliente/builder')).toBe(false);
    expect(servesPath('site', '/api/ajustes/operacao')).toBe(false);
  });

  it('console: portal e painel, sem o público e a demo', () => {
    expect(servesPath('console', '/cliente')).toBe(true);
    expect(servesPath('console', '/ajustes/usuarios/1')).toBe(true);
    expect(servesPath('console', '/login')).toBe(true);
    expect(servesPath('console', '/api/galaxie/v1/search')).toBe(true);
    expect(servesPath('console', '/')).toBe(false);
    expect(servesPath('console', '/sobre')).toBe(false);
    expect(servesPath('console', '/times/1')).toBe(false);
    expect(servesPath('console', '/r/x.json')).toBe(false);
    expect(servesPath('console', '/api/interno/revalidar')).toBe(false);
  });

  it('all atende tudo, inclusive o que não decodifica (fica para a regra geral do proxy)', () => {
    for (const path of ['/', '/ajustes', '/cliente/builder', '/times/1', '/%E0%A4%A'])
      expect(servesPath('all', path)).toBe(true);
  });

  it('num papel só, caminho que não decodifica é 404', () => {
    expect(servesPath('site', '/%E0%A4%A')).toBe(false);
    expect(servesPath('console', '/%E0%A4%A')).toBe(false);
  });
});

describe('APP_ROLE', () => {
  it.each([
    [undefined, 'all'],
    ['', 'all'],
    ['site', 'site'],
    [' console ', 'console'],
    ['all', 'all'],
    ['cosole', 'all'],
  ])('%j → %s', (value, role) => expect(appRole({ APP_ROLE: value })).toBe(role));

  it('nome do serviço', () => {
    expect(serviceName('site')).toBe('site');
    expect(serviceName('console')).toBe('console');
    expect(serviceName('all')).toBe('demo');
  });
});

describe('tabela completa', () => {
  const dirs = (path: string) =>
    readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

  /** Primeiro segmento de cada rota que o app tem, a partir das pastas e arquivos de `app/`. */
  function appRoutes(): string[] {
    const root = readdirSync(APP).flatMap((name) => {
      if (['[locale]', 'api', 'globals.css', 'providers.tsx'].includes(name)) return [];
      if (name === 'robots.ts') return ['/robots.txt'];
      if (name === 'sitemap.ts') return ['/sitemap.xml'];
      return [`/${name}`];
    });
    const pages = [
      ...dirs(join(APP, '[locale]')).filter((d) => d !== '(app)'),
      ...dirs(join(APP, '[locale]', '(app)')),
    ].map((d) => `/${d}`);
    const api = dirs(join(APP, 'api')).map((d) => `/api/${d}`);
    return [...root, ...pages, ...api];
  }

  it('cada pasta de app/ tem a sua entrada (rota nova obriga a escolher o papel)', () => {
    const listed = new Set(ROLE_ROUTES.map((r) => r.path));
    const routes = appRoutes();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((r) => !listed.has(r))).toEqual([]);
  });

  it('nenhum caminho aparece duas vezes', () => {
    const paths = ROLE_ROUTES.map((r) => r.path);
    expect(paths.length).toBe(new Set(paths).size);
  });
});

describe('Traefik', () => {
  it('a expressão do console casa os mesmos prefixos que o proxy', () => {
    const re = new RegExp(CONSOLE_PATH_REGEXP);
    for (const path of [
      '/cliente',
      '/cliente/builder',
      '/ajustes/x',
      '/api/ajustes/operacao',
      '/api/cliente',
    ])
      expect(re.test(path)).toBe(true);
    for (const path of ['/', '/clientes', '/ajustes-antigos', '/times/1', '/api/auth/x', '/login'])
      expect(re.test(path)).toBe(false);
  });

  it('o compose.yml roteia para o console pela mesma expressão (com o $ escapado do compose)', () => {
    const compose = readFileSync(COMPOSE, 'utf8');
    const rule = `PathRegexp(\`${CONSOLE_PATH_REGEXP.replace(/\$/g, '$$$$')}\`)`;
    for (const router of ['gsports-console', 'gsports-console-maintenance']) {
      const line = compose.split('\n').find((l) => l.includes(`traefik.http.routers.${router}.rule=`));
      expect(line, router).toBeDefined();
      expect(line).toContain(rule);
    }
  });
});
