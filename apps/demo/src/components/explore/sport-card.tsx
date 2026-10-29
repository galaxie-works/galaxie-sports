import type { ExploreCompetition, ExploreSport } from '@galaxie/contracts';
import Link from 'next/link';

import { LiveDot } from '@/components/live/live-nav-item';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { compactNumber, sportUnits } from '@/lib/explore';
import { initials } from '@/lib/format';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill, plural } from '@/lib/i18n/text';
import type { NavItem, SportNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { SportTexture, TEXTURE_TONE } from './sport-texture';

type ExploreText = Dictionary['nav']['explore'];

/** Base dos cards do Explorar: o card do shadcn (`tile-card`), com o hover e o foco de sempre. */
export const TILE =
  'tile-card group/tile focus-visible:ring-ring flex flex-col overflow-hidden rounded-xl border outline-none focus-visible:ring-2';

/**
 * Ícone do esporte em cinza, que ganha cor no hover do card. O `grayscale` cobre a animação (Lottie), que
 * traz as cores dela e ignora a cor do texto.
 */
export const TILE_ICON =
  'text-muted-foreground opacity-80 grayscale transition-[color,opacity,filter] group-hover/tile:text-foreground group-hover/tile:opacity-100 group-hover/tile:grayscale-0';

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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          'font-semibold tracking-tight tabular-nums',
          size === 'lg' ? 'text-2xl md:text-3xl' : 'text-lg leading-tight',
        )}
      >
        {compactNumber(locale, value)}
      </span>
      <span className="text-muted-foreground truncate text-xs leading-tight">{label}</span>
    </div>
  );
}

/**
 * Contadores em texto ("33 competições   166 jogos em 7 dias"), para os cards compactos: cada um quebra
 * para a linha de baixo quando o card é estreito, sem cortar a unidade.
 */
export function StatLine({
  items,
  locale,
  className,
}: {
  items: { value: number; label: string }[];
  locale: Locale;
  className?: string;
}) {
  return (
    <p className={cn('text-muted-foreground flex flex-wrap gap-x-3 text-xs leading-relaxed', className)}>
      {items.map((s) => (
        <span key={s.label} className="whitespace-nowrap">
          <span className="text-foreground font-medium tabular-nums">{compactNumber(locale, s.value)}</span>{' '}
          {s.label}
        </span>
      ))}
    </p>
  );
}

/** "3 ao vivo" com o ponto pulsando, só em texto (sem o selo preenchido); sem jogo ao vivo, nada. */
export function LivePill({ count, t, className }: { count: number; t: ExploreText; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn('text-live inline-flex shrink-0 items-center gap-1.5 text-xs font-medium', className)}
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
        <LeagueLogo key={c.id} competition={c} size="xs" />
      ))}
    </div>
  );
}

/** Competições em destaque do card grande: lista simples, com divisórias, em vez de caixinhas. */
function CompetitionList({ items }: { items: ExploreCompetition[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.id} className="flex min-w-0 items-center gap-2.5 border-t py-2">
          <LeagueLogo competition={c} size="xs" />
          <span className="truncate text-sm">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Card de esporte: ícone animado (toca no hover), nome, competições e jogos da semana numa linha e os
 * logos das competições em destaque. O card grande (futebol) mostra os três contadores e a lista de
 * competições. Sem nada no banco, apresenta o espelho compatível.
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
  const competitions = data && {
    value: data.competitions,
    label: plural(locale, data.competitions, t.units.competitions),
  };
  const participants = data && {
    value: data.participants,
    label: plural(locale, data.participants, t.units[units.participants]),
  };
  const upcoming = data && {
    value: data.upcoming,
    label: plural(locale, data.upcoming, t.units[units.events]),
  };

  return (
    <Link
      href={sport.href}
      className={cn(TILE, 'min-h-40 gap-4 p-4', featured && 'gap-6 p-5 md:p-6', className)}
    >
      <SportTexture
        sport={sport.slug}
        className={cn(TEXTURE_TONE, featured ? 'w-[70%] max-w-lg' : 'w-[80%]')}
      />
      <div className="flex items-start justify-between gap-2">
        <AnimatedSportIcon slug={sport.slug} className={cn(TILE_ICON, featured ? 'size-12' : 'size-8')}>
          <Icon />
        </AnimatedSportIcon>
        <LivePill count={data?.live ?? 0} t={t} />
      </div>

      <div className={cn('mt-auto flex flex-col gap-2', featured && 'gap-5')}>
        <h3 className={cn('font-semibold tracking-tight', featured ? 'text-2xl' : 'text-base')}>{label}</h3>
        {hasData ? (
          featured ? (
            <>
              <div className="grid max-w-md grid-cols-3 gap-4">
                {[competitions!, participants!, upcoming!].map((s) => (
                  <Stat key={s.label} {...s} locale={locale} size="lg" />
                ))}
              </div>
              {data.top_competitions.length ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">{t.featured}</span>
                  <CompetitionList items={data.top_competitions} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <StatLine items={[competitions!, upcoming!]} locale={locale} />
              {data.top_competitions.length ? <CompetitionLogos items={data.top_competitions} /> : null}
            </>
          )
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t.mirror}</span>
            <code className="bg-muted text-muted-foreground w-fit rounded px-1.5 py-0.5 font-mono text-xs">
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
    <Link href={item.href} className={cn(TILE, 'min-h-40 gap-4 p-4', className)}>
      <SportTexture sport="multisport" className={cn(TEXTURE_TONE, 'w-[80%]')} />
      <Icon className={cn(TILE_ICON, 'size-8')} strokeWidth={1.5} aria-hidden />
      <div className="mt-auto flex flex-col gap-2">
        <h3 className="text-base font-semibold tracking-tight">{label}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </Link>
  );
}
