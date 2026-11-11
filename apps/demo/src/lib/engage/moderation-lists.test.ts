import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));

const { canonicalTerms, toListSet } = await import('./moderation-lists');

describe('listas da moderação (#969)', () => {
  it('guarda a forma canônica, sem repetidos e em ordem', () => {
    expect(canonicalTerms('hate', ['  Macacão* ', 'macacao*', '', 'Zebra', '***'])).toEqual([
      'macacao*',
      'zebra',
    ]);
  });

  it('domínio: tira esquema e caminho e descarta o que não é domínio', () => {
    expect(
      canonicalTerms('allowed_domains', ['https://www.Clube.com.br/ingressos', 'não é domínio']),
    ).toEqual(['clube.com.br']);
  });

  it('monta o conjunto de listas a partir das linhas', () => {
    const set = toListSet([
      { list: 'hate', locale: 'pt', terms: ['a'] },
      { list: 'hate', locale: 'all', terms: ['b'] },
      { list: 'bet_domains', locale: 'all', terms: ['x.bet'] },
      { list: 'exceptions', locale: 'all', terms: ['macae'] },
    ]);
    expect(set.terms.hate).toEqual({ pt: ['a'], all: ['b'] });
    expect(set.betDomains).toEqual(['x.bet']);
    expect(set.exceptions).toEqual(['macae']);
  });
});
