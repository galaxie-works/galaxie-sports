import type { ExploreCompetition, ExploreSport } from '@galaxie/contracts';
import Link from 'next/link';

import { LiveDot } from '@/components/live/live-nav-item';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { compactNumber, SPORT_HUES, sportUnits } from '@/lib/explore';
import { initials } from '@/lib/format';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill, plural } from '@/lib/i18n/text';
import type { NavItem, SportNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { SportTexture } from './sport-texture';

type ExploreText = Dictionary['nav']['explore'];

/** Número grande com a unidade embaixo ("9.094 / times"). */
export function Stat({
  value,
  label,
  locale,
  size = 'md',
}: {
  value: number;
  label: string;
  locale: Locale;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn(
          'font-semibold tracking-tight tabular-nums',
          size === 'lg' ? 'text-2xl md:text-3xl' : 'text-lg leading-tight',
        )}
      >
        {compactNumber(locale, value)}
      </span>
      <span className="text-muted-foreground truncate text-[11px] leading-tight">{label}</span>
    </div>
  );
}

/** Selo "3 ao vivo" com o ponto pulsando (sem ele, nada). */
export function LivePill({ count, t, className }: { count: number; t: ExploreText; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'border-live/40 bg-live/15 text-live inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        className,
      )}
    >
      <LiveDot on className="size-2" />
      {fill(t.live, { count })}
    </span>
  );
}

const LOGO_BOX = { xs: 'size-6 p-0.5', sm: 'size-8 p-1', md: 'size-10 p-1.5' } as const;

/**
 * Logo de competição num "chip" claro: boa parte dos logos (Champions, Premier League…) é escura e
 * sumiria no fundo do tema.
 */
export function LeagueLogo({
  competition,
  size = 'sm',
}: {
  competition: Pick<ExploreCompetition, 'logo' | 'name'>;
  size?: keyof typeof LOGO_BOX;
}) {
  return (
    <span
      title={competition.name}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-white/90 shadow-sm',
        LOGO_BOX[size],
      )}
    >
      {competition.logo ? (
        <img src={competition.logo} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        <span className="text-[9px] font-semibold text-zinc-700">{initials(competition.name)}</span>
      )}
    </span>
  );
}

function CompetitionLogos({ items }: { items: ExploreCompetition[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {items.map((c) => (
        <LeagueLogo key={c.id} competition={c} />
      ))}
    </div>
  );
}

function CompetitionList({ items }: { items: ExploreCompetition[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((c) => (
        <li
          key={c.id}
          className="bg-background/50 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 ring-1 ring-white/10"
        >
          <LeagueLogo competition={c} />
          <span className="truncate text-sm font-medium">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Card de esporte: ícone animado (toca no hover), contadores reais (catálogo, participantes, jogos da
 * semana e ao vivo) e as competições em destaque. Sem nada no banco, apresenta o espelho compatível.
 */
export function SportCard({
  sport,
  label,
  data,
  featured = false,
  t,
  locale,
  className,
}: {
  sport: SportNav;
  label: string;
  data: ExploreSport | undefined;
  featured?: boolean;
  t: ExploreText;
  locale: Locale;
  className?: string;
}) {
  const Icon = sport.icon;
  const units = sportUnits(sport.slug);
  const hasData = !!data && (data.competitions > 0 || data.participants > 0);
  const stats = data
    ? [
        { value: data.competitions, label: plural(locale, data.competitions, t.units.competitions) },
        {
          value: data.participants,
          label: plural(locale, data.participants, t.units[units.participants]),
        },
        { value: data.upcoming, label: plural(locale, data.upcoming, t.units[units.events]) },
      ]
    : [];

  return (
    <Link
      href={sport.href}
      style={{ '--hue': SPORT_HUES[sport.slug] } as React.CSSProperties}
      className={cn(
        'explore-card group/entry focus-visible:ring-ring flex min-h-44 flex-col overflow-hidden rounded-xl border p-4 outline-none focus-visible:ring-2',
        featured && 'gap-5 p-5 md:p-6',
        className,
      )}
    >
      <SportTexture
        sport={sport.slug}
        className={cn('text-[var(--tint)]', featured ? 'w-[80%] max-w-xl' : 'w-[88%]')}
      />
      <div className="flex items-start justify-between gap-2">
        <AnimatedSportIcon
          slug={sport.slug}
          className={cn('text-primary', featured ? 'size-16 md:size-20' : 'size-11')}
        >
          <Icon />
        </AnimatedSportIcon>
        <LivePill count={data?.live ?? 0} t={t} />
      </div>

      <div className={cn('mt-auto flex flex-col gap-3', featured && 'gap-5')}>
        <h3 className={cn('font-semibold tracking-tight', featured ? 'text-2xl md:text-3xl' : 'text-base')}>
          {label}
        </h3>
        {hasData ? (
          <>
            {/* no celular o card tem meia largura: só o número de competições, sem a grade de contadores */}
            {featured ? null : (
              <p className="text-muted-foreground text-xs sm:hidden">
                <span className="text-foreground font-semibold tabular-nums">{stats[0]?.value}</span>{' '}
                {stats[0]?.label}
              </p>
            )}
            <div className={cn('grid grid-cols-3 gap-2', featured ? 'max-w-lg gap-4' : 'max-sm:hidden')}>
              {stats.map((s) => (
                <Stat key={s.label} {...s} locale={locale} size={featured ? 'lg' : 'md'} />
              ))}
            </div>
            {data.top_competitions.length ? (
              featured ? (
                <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t.featured}
                  </span>
                  <CompetitionList items={data.top_competitions} />
                </div>
              ) : (
                <CompetitionLogos items={data.top_competitions} />
              )
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-foreground/80 text-xs font-medium">{t.mirror}</span>
            <code className="text-muted-foreground w-fit rounded bg-black/25 px-1.5 py-0.5 font-mono text-[11px]">
              {`/mirror/${sport.slug}`}
            </code>
          </div>
        )}
      </div>
    </Link>
  );
}

/** Card do multiesporte (Olimpíadas e Pan): mesmo visual, com a pista de atletismo ao fundo. */
export function MultisportCard({
  item,
  label,
  description,
  className,
}: {
  item: NavItem;
  label: string;
  description: string;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      style={{ '--hue': SPORT_HUES.multisport } as React.CSSProperties}
      className={cn(
        'explore-card focus-visible:ring-ring flex min-h-44 flex-col overflow-hidden rounded-xl border p-4 outline-none focus-visible:ring-2',
        className,
      )}
    >
      <SportTexture sport="multisport" className="w-[88%] text-[var(--tint)]" />
      <Icon className="text-primary size-11" strokeWidth={1.5} aria-hidden />
      <div className="mt-auto flex flex-col gap-1">
        <h3 className="text-base font-semibold tracking-tight">{label}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </Link>
  );
}
