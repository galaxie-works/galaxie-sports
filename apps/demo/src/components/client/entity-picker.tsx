'use client';

import type { SearchResponse, SearchResult } from '@galaxie/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Crest } from '@/components/sport/crest';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import type { WidgetEntityType } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { apiLocale } from '@/lib/i18n/config';

export interface EntityValue {
  type: WidgetEntityType;
  id: string;
  label: string;
  image?: string | null;
}

const MIN_CHARS = 2;

/**
 * Escolha da entidade padrão do widget com a mesma busca da paleta (⌘K): `/v1/search` pelo proxy da demo,
 * só nos tipos que o widget aceita.
 */
export function EntityPicker({
  types,
  value,
  onChange,
}: {
  types: readonly WidgetEntityType[];
  value: EntityValue | null;
  onChange: (next: EntityValue | null) => void;
}) {
  const { locale, t } = useI18n();
  const e = t.client.editor;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [term]);

  const search = useQuery({
    queryKey: ['builder-entidade', locale, types.join(','), debounced],
    enabled: debounced.length >= MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({
        q: debounced,
        limit: '8',
        types: types.join(','),
        locale: apiLocale(locale),
      });
      const res = await fetch(`/api/galaxie/v1/search?${qs}`, { signal });
      if (!res.ok) throw new Error(`search ${res.status}`);
      return (await res.json()) as SearchResponse;
    },
  });
  const results = (search.data?.data ?? []).filter((r): r is SearchResult & { type: WidgetEntityType } =>
    (types as readonly string[]).includes(r.type),
  );

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={e.entitySearch}
              className="min-w-0 flex-1 justify-between gap-2"
            />
          }
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <Crest src={value.image ?? null} name={value.label} size="xs" />
              <span className="truncate">{value.label}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t.client.builder.entityTypes[value.type]}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{e.entityPlaceholder}</span>
          )}
          <ChevronsUpDown className="text-muted-foreground ml-auto" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={e.entitySearch} value={term} onValueChange={setTerm} />
            <CommandList>
              {search.isFetching ? (
                <div className="flex justify-center p-3">
                  <Spinner />
                </div>
              ) : null}
              <CommandEmpty>{debounced.length < MIN_CHARS ? e.entityMin : e.entityEmpty}</CommandEmpty>
              {results.length ? (
                <CommandGroup>
                  {results.map((r) => (
                    <CommandItem
                      key={`${r.type}:${r.id}`}
                      value={`${r.type}:${r.id}`}
                      onSelect={() => {
                        onChange({ type: r.type, id: r.id, label: r.name, image: r.image });
                        setOpen(false);
                      }}
                    >
                      <Crest src={r.image} name={r.name} size="xs" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{r.name}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {t.client.builder.entityTypes[r.type]}
                          {r.detail ? ` · ${r.detail}` : ''}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={e.entityClear}
          title={e.entityClear}
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
