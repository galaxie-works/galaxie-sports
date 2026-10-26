/**
 * Ponte entre os filtros da revisão (`ReviewFilters`, na URL) e o componente de filtros do ReUI: um chip
 * por filtro. Tipo, esporte, país/mercado, idioma e status são escolha múltipla ("é um destes"); a busca
 * por nome ou chave é um chip de texto ("contém"). Puro (sem React), como `live-filters.ts`.
 */
import {
  createFilterQuery,
  createFilterRule,
  flattenFilterRules,
} from '@/components/reui/filters/filters-query';
import type { FilterQuery } from '@/components/reui/filters/filters-types';
import {
  REVIEW_KINDS,
  REVIEW_STATES,
  filtersQuery,
  type ReviewFilters,
  type ReviewKind,
  type ReviewState,
} from '@/lib/review/types';

/** Filtros de escolha múltipla, na ordem dos chips. */
export const REVIEW_LIST_FIELDS = ['state', 'kind', 'sport', 'market', 'locale'] as const;
export type ReviewListField = (typeof REVIEW_LIST_FIELDS)[number];
export type ReviewFilterField = ReviewListField | 'q';

/** O que a barra de filtros controla (página e tamanho ficam com a tabela). */
export type ReviewFilterChoice = Pick<ReviewFilters, ReviewListField | 'q'>;

/** Operador dos chips de escolha: "é um destes". */
export const REVIEW_FILTER_OPERATOR = 'is_any_of';
/** Operador do chip de busca: "contém" (nome ou chave). */
export const REVIEW_SEARCH_OPERATOR = 'contains';

/** O operador único de cada chip, que já vem escolhido quando o chip nasce. */
export const operatorFor = (field: string) =>
  field === 'q' ? REVIEW_SEARCH_OPERATOR : REVIEW_FILTER_OPERATOR;

export function hasReviewFilters(filters: ReviewFilterChoice): boolean {
  return REVIEW_LIST_FIELDS.some((f) => filters[f].length > 0) || !!filters.q;
}

/** Chave estável do que a barra controla, para saber se a URL mudou por fora. */
export const reviewFiltersKey = (filters: ReviewFilterChoice) =>
  filtersQuery({
    state: filters.state,
    kind: filters.kind,
    sport: filters.sport,
    market: filters.market,
    locale: filters.locale,
    q: filters.q,
  });

/**
 * Os filtros da URL com a escolha nova. Mudar o filtro volta para a página 1 e mantém o tamanho da página.
 */
export const withChoice = (filters: ReviewFilters, choice: ReviewFilterChoice): ReviewFilters => ({
  ...filters,
  state: choice.state,
  kind: choice.kind,
  sport: choice.sport,
  market: choice.market,
  locale: choice.locale,
  q: choice.q,
  page: 1,
});

/**
 * Clique numa contagem por status: liga ou desliga aquele status no filtro (o mesmo do chip "Status");
 * `null` ("Todos") tira o filtro de status.
 */
export function toggleState(filters: ReviewFilters, state: ReviewState | null): ReviewFilters {
  const next =
    state === null
      ? []
      : filters.state.includes(state)
        ? filters.state.filter((s) => s !== state)
        : REVIEW_STATES.filter((s) => s === state || filters.state.includes(s));
  return { ...filters, state: next, page: 1 };
}

export function toFilterQuery(filters: ReviewFilterChoice): FilterQuery {
  const rules = REVIEW_LIST_FIELDS.filter((f) => filters[f].length).map((f) =>
    createFilterRule<string[] | string>({
      id: f,
      path: [f],
      operator: REVIEW_FILTER_OPERATOR,
      value: [...filters[f]],
    }),
  );
  if (filters.q)
    rules.push(
      createFilterRule<string[] | string>({
        id: 'q',
        path: ['q'],
        operator: REVIEW_SEARCH_OPERATOR,
        value: filters.q,
      }),
    );
  return createFilterQuery(rules);
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Só os chips completos (com algum valor) viram filtro; o chip recém-criado, ainda vazio, não. */
export function fromFilterQuery(query: FilterQuery): ReviewFilterChoice {
  const out: ReviewFilterChoice = { state: [], kind: [], sport: [], market: [], locale: [], q: null };
  for (const rule of flattenFilterRules(query)) {
    const field = rule.path[0];
    if (field === 'q') {
      const q = typeof rule.value === 'string' ? rule.value.trim() : '';
      out.q = q ? q.slice(0, 80) : null;
    } else if (field === 'state')
      out.state = strings(rule.value).filter((v): v is ReviewState =>
        (REVIEW_STATES as readonly string[]).includes(v),
      );
    else if (field === 'kind')
      out.kind = strings(rule.value).filter((v): v is ReviewKind =>
        (REVIEW_KINDS as readonly string[]).includes(v),
      );
    else if (field === 'market') out.market = strings(rule.value).map((m) => m.toUpperCase());
    else if (field === 'sport' || field === 'locale') out[field] = strings(rule.value);
  }
  return out;
}
