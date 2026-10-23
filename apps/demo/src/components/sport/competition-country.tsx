import type { Event } from '@galaxie/contracts';

import { countryHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';

type Country = NonNullable<NonNullable<Event['competition']>['country']>;

/**
 * Bandeira (e nome, com `label`) do país de uma competição: "Liga Leumit" ou "First NL" sozinhas não
 * dizem de onde são. Vem pronta da API em `competition.country`, para qualquer país (não só os do menu).
 * Competições internacionais (WORLD) ficam sem nada.
 */
export function CompetitionCountry({
  country,
  label = false,
  className,
}: {
  country: Country | null | undefined;
  label?: boolean;
  className?: string;
}) {
  // internacionais (WORLD) dispensam: Champions e Libertadores dizem por si de onde são
  if (!country || !countryHref(country.code) || (!country.flag && !label)) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)} title={country.name}>
      {country.flag ? (
        <img
          src={country.flag}
          alt={label ? '' : country.name}
          draggable={false}
          className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-white/15"
        />
      ) : null}
      {label ? <span>{country.name}</span> : null}
    </span>
  );
}
