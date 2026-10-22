'use client';

import { CalendarRange, ChevronsUpDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
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

/** Uma temporada com jogos do time (`seasons` do overview), com os textos já no idioma da demo. */
export interface SeasonOption {
  year: number;
  /** Rótulo exibido ("2025", "2025/26"). */
  label: string;
  /** Linha de apoio: jogos e se há lances. */
  hint: string;
  current: boolean;
}

/**
 * Combobox de temporada da página do time (Popover + Command, com busca pelo ano). A escolha vai para a
 * URL (`?temporada=2025`, compartilhável); a temporada corrente é a visão padrão, sem o parâmetro.
 */
export function SeasonSelect({
  options,
  value,
  basePath,
  texts,
}: {
  options: SeasonOption[];
  value: number;
  /** Caminho da página sem query string (`/times/<id>`). */
  basePath: string;
  texts: { label: string; search: string; empty: string; current: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = options.find((o) => o.year === value) ?? options[0];
  if (!selected) return null;

  function choose(option: SeasonOption) {
    setOpen(false);
    if (option.year === value) return;
    const href = option.current ? basePath : `${basePath}?temporada=${option.year}`;
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
            aria-label={`${texts.label}: ${selected.label}`}
            className="bg-background/60 min-w-32 justify-between gap-2 backdrop-blur"
          />
        }
      >
        {pending ? <Spinner className="size-3.5" /> : <CalendarRange aria-hidden />}
        <span className="text-muted-foreground">{texts.label}</span>
        <span className="font-semibold tabular-nums">{selected.label}</span>
        <ChevronsUpDown className="text-muted-foreground ml-auto" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* busca por trecho do ano: a busca difusa padrão acharia 2015 ao digitar 2025 */}
        <Command filter={(item, search) => (item.includes(search.trim()) ? 1 : 0)}>
          <CommandInput placeholder={texts.search} />
          <CommandList>
            <CommandEmpty>{texts.empty}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.year}
                  value={`${o.label} ${o.year}`}
                  data-checked={o.year === value}
                  onSelect={() => choose(o)}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 font-medium tabular-nums">
                      {o.label}
                      {o.current ? (
                        <span className="text-primary text-[10px] font-medium uppercase">
                          {texts.current}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">{o.hint}</span>
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
