'use client';

import type { ExploreAgenda } from '@galaxie/contracts';
import { Flag, Shapes, Trophy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { filterLabels, OpenValuesFirst } from '@/components/live/live-filter-bar';
import { Filters, FiltersRow } from '@/components/reui/filters/filters';
import {
  createFilterQuery,
  createFilterRule,
  flattenFilterRules,
} from '@/components/reui/filters/filters-query';
import type {
  FilterChangeDetails,
  FilterField,
  FilterOperator,
  FilterOption,
  FilterQuery,
} from '@/components/reui/filters/filters-types';
import { CountryFlag } from '@/components/sport/country-flag';
import { Spinner } from '@/components/ui/spinner';
import { sortByLabel } from '@/lib/alphabetical';
import { agendaHref, type AgendaParams } from '@/lib/explore-index';
import { useI18n } from '@/lib/i18n/client';
import { plural } from '@/lib/i18n/text';
import { COUNTRIES, SPORTS, sportBySlug } from '@/lib/navigation';

type AgendaFilterField = 'esporte' | 'pais' | 'competicao';
const FIELDS: readonly AgendaFilterField[] = ['esporte', 'pais', 'competicao'];

/** Operador único dos chips: "é" (uma escolha, como a API da agenda aceita). */
const OPERATOR = 'is';

const filtersKey = (p: AgendaParams) => FIELDS.map((f) => p[f] ?? '').join('|');

function toFilterQuery(params: AgendaParams): FilterQuery {
  return createFilterQuery(
    FIELDS.filter((f) => params[f]).map((f) =>
      createFilterRule({ id: f, path: [f], operator: OPERATOR, value: params[f] }),
    ),
  );
}

/** Só os chips completos (com valor) viram filtro; o chip recém-criado, ainda vazio, não. */
function fromFilterQuery(query: FilterQuery): Pick<AgendaParams, AgendaFilterField> {
  const out: Pick<AgendaParams, AgendaFilterField> = { esporte: null, pais: null, competicao: null };
  for (const rule of flattenFilterRules(query)) {
    const field = rule.path[0] as AgendaFilterField | undefined;
    if (field && FIELDS.includes(field) && typeof rule.value === 'string' && rule.value)
      out[field] = rule.value;
  }
  return out;
}

/**
 * Filtros da Agenda com o mesmo componente do Ao vivo (ReUI c-filters-3): um chip por filtro (esporte,
 * país e competição), cada um com uma escolha, porque a API da agenda aceita um de cada. A contagem de
 * jogos aparece em cada opção. O filtro aplicado vem da URL e volta para ela; trocar esporte ou país
 * limpa a competição e volta ao primeiro dia com jogos, como antes.
 */
export function AgendaFilterBar({
  facets,
  params,
}: {
  facets: ExploreAgenda['facets'];
  params: AgendaParams;
}) {
  const { locale, t } = useI18n();
  const tf = t.live.filters;
  const ti = t.nav.explore.index;
  const labels = useMemo(() => filterLabels(locale, tf.ui), [locale, tf]);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // A URL é a fonte da verdade; a query local guarda também os chips ainda sem valor. Como na revisão,
  // a URL só muda quando a navegação do servidor termina: `seen` é a última URL vista e `target`, a
  // que a barra pediu.
  const key = filtersKey(params);
  const [state, setState] = useState(() => ({ seen: key, target: key, query: toFilterQuery(params) }));
  let { query, target } = state;
  if (state.seen !== key) {
    if (key === target) setState({ ...state, seen: key });
    else {
      // a URL mudou por fora (voltar do navegador, link): a barra acompanha
      query = toFilterQuery(params);
      target = key;
      setState({ seen: key, target, query });
    }
  }

  const inUse = new Set(query.rules.flatMap((r) => (r.type === 'rule' ? r.path : [])));
  const operators: FilterOperator[] = [{ value: OPERATOR, label: tf.operator }];
  const games = (count: number) => plural(locale, count, ti.dayGames);
  const base = (id: AgendaFilterField, label: string) =>
    ({
      id,
      label,
      type: 'select',
      operators,
      defaultOperator: OPERATOR,
      disabled: inUse.has(id),
    }) satisfies Partial<FilterField>;
  // em ordem alfabética, inclusive o que está na URL e não tem jogo na janela (continua escolhível e removível)
  const withSelected = (options: FilterOption[], selected: string | null | undefined) =>
    sortByLabel(
      selected && !options.some((o) => o.value === selected)
        ? [...options, { value: selected, label: selected, description: games(0) }]
        : options,
    );

  const countryCount = new Map(facets.countries.map((c) => [c.code, c.count]));
  const fields: FilterField[] = [
    {
      ...base('esporte', tf.fields.sport),
      icon: <Shapes aria-hidden />,
      placeholder: tf.search.sport,
      options: withSelected(
        facets.sports.map((s) => {
          const nav = sportBySlug(s.slug);
          const Icon = SPORTS.find((n) => n.slug === s.slug)?.icon ?? Shapes;
          return {
            value: s.slug,
            label: nav ? t.nav.sports[nav.slug] : s.slug,
            description: games(s.count),
            icon: <Icon className="size-3.5" aria-hidden />,
            keywords: [s.slug],
          };
        }),
        params.esporte,
      ),
    },
    {
      ...base('pais', tf.fields.country),
      icon: <Flag aria-hidden />,
      placeholder: tf.search.country,
      options: sortByLabel(
        COUNTRIES.map((c) => ({
          value: c.code,
          label: t.nav.countries[c.code],
          description: games(countryCount.get(c.code) ?? 0),
          icon: <CountryFlag code={c.code} />,
          keywords: [c.code],
        })),
      ),
    },
    {
      ...base('competicao', tf.fields.competition),
      icon: <Trophy aria-hidden />,
      placeholder: tf.search.competition,
      options: withSelected(
        facets.competitions.map((c) => ({
          value: c.slug,
          label: c.name,
          description: games(c.count),
          keywords: [c.slug],
        })),
        params.competicao,
      ),
    },
  ];

  const onQueryChange = (changed: FilterQuery, details: FilterChangeDetails) => {
    // um valor por filtro e só "é": duplicar ou negar um chip mostraria um filtro que a API não aplica
    if (details.reason === 'duplicate' || details.reason === 'negate') return;
    // o chip novo nasce sem condição; com uma só ("é"), ela já vem escolhida e o chip abre nos valores
    let next: FilterQuery = {
      ...changed,
      rules: changed.rules.map((r) => (r.type === 'rule' && !r.operator ? { ...r, operator: OPERATOR } : r)),
    };
    const chosen = fromFilterQuery(next);
    // trocar esporte ou país tira a competição (ela pode não ser daquele esporte ou país); compara com a
    // escolha que a barra mostra, não com a URL, que fica para trás enquanto a navegação corre
    const shown = fromFilterQuery(query);
    if (
      (chosen.esporte !== shown.esporte || chosen.pais !== shown.pais) &&
      chosen.competicao === shown.competicao &&
      chosen.competicao
    ) {
      chosen.competicao = null;
      next = { ...next, rules: next.rules.filter((r) => !(r.type === 'rule' && r.path[0] === 'competicao')) };
    }
    const nextKey = filtersKey(chosen);
    setState((s) => ({ ...s, target: nextKey, query: next }));
    // trocar um filtro volta ao primeiro dia com jogos (o dia escolhido pode ficar vazio) e à primeira página
    if (nextKey !== target)
      startTransition(() => router.push(agendaHref({ ...chosen, dia: null }), { scroll: false }));
  };

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div role="search" aria-label={ti.agendaTitle} className="min-w-0 flex-1">
        <Filters fields={fields} query={query} onQueryChange={onQueryChange} labels={labels} size="sm">
          <FiltersRow showClear />
          <OpenValuesFirst />
        </Filters>
      </div>
      {pending ? <Spinner className="text-muted-foreground mt-1.5 size-4" /> : null}
    </div>
  );
}
