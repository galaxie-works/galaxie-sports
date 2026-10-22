import { describe, expect, it } from 'vitest';
import { accentPattern, bestMatch, fold, matchOf, stringsOf } from './match.js';

describe('busca — casamento', () => {
  it('dobra caixa, acento e espaços', () => {
    expect(fold('  São   Paulo ')).toBe('sao paulo');
    expect(fold('VERDÃO')).toBe('verdao');
    expect(fold('Grêmio')).toBe('gremio');
  });

  it('classifica em exato, começo (do nome ou de uma palavra) e trecho', () => {
    expect(matchOf('Palmeiras', 'palmeiras')).toBe('exact');
    expect(matchOf('Palmeiras', 'palm')).toBe('prefix');
    expect(matchOf('Atlético Mineiro', 'mineiro')).toBe('prefix');
    expect(matchOf('Paris Saint-Germain', 'germain')).toBe('prefix');
    expect(matchOf('Palmeiras', 'meir')).toBe('contains');
    expect(matchOf('Palmeiras', 'santos')).toBeNull();
  });

  it('o apelido só aparece quando casa melhor que o nome', () => {
    expect(bestMatch('Palmeiras', ['Verdão', 'Alviverde'], 'verdao')).toEqual({
      match: 'exact',
      matched: 'Verdão',
    });
    expect(bestMatch('Palmeiras', ['Palestra'], 'pal')).toEqual({ match: 'prefix', matched: null });
    expect(bestMatch('Flamengo', ['Mengão'], 'corinthians')).toBeNull();
  });

  it('regex do Postgres sem acento e com curingas escapados', () => {
    const re = new RegExp(accentPattern('sao paulo'), 'i');
    expect(re.test('São Paulo')).toBe(true);
    expect(re.test('SÃO PAULO')).toBe(true);
    expect(re.test('Santos')).toBe(false);
    expect(accentPattern('a.c')).toBe(`${accentPattern('a')}\\.${accentPattern('c')}`);
  });

  it('extrai strings de qualquer JSON da base semântica', () => {
    expect(stringsOf({ 'pt-BR': ['Série A', 'Brasileirão'], es: 'Brasileirao', n: 1 })).toEqual([
      'Série A',
      'Brasileirão',
      'Brasileirao',
    ]);
  });
});
