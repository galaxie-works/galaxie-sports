'use client';

import Link from 'next/link';

import { CountryFlag } from '@/components/sport/country-flag';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface MarketTab {
  /** Código do `?pais=` (GB para a Inglaterra). */
  code: string;
  /** Código da navegação, que tem a bandeira (GB-ENG). */
  flag: string;
  name: string;
}

/** Países do Onde assistir: bandeira com o nome no tooltip; o país aberto fica destacado. */
export function MarketTabs({
  eventId,
  markets,
  active,
}: {
  eventId: string;
  markets: MarketTab[];
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {markets.map((m) => {
        const selected = m.code === active;
        return (
          <Tooltip key={m.code}>
            <TooltipTrigger
              render={
                <Link
                  href={`/eventos/${eventId}?pais=${m.code}`}
                  scroll={false}
                  aria-label={m.name}
                  aria-current={selected ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-center rounded-md border p-1 transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 ring-primary/40 ring-1'
                      : 'hover:bg-accent opacity-70 hover:opacity-100',
                  )}
                />
              }
            >
              <CountryFlag code={m.flag} size="md" />
            </TooltipTrigger>
            <TooltipContent side="top">{m.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
