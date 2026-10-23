import { describe, expect, it } from 'vitest';

import { canAccessAdmin, canAccessClientPanel, isRole, needsTenant, roleOf, routeAccess } from './roles';

describe('papéis da demo', () => {
  it('reconhece só admin, user e client', () => {
    expect(isRole('client')).toBe(true);
    expect(isRole('superadmin')).toBe(false);
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
    for (const path of ['/ajustes', '/ajustes/usuarios', '/ajustes/usuarios/1', '/api/ajustes/operacao'])
      expect(routeAccess(path, 'client')).toBe('deny');
  });

  it('painel do cliente: cliente e admin entram; convidado não', () => {
    for (const path of ['/cliente', '/cliente/chaves', '/cliente/builder/novo', '/api/cliente/x']) {
      expect(routeAccess(path, 'client')).toBe('allow');
      expect(routeAccess(path, 'admin')).toBe('allow');
      expect(routeAccess(path, 'user')).toBe('deny');
      expect(routeAccess(path, undefined)).toBe('deny');
    }
    expect(canAccessClientPanel('user')).toBe(false);
  });

  it('o resto da demo continua aberto para o cliente', () => {
    for (const path of ['/', '/times/1', '/docs', '/ao-vivo', '/api/galaxie/v1/search', '/clientes'])
      expect(routeAccess(path, 'client')).toBe('allow');
  });

  it('admin abre tudo', () => {
    expect(routeAccess('/ajustes/operacao', 'admin')).toBe('allow');
    expect(routeAccess('/api/ajustes/revisao', 'admin')).toBe('allow');
  });
});
