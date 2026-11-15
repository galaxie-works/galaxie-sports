import { describe, expect, it } from 'vitest';

import { LANDING_PAGE, isPublicPath } from './public-routes';

describe('rotas públicas', () => {
  it.each([
    '/about',
    '/terms',
    '/privacy',
    '/login',
    '/api/auth/get-session',
    '/robots.txt',
    '/sitemap.xml',
    '/icon.png',
    '/apple-icon.png',
    '/example/match',
    '/example/img/abc.png',
    '/r/01a16029-9283-77d0-b2e5-1d89336b2dbc.json',
    '/embed.js',
    '/e/01a16029-9283-77d0-b2e5-1d89336b2dbc.json',
    '/api/feedback/attachment/2026-11/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.png',
  ])('%s abre sem sessão', (path) => expect(isPublicPath(path)).toBe(true));

  it.each([
    '/',
    '/teams/1',
    '/events/abc',
    '/docs',
    '/settings',
    '/api/settings/operations',
    '/api/galaxie/v1/teams',
    '/about/x',
    '/termos-de-uso',
    '/privacidade.json',
    '/loginx',
    '/example',
    '/example/x',
    '/example/match/1',
    '/client',
    '/client/builder',
    '/api/client/x',
    '/r',
    '/r/abc',
    '/r/a/b.json',
    '/e',
    '/e/abc',
    '/e/a/b.json',
    '/embed.js/x',
    '/api/feedback',
    '/api/feedback/attachment',
    '/api/feedback/attachment/2026-11/x.png',
    '/api/feedback/attachment/../settings',
  ])('%s exige login', (path) => expect(isPublicPath(path)).toBe(false));

  it('a raiz sem sessão mostra uma página pública', () => {
    expect(isPublicPath(LANDING_PAGE)).toBe(true);
  });
});
