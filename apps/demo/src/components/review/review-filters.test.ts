import { describe, expect, it } from 'vitest';

import { createFilterQuery, createFilterRule } from '@/components/reui/filters/filters-query';
import { NO_REVIEW_FILTERS, filtersQuery, parseFilters, type ReviewFilters } from '@/lib/review/types';

import {
  REVIEW_FILTER_OPERATOR,
  REVIEW_SEARCH_OPERATOR,
  fromFilterQuery,
  hasReviewFilters,
  operatorFor,
  reviewFiltersKey,
  toFilterQuery,
  toggleState,
  withChoice,
} from './review-filters';

const f = (over: Partial<ReviewFilters>): ReviewFilters => ({ ...NO_REVIEW_FILTERS, ...over });

describe('filtros da revisão na URL', () => {
  it('lê listas separadas por vírgula, sem repetição, e ignora tipo e status desconhecidos', () => {
    const p = new URLSearchParams(
      'tipo=team,xyz,team,copy&esporte=football,,mma&mercado=br,int,BR&locale=es,pt-BR&status=draft,publicado&q=+Verd%C3%A3o+',
    );
    expect(parseFilters(p)).toEqual({
      kind: ['team', 'copy'],
      sport: ['football', 'mma'],
      market: ['BR', 'INT'],
      locale: ['es', 'pt-BR'],
      state: ['draft'],
      q: 'Verdão',
      page: 1,
      per: 50,
    });
  });

  it('o link antigo, de um valor só, continua valendo', () => {
    expect(parseFilters({ tipo: 'derby', status: 'needs_review' })).toMatchObject({
      kind: ['derby'],
      state: ['needs_review'],
    });
  });

  it('sem parâmetro não há filtro', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(NO_REVIEW_FILTERS);
    expect(hasReviewFilters(NO_REVIEW_FILTERS)).toBe(false);
    expect(hasReviewFilters(f({ q: 'fla' }))).toBe(true);
  });

  it('escreve só o que está definido e volta igual (ida e volta)', () => {
    const filters = f({ kind: ['team', 'copy'], market: ['BR'], q: 'São Paulo', page: 3, per: 100 });
    const search = filtersQuery(filters);
    expect(search).toBe('?tipo=team%2Ccopy&mercado=BR&q=S%C3%A3o+Paulo&pagina=3&per=100');
    expect(parseFilters(new URLSearchParams(search))).toEqual(filters);
    expect(filtersQuery(NO_REVIEW_FILTERS)).toBe('');
  });

  it('a chave da barra ignora página e tamanho', () => {
    expect(reviewFiltersKey(f({ sport: ['football'], page: 4, per: 250 }))).toBe(
      reviewFiltersKey(f({ sport: ['football'] })),
    );
  });
});

describe('ponte com o componente de filtros (ReUI)', () => {
  it('um chip por filtro com valor: "é um destes" nas listas, "contém" na busca', () => {
    const q = toFilterQuery(f({ state: ['draft', 'approved'], locale: ['es'], q: 'boca' }));
    expect(q.rules.map((r) => (r.type === 'rule' ? [r.path[0], r.operator, r.value] : null))).toEqual([
      ['state', REVIEW_FILTER_OPERATOR, ['draft', 'approved']],
      ['locale', REVIEW_FILTER_OPERATOR, ['es']],
      ['q', REVIEW_SEARCH_OPERATOR, 'boca'],
    ]);
    expect(toFilterQuery(NO_REVIEW_FILTERS).rules).toEqual([]);
  });

  it('ida e volta sem perda', () => {
    const choice = {
      state: ['needs_review' as const],
      kind: ['derby' as const, 'translation' as const],
      sport: ['football', 'basketball'],
      market: ['AR'],
      locale: ['es'],
      q: 'superclásico',
    };
    expect(fromFilterQuery(toFilterQuery(choice))).toEqual(choice);
  });

  it('chip ainda sem valor não filtra; valores desconhecidos e vazios caem', () => {
    const q = createFilterQuery<unknown>([
      createFilterRule({ id: 'a', path: ['kind'], operator: REVIEW_FILTER_OPERATOR, value: undefined }),
      createFilterRule({
        id: 'b',
        path: ['state'],
        operator: REVIEW_FILTER_OPERATOR,
        value: ['x', 'reviewed'],
      }),
      createFilterRule({ id: 'c', path: ['market'], operator: REVIEW_FILTER_OPERATOR, value: ['br', 1] }),
      createFilterRule({ id: 'd', path: ['q'], operator: REVIEW_SEARCH_OPERATOR, value: '   ' }),
      createFilterRule({ id: 'e', path: ['outro'], operator: REVIEW_FILTER_OPERATOR, value: ['y'] }),
    ]);
    expect(fromFilterQuery(q)).toEqual({
      state: ['reviewed'],
      kind: [],
      sport: [],
      market: ['BR'],
      locale: [],
      q: null,
    });
  });

  it('cada chip nasce com o seu único operador', () => {
    expect(operatorFor('q')).toBe(REVIEW_SEARCH_OPERATOR);
    expect(operatorFor('sport')).toBe(REVIEW_FILTER_OPERATOR);
  });

  it('mudar o filtro volta para a página 1 e mantém o tamanho da página', () => {
    const next = withChoice(f({ page: 5, per: 250, sport: ['football'] }), {
      ...f({}),
      sport: ['basketball'],
    });
    expect(next).toMatchObject({ page: 1, per: 250, sport: ['basketball'] });
  });
});

describe('contagens por status', () => {
  it('liga e desliga o status, na ordem dos status, e "Todos" limpa', () => {
    const one = toggleState(f({ page: 3 }), 'approved');
    expect(one).toMatchObject({ state: ['approved'], page: 1 });
    const two = toggleState(one, 'draft');
    expect(two.state).toEqual(['draft', 'approved']);
    expect(toggleState(two, 'approved').state).toEqual(['draft']);
    expect(toggleState(two, null).state).toEqual([]);
  });
});
