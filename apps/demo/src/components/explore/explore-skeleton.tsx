import { Skeleton } from '@/components/ui/skeleton';
import { countryLayout, FEATURED_SPORT } from '@/lib/explore';
import { COUNTRIES, SPORTS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { CONFEDERATIONS, COUNTRY_GRID, FEATURED_SPORT_SPAN, SPORT_GRID } from './layout';

/** Esqueleto da home com a mesma grade bento dos cards, para nada pular quando os dados chegam. */
export function ExploreSkeleton() {
  return (
    <div className="flex flex-col gap-10 p-4 md:p-6" aria-busy>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <div className={SPORT_GRID}>
          {SPORTS.map((s) => (
            <Skeleton
              key={s.slug}
              className={cn('min-h-44 rounded-xl', s.slug === FEATURED_SPORT && FEATURED_SPORT_SPAN)}
            />
          ))}
          <Skeleton className="min-h-44 rounded-xl" />
        </div>
      </div>
      {CONFEDERATIONS.map((group) => (
        <div key={group} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-56" />
          <div className={COUNTRY_GRID}>
            {countryLayout(
              COUNTRIES.filter((c) => c.group === group).map((c) => c.code),
              'BR',
            ).map(({ code, wide }) => (
              <Skeleton key={code} className={cn('min-h-60 rounded-xl', wide && 'sm:col-span-2')} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
