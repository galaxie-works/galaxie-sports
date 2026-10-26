'use client';

import { CalendarClock, Flag, Radio, Shapes, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Filters, FiltersRow, useFilterFocusStore } from '@/components/reui/filters/filters';
import type {
  FilterField,
  FilterLabels,
  FilterOperator,
  FilterOption,
  FilterQuery,
} from '@/components/reui/filters/filters-types';
import { Crest } from '@/components/sport/crest';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import { SPORTS } from '@/lib/navigation';

import { LiveDot } from './live-nav-item';
import {
  fromFilterQuery,
  LIVE_FILTER_OPERATOR,
  liveFiltersSearch,
  toFilterQuery,
  type LiveFilterOption,
  type LiveFilterOptions,
  type LiveFilters,
} from './live-filters';

type FilterText = Dictionary['live']['filters'];

/**
 * Os textos do componente (ReUI) nos três idiomas; os que recebem variáveis viram funções. A revisão
 * (Ajustes → Revisão) usa os mesmos.
 */
export function filterLabels(locale: Locale, ui: FilterText['ui']): Partial<FilterLabels> {
  const {
    moveToGroup,
    rowLabel,
    groupLabel,
    groupAdded,
    groupRemoved,
    reorderAnnouncement,
    moveAnnouncement,
    combinatorLabel,
    chipMenu,
    exclusiveAnnouncement,
    itemCount,
    resultsAnnouncement,
    steps,
    countAnnouncement,
    valueCount,
    valueDetail,
    valueRange,
    rangeFrom,
    rangeTo,
    negated,
    issueSummary,
    ...plain
  } = ui;
  return {
    ...plain,
    moveToGroup: (position) => fill(moveToGroup, { position }),
    rowLabel: (condition, depth) => fill(rowLabel, { condition, depth }),
    groupLabel: (description, depth) => fill(groupLabel, { description, depth }),
    groupAnnouncement: (added) => (added ? groupAdded : groupRemoved),
    reorderAnnouncement: (label, position, total) => fill(reorderAnnouncement, { label, position, total }),
    moveAnnouncement: (label, destination, position, total) =>
      fill(moveAnnouncement, { label, destination, position, total }),
    combinatorLabel: (word) => fill(combinatorLabel, { word }),
    chipMenu: (field) => fill(chipMenu, { field }),
    exclusiveAnnouncement: (label, cleared) => plural(locale, cleared, exclusiveAnnouncement, { label }),
    itemCount: (count) => plural(locale, count, itemCount),
    resultsAnnouncement: (count) => plural(locale, count, resultsAnnouncement),
    stepAnnouncement: (step, label) => fill(steps[step], { label }),
    countAnnouncement: (count) => plural(locale, count, countAnnouncement),
    valueCount: (count) => plural(locale, count, valueCount),
    valueDetail: (summary, values) => fill(valueDetail, { summary, values: values.join(', ') }),
    valueRange: (from, to) => fill(valueRange, { from, to }),
    rangeFrom: (field) => fill(rangeFrom, { field }),
    rangeTo: (field) => fill(rangeTo, { field }),
    negated: (operator) => fill(negated, { operator }),
    issueSummary: (count) => plural(locale, count, issueSummary),
  };
}

/**
 * O chip recém-criado abre sozinho na escolha da condição; aqui só há uma ("é"), já preenchida em
 * `onQueryChange`, então ele abre direto na lista de valores.
 */
export function OpenValuesFirst() {
  const store = useFilterFocusStore();
  useEffect(
    () =>
      store.subscribe(() => {
        const focus = store.getSnapshot();
        if (focus.autoOpen && focus.segment === 'operator') store.set({ ...focus, segment: 'value' });
      }),
    [store],
  );
  return null;
}

const flagIcon = (o: LiveFilterOption) =>
  o.image ? (
    <img
      src={o.image}
      alt=""
      draggable={false}
      className="h-3 w-4 shrink-0 rounded-[2px] object-cover ring-1 ring-white/15"
    />
  ) : (
    <Flag className="size-3.5" aria-hidden />
  );

/**
 * Barra de filtros do Ao vivo (ReUI c-filters-3): um chip por filtro, cada um com escolha múltipla. O
 * filtro aplicado vem da URL (`filters`) e volta para ela por `onChange`; o chip recém-criado, ainda sem
 * valor, só existe aqui (não muda a URL nem a lista). Um filtro já na barra some do "Filtrar", para não
 * haver dois chips de esporte.
 */
export function LiveFilterBar({
  filters,
  options,
  onChange,
}: {
  filters: LiveFilters;
  options: LiveFilterOptions;
  onChange: (filters: LiveFilters) => void;
}) {
  const { locale, t } = useI18n();
  const tf = t.live.filters;
  const labels = useMemo(() => filterLabels(locale, tf.ui), [locale, tf]);

  // a URL é a fonte da verdade; a query local guarda também os chips ainda sem valor
  const key = liveFiltersSearch(filters);
  const [state, setState] = useState(() => ({ key, query: toFilterQuery(filters) }));
  let query = state.query;
  if (state.key !== key) {
    // a URL mudou por fora (link do menu, voltar do navegador): a barra acompanha
    query = toFilterQuery(filters);
    setState({ key, query });
  }

  const inUse = new Set(query.rules.flatMap((r) => (r.type === 'rule' ? r.path : [])));
  const operators: FilterOperator[] = [{ value: LIVE_FILTER_OPERATOR, label: tf.operator, arity: 'many' }];
  const base = (id: keyof LiveFilters) =>
    ({
      id,
      label: tf.fields[id],
      type: 'select',
      operators,
      defaultOperator: LIVE_FILTER_OPERATOR,
      disabled: inUse.has(id),
    }) satisfies Partial<FilterField>;
  const toOptions = (
    list: LiveFilterOption[],
    icon: (o: LiveFilterOption) => React.ReactNode,
  ): FilterOption[] =>
    list.map((o) => ({ value: o.value, label: o.label, icon: icon(o), keywords: [o.value] }));

  const fields: FilterField[] = [
    {
      ...base('status'),
      icon: <Radio aria-hidden />,
      searchable: false,
      options: [
        { value: 'live', label: tf.status.live, icon: <LiveDot on /> },
        {
          value: 'upcoming',
          label: tf.status.upcoming,
          icon: <CalendarClock className="size-3.5" aria-hidden />,
        },
      ],
    },
    {
      ...base('sport'),
      icon: <Shapes aria-hidden />,
      placeholder: tf.search.sport,
      options: toOptions(options.sport, (o) => {
        const Icon = SPORTS.find((s) => s.slug === o.value)?.icon ?? Shapes;
        return <Icon className="size-3.5" aria-hidden />;
      }),
    },
    {
      ...base('country'),
      icon: <Flag aria-hidden />,
      placeholder: tf.search.country,
      options: toOptions(options.country, flagIcon),
    },
    {
      ...base('competition'),
      icon: <Trophy aria-hidden />,
      placeholder: tf.search.competition,
      options: toOptions(options.competition, (o) => <Crest src={o.image} name={o.label} size="xs" />),
    },
  ];

  const onQueryChange = (changed: FilterQuery) => {
    // o chip novo nasce sem condição; com uma só ("é"), ela já vem escolhida e o chip abre nos valores
    const next: FilterQuery = {
      ...changed,
      rules: changed.rules.map((r) =>
        r.type === 'rule' && !r.operator ? { ...r, operator: LIVE_FILTER_OPERATOR } : r,
      ),
    };
    const nextFilters = fromFilterQuery(next);
    const nextKey = liveFiltersSearch(nextFilters);
    setState({ key: nextKey, query: next });
    if (nextKey !== key) onChange(nextFilters);
  };

  return (
    <div role="search" aria-label={tf.label} className="min-w-0">
      <Filters fields={fields} query={query} onQueryChange={onQueryChange} labels={labels} size="sm">
        <FiltersRow showClear />
        <OpenValuesFirst />
      </Filters>
    </div>
  );
}
