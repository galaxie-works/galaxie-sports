import { describe, expect, it } from 'vitest';
import { accentPattern, bestMatch, fold, matchOf, splitMatchup, stringsOf } from './match.js';

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

describe('busca — confronto "time x time"', () => {
  it('separa os dois lados pelos separadores comuns, sem acento', () => {
    expect(splitMatchup('Palmeiras x Corinthians')).toEqual(['palmeiras', 'corinthians']);
    expect(splitMatchup('São Paulo vs Grêmio')).toEqual(['sao paulo', 'gremio']);
    expect(splitMatchup('Real Madrid vs. Barcelona')).toEqual(['real madrid', 'barcelona']);
    expect(splitMatchup('Boca Juniors - River Plate')).toEqual(['boca juniors', 'river plate']);
    expect(splitMatchup('flamengo×vasco')).toEqual(['flamengo', 'vasco']);
    expect(splitMatchup('Inter contra Grêmio')).toEqual(['inter', 'gremio']);
    expect(splitMatchup('  verdao  X  timao ')).toEqual(['verdao', 'timao']);
  });

  it('nome com traço sem espaço, um lado curto ou termo comum não é confronto', () => {
    expect(splitMatchup('Atlético-MG')).toBeNull();
    expect(splitMatchup('Paris Saint-Germain')).toBeNull();
    expect(splitMatchup('palmeiras')).toBeNull();
    expect(splitMatchup('a x b')).toBeNull();
    expect(splitMatchup('x vasco')).toBeNull();
    expect(splitMatchup('a x b x c')).toBeNull();
  });
});
