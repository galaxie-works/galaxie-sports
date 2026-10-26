'use client';

import { CircleDot, Flag, Languages, Layers, Search, Shapes } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { filterLabels, OpenValuesFirst } from '@/components/live/live-filter-bar';
import { Badge } from '@/components/reui/badge';
import { Filters, FiltersRow } from '@/components/reui/filters/filters';
import type {
  FilterField,
  FilterOperator,
  FilterOption,
  FilterQuery,
} from '@/components/reui/filters/filters-types';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import { SPORTS } from '@/lib/navigation';
import {
  REVIEW_KINDS,
  REVIEW_STATES,
  filtersQuery,
  type ReviewFilters,
  type ReviewListResult,
  type ReviewState,
} from '@/lib/review/types';

import { STATE_BADGE, marketLabel, sportLabel } from './labels';
import {
  REVIEW_FILTER_OPERATOR,
  REVIEW_SEARCH_OPERATOR,
  fromFilterQuery,
  operatorFor,
  reviewFiltersKey,
  toFilterQuery,
  toggleState,
  withChoice,
  type ReviewFilterField,
} from './review-filters';

interface Props {
  filters: ReviewFilters;
  counts: ReviewListResult['counts'];
  options: ReviewListResult['options'];
}

const stateDot = (state: ReviewState) => (
  <Badge variant={STATE_BADGE[state]} size="sm" radius="full" className="size-2 min-w-2 p-0" />
);

/**
 * Filtros da revisão (ReUI c-filters-3, como o Ao vivo): um chip por filtro, cada um com escolha múltipla,
 * e a busca por nome ou chave num chip de texto. O filtro aplicado vem da URL e volta para ela assim que
 * muda (página 1, mesmo tamanho de página); o chip recém-criado, ainda sem valor, só existe aqui. Abaixo,
 * as contagens por status (com os demais filtros), que ligam e desligam o mesmo filtro de status.
 */
export function ReviewFiltersBar({ filters, counts, options }: Props) {
  const { locale, t } = useI18n();
  const T = t.review;
  const tf = T.filters;
  const labels = useMemo(() => filterLabels(locale, t.live.filters.ui), [locale, t]);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (next: ReviewFilters) =>
    startTransition(() => router.replace(`${pathname}${filtersQuery(next)}`, { scroll: false }));

  // A URL é a fonte da verdade; a query local guarda também os chips ainda sem valor. Diferente do Ao
  // vivo, a URL só muda quando a navegação do servidor termina: `seen` é a última URL vista e `target`,
  // a que a barra pediu. Enquanto a navegação corre, a barra mostra a escolha nova (sem voltar para a
  // URL antiga) e compara a próxima mudança com `target`, para desfazer rápido também navegar.
  const key = reviewFiltersKey(filters);
  const [state, setState] = useState(() => ({ seen: key, target: key, query: toFilterQuery(filters) }));
  let { query, target } = state;
  if (state.seen !== key) {
    if (key === target) setState({ ...state, seen: key });
    else {
      // a URL mudou por fora (voltar do navegador, link): a barra acompanha
      query = toFilterQuery(filters);
      target = key;
      setState({ seen: key, target, query });
    }
  }
  /** A escolha que a barra mostra agora (a pedida, mesmo que a URL ainda não tenha chegado nela). */
  const current = withChoice(filters, fromFilterQuery(query));

  /** Leva a barra e a URL para a escolha nova (página 1, mesmo tamanho de página). */
  const apply = (next: ReviewFilters, nextQuery = toFilterQuery(next)) => {
    const nextKey = reviewFiltersKey(next);
    setState((s) => ({ ...s, target: nextKey, query: nextQuery }));
    if (nextKey !== target) go(next);
  };

  const inUse = new Set(query.rules.flatMap((r) => (r.type === 'rule' ? r.path : [])));
  const pickOperators: FilterOperator[] = [
    { value: REVIEW_FILTER_OPERATOR, label: tf.operator, arity: 'many' },
  ];
  const searchOperators: FilterOperator[] = [
    { value: REVIEW_SEARCH_OPERATOR, label: tf.contains, arity: 'one' },
  ];
  const base = (id: ReviewFilterField) =>
    ({
      id,
      label: tf.fields[id],
      type: id === 'q' ? 'text' : 'select',
      operators: id === 'q' ? searchOperators : pickOperators,
      defaultOperator: operatorFor(id),
      disabled: inUse.has(id),
    }) satisfies Partial<FilterField>;
  const toOptions = (
    values: string[],
    label: (v: string) => string,
    icon: (v: string) => React.ReactNode,
  ): FilterOption[] => values.map((v) => ({ value: v, label: label(v), icon: icon(v), keywords: [v] }));
  // o que está na URL e saiu do catálogo continua escolhível (e removível)
  const withSelected = (values: string[], selected: string[]) => [
    ...values,
    ...selected.filter((v) => !values.includes(v)),
  ];

  const fields: FilterField[] = [
    {
      ...base('state'),
      icon: <CircleDot aria-hidden />,
      searchable: false,
      options: REVIEW_STATES.map((s) => ({ value: s, label: T.states[s], icon: stateDot(s) })),
    },
    {
      ...base('kind'),
      icon: <Layers aria-hidden />,
      searchable: false,
      options: REVIEW_KINDS.map((k) => ({ value: k, label: T.kinds[k] })),
    },
    {
      ...base('sport'),
      icon: <Shapes aria-hidden />,
      placeholder: tf.searchIn.sport,
      options: toOptions(
        withSelected(options.sports, filters.sport),
        (s) => sportLabel(t, s),
        (s) => {
          const Icon = SPORTS.find((n) => n.slug === s)?.icon ?? Shapes;
          return <Icon className="size-3.5" aria-hidden />;
        },
      ),
    },
    {
      ...base('market'),
      icon: <Flag aria-hidden />,
      placeholder: tf.searchIn.market,
      options: toOptions(
        withSelected(options.markets, filters.market),
        (m) => marketLabel(t, m),
        () => <Flag className="size-3.5" aria-hidden />,
      ),
    },
    {
      ...base('locale'),
      icon: <Languages aria-hidden />,
      placeholder: tf.searchIn.locale,
      options: toOptions(
        withSelected(options.locales, filters.locale),
        (l) => l,
        () => <Languages className="size-3.5" aria-hidden />,
      ),
    },
    {
      ...base('q'),
      icon: <Search aria-hidden />,
      placeholder: tf.search,
    },
  ];

  const onQueryChange = (changed: FilterQuery) => {
    // o chip novo nasce sem condição; com uma só por filtro, ela já vem escolhida e o chip abre no valor
    const next: FilterQuery = {
      ...changed,
      rules: changed.rules.map((r) =>
        r.type === 'rule' && !r.operator ? { ...r, operator: operatorFor(r.path[0] ?? '') } : r,
      ),
    };
    apply(withChoice(filters, fromFilterQuery(next)), next);
  };

  const total = REVIEW_STATES.reduce((n, s) => n + counts[s], 0);
  const chip = (s: ReviewState | null, label: string, count: number) => {
    const active = s === null ? !current.state.length : current.state.includes(s);
    return (
      <button
        key={s ?? 'all'}
        type="button"
        aria-pressed={active}
        onClick={() => apply(toggleState(current, s))}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
          active
            ? 'border-primary bg-primary/5 text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {s ? stateDot(s) : null}
        {label}
        <span className="text-foreground font-medium tabular-nums">{count}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <div role="search" aria-label={tf.label} className="min-w-0 flex-1">
          <Filters fields={fields} query={query} onQueryChange={onQueryChange} labels={labels} size="sm">
            <FiltersRow showClear />
            <OpenValuesFirst />
          </Filters>
        </div>
        {pending ? <Spinner className="text-muted-foreground mt-1.5 size-4" /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tf.counts}>
        {chip(null, tf.allStates, total)}
        {REVIEW_STATES.map((s) => chip(s, T.states[s], counts[s]))}
      </div>
    </div>
  );
}
