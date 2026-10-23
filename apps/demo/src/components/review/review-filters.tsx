'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import {
  REVIEW_KINDS,
  REVIEW_STATES,
  filtersQuery,
  type ReviewFilters,
  type ReviewListResult,
  type ReviewState,
} from '@/lib/review/types';

import { STATE_BADGE, marketLabel, sportLabel } from './labels';

const ALL = '__all';

interface Props {
  filters: ReviewFilters;
  counts: ReviewListResult['counts'];
  options: ReviewListResult['options'];
}

/** Filtros da lista (vão para a URL) e as contagens por status, que também filtram. */
export function ReviewFiltersBar({ filters, counts, options }: Props) {
  const { t } = useI18n();
  const T = t.review;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? '');

  const go = (patch: Partial<ReviewFilters>) =>
    startTransition(() => router.replace(`${pathname}${filtersQuery({ ...filters, page: 1, ...patch })}`));

  const select = (
    label: string,
    value: string | null,
    values: { value: string; label: string }[],
    onChange: (v: string | null) => void,
  ) => (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL || v == null ? null : String(v))}
      items={[
        { value: ALL, label: `${label}: ${T.filters.all}` },
        ...values.map((v) => ({ ...v, label: `${label}: ${v.label}` })),
      ]}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`${label}: ${T.filters.all}`}</SelectItem>
        {values.map((v) => (
          <SelectItem key={v.value} value={v.value}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const total = REVIEW_STATES.reduce((n, s) => n + counts[s], 0);
  const chip = (state: ReviewState | null, label: string, count: number) => {
    const active = filters.state === state;
    return (
      <button
        key={state ?? ALL}
        type="button"
        aria-pressed={active}
        onClick={() => go({ state })}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
          active
            ? 'border-primary bg-primary/5 text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {state ? (
          <Badge variant={STATE_BADGE[state]} size="sm" radius="full" className="size-2 min-w-2 p-0" />
        ) : null}
        {label}
        <span className="text-foreground font-medium tabular-nums">{count}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={T.filters.state}>
        {chip(null, T.filters.allStates, total)}
        {REVIEW_STATES.map((s) => chip(s, T.states[s], counts[s]))}
        {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {select(
          T.filters.kind,
          filters.kind,
          REVIEW_KINDS.map((k) => ({ value: k, label: T.kinds[k] })),
          (kind) => go({ kind: kind as ReviewFilters['kind'] }),
        )}
        {select(
          T.filters.sport,
          filters.sport,
          options.sports.map((s) => ({ value: s, label: sportLabel(t, s) })),
          (sport) => go({ sport }),
        )}
        {select(
          T.filters.market,
          filters.market,
          options.markets.map((m) => ({ value: m, label: marketLabel(t, m) })),
          (market) => go({ market }),
        )}
        {select(
          T.filters.locale,
          filters.locale,
          options.locales.map((l) => ({ value: l, label: l })),
          (locale) => go({ locale }),
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() || null });
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={T.filters.search}
            aria-label={T.filters.search}
            className="h-7 w-56"
          />
          <Button type="submit" size="sm" variant="outline">
            <Search />
            {T.filters.apply}
          </Button>
        </form>
        {filters.kind || filters.sport || filters.market || filters.locale || filters.state || filters.q ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ('');
              startTransition(() => router.replace(pathname));
            }}
          >
            <X />
            {T.filters.clear}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
