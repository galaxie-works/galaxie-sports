import { describe, expect, it } from 'vitest';

import { internalPath } from './internal-path';

const ORIGIN = 'https://demo.test';

describe('internalPath', () => {
  it('aceita caminhos da própria origem, com query e hash', () => {
    expect(internalPath('/', ORIGIN)).toBe('/');
    expect(internalPath('/times/1?temporada=2026#elenco', ORIGIN)).toBe('/times/1?temporada=2026#elenco');
    expect(internalPath('/a/../b', ORIGIN)).toBe('/b');
  });

  it('recusa o que o navegador levaria para outra origem', () => {
    for (const value of [
      '//evil.com',
      '/\\evil.com',
      '/\\\\evil.com',
      '/\t/evil.com',
      '/\\t/evil.com',
      '/\n/evil.com',
      '/\r\n/evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      'evil.com',
    ])
      expect(internalPath(value, ORIGIN), JSON.stringify(value)).toBeNull();
  });

  it('recusa caminho que só depois de resolvido começa com //', () => {
    for (const value of ['/.//evil.com', '/a/..//evil.com', '/./\\evil.com'])
      expect(internalPath(value, ORIGIN), value).toBeNull();
  });

  it('recusa o que não é texto e funciona sem a origem real', () => {
    expect(internalPath(null)).toBeNull();
    expect(internalPath(42)).toBeNull();
    expect(internalPath('/eventos/9?x=1')).toBe('/eventos/9?x=1');
    expect(internalPath('/\\evil.com')).toBeNull();
  });
});
