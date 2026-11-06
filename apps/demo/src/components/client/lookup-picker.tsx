'use client';

import type { LookupSource } from '@galaxie/widgets';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { useI18n } from '@/lib/i18n/client';
import { apiLocale } from '@/lib/i18n/config';

/** Escolha feita numa opção de busca (a prova, o cavaleiro, o cavalo ou a edição dos Jogos). */
export interface LookupValue {
  type: 'lookup';
  id: string;
  label: string;
}

interface Item {
  id: string;
  label: string;
  detail: string | null;
}

const MIN_CHARS = 2;

/** Rotas com busca por nome (`q`); as outras listam e o filtro é aqui. */
const SEARCHABLE: Record<LookupSource, boolean> = {
  eq_athlete: true,
  eq_horse: true,
  eq_competition: false,
  games: false,
};

type Row = Record<string, unknown> & { id?: string; slug?: string; name?: string };

function itemOf(source: LookupSource, r: Row): Item {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  switch (source) {
    case 'games':
      return { id: String(r.slug), label: String(r.name), detail: str(r.host_city) };
    case 'eq_athlete':
      return {
        id: String(r.id),
        label: String(r.name),
        detail: str((r.country as { name?: string } | null)?.name),
      };
    case 'eq_horse':
      return { id: String(r.id), label: String(r.name), detail: str(r.breed) };
    case 'eq_competition':
      return {
        id: String(r.id),
        label: String(r.name),
        detail: [str(r.date), str(r.venue)].filter(Boolean).join(' · ') || null,
      };
  }
}

function pathOf(source: LookupSource, term: string, locale: string): string {
  const qs = new URLSearchParams({ locale });
  switch (source) {
    case 'eq_athlete':
      qs.set('q', term);
      qs.set('limit', '10');
      return `/api/galaxie/v1/equestrian/athletes?${qs}`;
    case 'eq_horse':
      qs.set('q', term);
      qs.set('limit', '10');
      return `/api/galaxie/v1/equestrian/horses?${qs}`;
    case 'eq_competition':
      qs.set('limit', '100');
      return `/api/galaxie/v1/equestrian/competitions?${qs}`;
    case 'games':
      return `/api/galaxie/v1/multisport/games?${qs}`;
  }
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Busca de uma opção fora do catálogo de times e campeonatos (`/v1/equestrian/*`, `/v1/multisport/games`)
 * pelo proxy da demo. Cavaleiro e cavalo buscam pelo nome na API; provas e edições vêm em lista, filtrada
 * aqui pelo que se digita (a mais recente primeiro).
 */
export function LookupPicker({
  source,
  value,
  onChange,
}: {
  source: LookupSource;
  value: LookupValue | null;
  onChange: (next: LookupValue | null) => void;
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
  const searchable = SEARCHABLE[source];
  const q = searchable ? debounced : '';

  const list = useQuery({
    queryKey: ['builder-busca', source, locale, q],
    enabled: open && (!searchable || q.length >= MIN_CHARS),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(pathOf(source, q, apiLocale(locale)), { signal });
      if (!res.ok) throw new Error(`lookup ${res.status}`);
      const body = (await res.json()) as { data?: Row[] };
      return (body.data ?? []).map((r) => itemOf(source, r));
    },
  });
  const all = list.data ?? [];
  const ordered = source === 'games' ? [...all].reverse() : all;
  const items = searchable
    ? ordered
    : ordered
        .filter((i) => !debounced || norm(`${i.label} ${i.detail ?? ''}`).includes(norm(debounced)))
        .slice(0, 30);
  const tooShort = searchable && debounced.length < MIN_CHARS;

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
            <span className="truncate">{value.label}</span>
          ) : (
            <span className="text-muted-foreground">{e.entityPlaceholder}</span>
          )}
          <ChevronsUpDown className="text-muted-foreground ml-auto" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={e.entitySearch} value={term} onValueChange={setTerm} />
            <CommandList>
              {list.isFetching ? (
                <div className="flex justify-center p-3">
                  <Spinner />
                </div>
              ) : null}
              <CommandEmpty>{tooShort ? e.entityMin : e.entityEmpty}</CommandEmpty>
              {items.length && !tooShort ? (
                <CommandGroup>
                  {items.map((i) => (
                    <CommandItem
                      key={i.id}
                      value={i.id}
                      onSelect={() => {
                        onChange({ type: 'lookup', id: i.id, label: i.label });
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{i.label}</span>
                        {i.detail ? (
                          <span className="text-muted-foreground truncate text-xs">{i.detail}</span>
                        ) : null}
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
