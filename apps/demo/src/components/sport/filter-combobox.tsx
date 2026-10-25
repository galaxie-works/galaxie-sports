'use client';

import { ChevronsUpDown, Trophy } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

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

export interface FilterOption {
  value: string;
  label: string;
  /** Linha de apoio (ex.: "12 jogos"). */
  hint: string;
}

/**
 * Filtro com busca (Popover + Command) que grava a escolha num parâmetro da URL (compartilhável), mantendo os
 * outros e limpando os de `reset` (trocar a competição volta ao primeiro dia e à primeira página).
 */
export function FilterCombobox({
  param,
  value,
  options,
  reset = [],
  texts,
}: {
  param: string;
  value: string | null;
  options: FilterOption[];
  reset?: string[];
  texts: { label: string; all: string; search: string; empty: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = options.find((o) => o.value === value);

  function choose(next: string | null) {
    setOpen(false);
    if (next === value) return;
    const query = new URLSearchParams(current);
    for (const key of reset) query.delete(key);
    if (next) query.set(param, next);
    else query.delete(param);
    const href = query.size ? `${pathname}?${query}` : pathname;
    startTransition(() => router.push(href, { scroll: false }));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={`${texts.label}: ${selected?.label ?? texts.all}`}
            className="bg-background/60 max-w-full min-w-48 justify-between gap-2 backdrop-blur"
          />
        }
      >
        {pending ? <Spinner className="size-3.5" /> : <Trophy aria-hidden />}
        <span className="text-muted-foreground">{texts.label}</span>
        <span className="truncate font-semibold">{selected?.label ?? texts.all}</span>
        <ChevronsUpDown className="text-muted-foreground ml-auto" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={texts.search} />
          <CommandList>
            <CommandEmpty>{texts.empty}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={texts.all} data-checked={!value} onSelect={() => choose(null)}>
                {texts.all}
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  data-checked={o.value === value}
                  onSelect={() => choose(o.value)}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate">{o.label}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{o.hint}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
