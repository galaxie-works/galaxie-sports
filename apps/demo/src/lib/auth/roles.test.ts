import { describe, expect, it } from 'vitest';

import {
  accessPathname,
  canAccessAdmin,
  canAccessClientPanel,
  isRole,
  needsTenant,
  roleOf,
  routeAccess,
} from './roles';

describe('papéis da demo', () => {
  it('reconhece só admin, support, user e client', () => {
    expect(isRole('client')).toBe(true);
    expect(isRole('support')).toBe(true);
    expect(isRole('superadmin')).toBe(false);
    // a equipe Galaxie abre Ajustes e o painel de qualquer tenant
    expect(canAccessAdmin('support')).toBe(true);
    expect(canAccessClientPanel('support')).toBe(true);
    expect(routeAccess('/settings/users', 'support')).toBe('allow');
    expect(roleOf('client')).toBe('client');
    expect(roleOf(null)).toBe('user');
    expect(roleOf('admin,user')).toBe('user');
  });

  it('só o cliente fica ligado a um tenant', () => {
    expect(needsTenant('client')).toBe(true);
    expect(needsTenant('admin')).toBe(false);
    expect(needsTenant('user')).toBe(false);
  });

  it('cliente não abre Ajustes (páginas nem API)', () => {
    expect(canAccessAdmin('client')).toBe(false);
    for (const path of [
      '/settings',
      '/settings/users',
      '/settings/users/1',
      '/settings/lineups',
      '/settings/webhooks',
      '/api/settings/operations',
    ])
      expect(routeAccess(path, 'client')).toBe('deny');
  });

  it('painel do cliente: cliente e admin entram; convidado não', () => {
    for (const path of [
      '/client',
      '/client/keys',
      '/client/builder/new',
      '/client/lineup',
      '/client/channels',
      '/client/webhooks',
      '/api/client/x',
    ]) {
      expect(routeAccess(path, 'client')).toBe('allow');
      expect(routeAccess(path, 'admin')).toBe('allow');
      expect(routeAccess(path, 'user')).toBe('deny');
      expect(routeAccess(path, undefined)).toBe('deny');
    }
    expect(canAccessClientPanel('user')).toBe(false);
  });

  it('o resto da demo continua aberto para o cliente', () => {
    for (const path of ['/', '/teams/1', '/docs', '/live', '/api/galaxie/v1/search', '/clientes'])
      expect(routeAccess(path, 'client')).toBe('allow');
  });

  it('admin abre tudo', () => {
    expect(routeAccess('/settings/operations', 'admin')).toBe('allow');
    expect(routeAccess('/api/settings/review', 'admin')).toBe('allow');
  });

  it('decide pelo caminho normalizado: idioma, codificação e pontos não furam a barreira', () => {
    for (const path of [
      '/pt-BR/settings/users',
      '/es-AR/settings',
      '/pt-br/settings',
      '/en/pt-BR/settings',
      '/%73ettings/users',
      '/%2573ettings',
      '/api/%73ettings/operations',
      '/teams/../settings',
      '/teams/%2e%2e/settings',
      '//settings',
      '/.\\settings',
      '/pt-BR/client/keys',
      // segmento que não decodifica no fim não esconde o começo
      '/%73ettings/%E0',
      '/settings/%E0%A4%A',
    ]) {
      expect(routeAccess(path, 'user'), path).toBe('deny');
    }
    expect(routeAccess('/pt-BR/client', 'client')).toBe('allow');
    expect(routeAccess('/en/settings', 'admin')).toBe('allow');
    // caminho comum com codificação inválida: nega (Next também não abre)
    expect(routeAccess('/teams/%E0', 'admin')).toBe('deny');
  });

  it('accessPathname mantém os caminhos comuns', () => {
    expect(accessPathname('/')).toBe('/');
    expect(accessPathname('/teams/1')).toBe('/teams/1');
    expect(accessPathname('/api/galaxie/v1/search')).toBe('/api/galaxie/v1/search');
    expect(accessPathname('/pt-BR')).toBe('/');
    expect(accessPathname('/login/..%2Fsettings')).toBe('/settings');
    expect(accessPathname('/%73ettings%2Fusers')).toBe('/settings/users');
    expect(accessPathname('/%E0%A4%A')).toBeNull();
  });
});
