'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { CountryFlag } from '@/components/sport/country-flag';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/** Uma linha da relevância por país, já com textos prontos (o servidor monta a partir da API). */
export interface CountryRelevanceRow {
  market: string;
  /** Código da bandeira na navegação (GB → GB-ENG). */
  flag: string;
  name: string;
  score: number;
  bonus: number;
  reasons: { code: string; points: number; text: string }[];
  /** País do idioma de quem vê (pt-BR → BR, es-AR → AR). */
  highlighted: boolean;
  /** Rótulo acessível da barra ("Relevância em Brasil"). */
  label: string;
}

/** Quantos países aparecem antes do "ver todos" (o destacado entra sempre). */
const VISIBLE = 4;

function Row({ row, texts }: { row: CountryRelevanceRow; texts: { yourMarket: string; noBonus: string } }) {
  return (
    <li
      className={cn(
        '-mx-2 flex flex-col gap-1 rounded-md px-2 py-1.5',
        row.highlighted && 'bg-primary/5 ring-primary/25 ring-1',
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <CountryFlag code={row.flag} />
        <span className="truncate font-medium">{row.name}</span>
        {row.highlighted ? (
          <span className="text-primary shrink-0 text-[10px] font-medium uppercase">{texts.yourMarket}</span>
        ) : null}
        <span className="ml-auto font-semibold tabular-nums">{row.score}</span>
        <span className="text-muted-foreground w-7 shrink-0 text-right font-mono text-[11px] tabular-nums">
          {row.bonus ? `+${row.bonus}` : '+0'}
        </span>
      </div>
      <div
        role="meter"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={row.score}
        className="bg-muted h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full', row.highlighted ? 'bg-primary' : 'bg-primary/60')}
          style={{ width: `${row.score}%` }}
        />
      </div>
      <ul className="flex flex-wrap gap-1">
        {row.reasons.length ? (
          row.reasons.map((r) => (
            <li
              key={r.code}
              className="text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[11px] leading-tight"
            >
              <span className="text-foreground font-mono tabular-nums">+{r.points}</span> {r.text}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground text-[11px] leading-tight">{texts.noBonus}</li>
        )}
      </ul>
    </li>
  );
}

/**
 * Lista da relevância por país, da maior nota para a menor: os primeiros (e o país do idioma) à vista,
 * o resto atrás do "ver todos". Independente do país escolhido no "Onde assistir".
 */
export function RelevanceCountries({
  rows,
  texts,
}: {
  rows: CountryRelevanceRow[];
  texts: { yourMarket: string; noBonus: string; showAll: string; showLess: string };
}) {
  const [open, setOpen] = useState(false);
  const shown = rows.filter((r, i) => i < VISIBLE || r.highlighted);
  const rest = rows.filter((r) => !shown.includes(r));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {shown.map((r) => (
          <Row key={r.market} row={r} texts={texts} />
        ))}
      </ul>
      {rest.length ? (
        <>
          <CollapsibleContent>
            <ul className="flex flex-col gap-1">
              {rest.map((r) => (
                <Row key={r.market} row={r} texts={texts} />
              ))}
            </ul>
          </CollapsibleContent>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 self-start rounded-sm text-xs outline-none focus-visible:ring-2">
            {open ? texts.showLess : texts.showAll}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </CollapsibleTrigger>
        </>
      ) : null}
    </Collapsible>
  );
}
