import { describe, expect, it } from 'vitest';

import { LANDING_PAGE, isPublicPath } from './public-routes';

describe('rotas públicas', () => {
  it.each([
    '/sobre',
    '/termos',
    '/privacidade',
    '/login',
    '/api/auth/get-session',
    '/robots.txt',
    '/sitemap.xml',
    '/icon.png',
    '/apple-icon.png',
    '/exemplo/jogo',
    '/exemplo/img/abc.png',
  ])('%s abre sem sessão', (path) => expect(isPublicPath(path)).toBe(true));

  it.each([
    '/',
    '/times/1',
    '/eventos/abc',
    '/docs',
    '/ajustes',
    '/api/ajustes/operacao',
    '/api/galaxie/v1/teams',
    '/sobre/x',
    '/termos-de-uso',
    '/privacidade.json',
    '/loginx',
    '/exemplo',
    '/exemplo/x',
    '/exemplo/jogo/1',
  ])('%s exige login', (path) => expect(isPublicPath(path)).toBe(false));

  it('a raiz sem sessão mostra uma página pública', () => {
    expect(isPublicPath(LANDING_PAGE)).toBe(true);
  });
});
