import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  accentPattern,
  bestMatch,
  fold,
  matchOf,
  personSearchMatchSql,
  personSearchPattern,
  searchPattern,
  splitMatchup,
  stringsOf,
} from './match.js';

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

describe('busca — pré-filtro de pessoas (índice person_search_trgm_idx)', () => {
  const dialect = new PgDialect();
  const EXPR =
    "(coalesce(p.name, '') || ' ' || coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))";

  it('usa a expressão do índice com os literais inline; só o padrão vai como parâmetro', () => {
    const q = dialect.sqlToQuery(personSearchMatchSql('messi'));
    expect(q.sql).toBe(`${EXPR} ~* $1`);
    expect(q.params).toEqual([accentPattern('messi')]);
  });

  it('termo curto só casa no começo de uma palavra, com separadores que o pg_trgm indexa', () => {
    expect(dialect.sqlToQuery(personSearchMatchSql('ro')).params).toEqual([
      `(^|[ .'-])${accentPattern('ro')}`,
    ]);
    expect(dialect.sqlToQuery(personSearchMatchSql('ronaldo')).params).toEqual([accentPattern('ronaldo')]);
    const re = new RegExp(personSearchPattern('ro'), 'i');
    for (const hit of ['Rodrygo', 'Cristiano Ronaldo', 'J. Rodríguez', "D'Rossi", 'Saint-Romain'])
      expect(hit).toMatch(re);
    expect('Carolina').not.toMatch(re);
    // as outras entidades seguem com a classe negada
    expect(searchPattern('br')).toBe(`(^|[^[:alnum:]])${accentPattern('br')}`);
    expect(searchPattern('ronaldo')).toBe(accentPattern('ronaldo'));
  });

  it('é a mesma expressão da migration do índice (sem o alias da tabela)', () => {
    const migration = readFileSync(
      new URL('../../../../packages/db/drizzle/0192_busca_trigram_pessoa.sql', import.meta.url),
      'utf8',
    );
    const indexed = EXPR.replace(/p\.(\w+)/g, '"$1"');
    expect(migration).toContain(`USING gin (${indexed} gin_trgm_ops)`);
  });
});
