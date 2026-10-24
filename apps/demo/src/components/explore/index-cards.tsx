import type { ExploreCountry } from '@galaxie/contracts';
import Link from 'next/link';

import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { SPORT_HUES } from '@/lib/explore';
import type { FamilyStats } from '@/lib/explore-index';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { plural } from '@/lib/i18n/text';
import { SPORTS, type CountryNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { LeagueLogo, LivePill, Stat } from './sport-card';
import { SportTexture } from './sport-texture';

const CARD =
  'explore-card group/entry focus-visible:ring-ring hover:border-primary/40 relative flex w-full flex-col overflow-hidden rounded-xl border p-4 transition-colors outline-none focus-visible:ring-2';

/**
 * Família de esporte no índice (`/esportes`): o card inteiro leva à página da família. Os números são a soma
 * dos esportes dela no resumo; família com mais de um esporte (Basquete com a NBA) lista cada um.
 */
export function FamilyCard({ stats, t, locale }: { stats: FamilyStats; t: Dictionary; locale: Locale }) {
  const te = t.nav.explore;
  const slug = stats.family.sports[0];
  const Icon = SPORTS.find((s) => s.slug === slug)!.icon;
  return (
    <Link
      href={stats.href}
      style={{ '--hue': SPORT_HUES[slug] } as React.CSSProperties}
      className={cn(CARD, 'min-h-48 gap-4')}
    >
      <SportTexture sport={slug} className="w-[88%] text-[var(--tint)]" />
      <div className="flex items-start justify-between gap-2">
        <AnimatedSportIcon slug={slug} className="text-primary size-11">
          <Icon />
        </AnimatedSportIcon>
        <LivePill count={stats.live} t={te} />
      </div>
      <div className="mt-auto flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.nav.families[stats.family.id]}</h2>
        <div className="grid grid-cols-2 gap-2">
          <Stat
            value={stats.competitions}
            label={plural(locale, stats.competitions, te.units.competitions)}
            locale={locale}
          />
          <Stat
            value={stats.upcoming}
            label={plural(locale, stats.upcoming, te.units.games)}
            locale={locale}
          />
        </div>
        {stats.sports.length > 1 ? (
          <ul className="text-muted-foreground flex flex-col gap-0.5 border-t pt-2 text-xs">
            {stats.sports.map((s) => (
              <li key={s.slug} className="flex items-center justify-between gap-2">
                <span className="text-foreground/90 truncate">{t.nav.sports[s.slug]}</span>
                <span className="shrink-0 tabular-nums">
                  {s.data?.competitions ?? 0}{' '}
                  {plural(locale, s.data?.competitions ?? 0, te.units.competitions)} · {s.data?.upcoming ?? 0}{' '}
                  {plural(locale, s.data?.upcoming ?? 0, te.units.games)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Link>
  );
}

/** País no índice (`/paises`): bandeira, liga principal, competições e jogos da semana; o card leva ao país. */
export function CountryIndexCard({
  country,
  name,
  data,
  t,
  locale,
}: {
  country: CountryNav;
  name: string;
  data: ExploreCountry | undefined;
  t: Dictionary;
  locale: Locale;
}) {
  const te = t.nav.explore;
  const main = data?.main_competition ?? null;
  return (
    <Link href={country.href} className={cn(CARD, 'gap-3')}>
      <div className="flex items-center gap-3">
        {data?.flag ? (
          <img
            src={data.flag}
            alt=""
            draggable={false}
            className="h-7 w-10 shrink-0 rounded-[3px] object-cover shadow-sm ring-1 ring-white/15"
          />
        ) : (
          <span className="bg-muted h-7 w-10 shrink-0 rounded-[3px]" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate font-semibold">{name}</h3>
          {main ? (
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <LeagueLogo competition={main} size="xs" />
              <span className="truncate">{main.name}</span>
            </span>
          ) : null}
        </div>
        <LivePill count={data?.live ?? 0} t={te} />
      </div>
      {data ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            value={data.competitions}
            label={plural(locale, data.competitions, te.units.competitions)}
            locale={locale}
          />
          <Stat value={data.upcoming} label={plural(locale, data.upcoming, te.units.games)} locale={locale} />
        </div>
      ) : null}
    </Link>
  );
}
