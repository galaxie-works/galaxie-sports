import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));
vi.mock('@/lib/builder/store', () => ({ builderDb: () => ({}) }));

const { normalizeDomainHost, txtRecordName } = await import('./domains');

describe('host do domínio comprovado por TXT', () => {
  it('aceita o host em minúsculas, sem esquema, porta, caminho nem ponto final', () => {
    expect(normalizeDomainHost('App.Exemplo.com')).toBe('app.exemplo.com');
    expect(normalizeDomainHost('https://www.exemplo.com.br/widgets?x=1')).toBe('www.exemplo.com.br');
    expect(normalizeDomainHost('exemplo.com:8443')).toBe('exemplo.com');
    expect(normalizeDomainHost('exemplo.com.')).toBe('exemplo.com');
    expect(normalizeDomainHost(' xn--caf-dma.com ')).toBe('xn--caf-dma.com');
  });

  it('recusa o que o CHECK do banco recusa', () => {
    for (const bad of ['', 'localhost', 'exemplo', '-a.com', 'a-.com', 'a..com', 'a b.com', 'a_b.com', '*.exemplo.com', 42])
      expect(normalizeDomainHost(bad), String(bad)).toBeNull();
    expect(normalizeDomainHost(`${'a'.repeat(64)}.com`)).toBeNull();
    expect(normalizeDomainHost(`${'a'.repeat(63)}.com`)).toBe(`${'a'.repeat(63)}.com`);
  });

  it('o registro TXT fica em _galaxie-verify.<host>', () => {
    expect(txtRecordName('app.exemplo.com')).toBe('_galaxie-verify.app.exemplo.com');
  });
});
