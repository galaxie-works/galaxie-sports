import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { SportTexture } from '@/components/explore/sport-texture';
import { SPORT_HUES } from '@/lib/explore';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { SPORTS } from '@/lib/navigation';
import { SPORT_TAGS } from '@/lib/showcase';
import { cn } from '@/lib/utils';

import { Chip } from './parts';

type Text = Dictionary['landing']['sports'];

/** Chave do nome no dicionário (camelCase) a partir do slug do esporte. */
const nameKey = (slug: string) =>
  ({ 'american-football': 'americanFootball', 'formula-1': 'formula1' })[slug] ?? slug;

/**
 * Esportes no visual dos cards do app: textura do campo ou da quadra, ícone animado (toca ao passar o
 * mouse ou focar) e o que cada esporte entrega hoje. O futebol, com a cobertura mais completa, fica em
 * destaque.
 */
export function SportsGrid({ t }: { t: Text }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-flow-dense lg:grid-cols-4">
      {SPORTS.map((sport) => {
        const featured = sport.slug === 'football';
        const Icon = sport.icon;
        const tags = SPORT_TAGS[sport.slug];
        return (
          <li
            key={sport.slug}
            data-anim-trigger
            style={{ '--hue': SPORT_HUES[sport.slug] } as React.CSSProperties}
            className={cn(
              'explore-card flex min-h-44 flex-col gap-4 overflow-hidden rounded-2xl border p-5',
              featured && 'sm:col-span-2 lg:row-span-2 lg:p-7',
              // um card largo fecha a grade (12 esportes, o futebol ocupa quatro espaços)
              sport.slug === 'formula-1' && 'sm:col-span-2',
            )}
          >
            <SportTexture
              sport={sport.slug}
              className={cn('text-[var(--tint)]', featured ? 'w-[85%] max-w-xl' : 'w-[88%]')}
            />
            <div className="flex items-start justify-between gap-2">
              <AnimatedSportIcon
                slug={sport.slug}
                className={cn('text-primary', featured ? 'size-16 lg:size-20' : 'size-11')}
              >
                <Icon />
              </AnimatedSportIcon>
              {featured ? <Chip tone="brand">{t.featured}</Chip> : null}
            </div>
            <div className="mt-auto flex flex-col gap-3">
              <h3
                className={cn('font-semibold tracking-tight', featured ? 'text-3xl lg:text-4xl' : 'text-lg')}
              >
                {t.names[nameKey(sport.slug) as keyof Text['names']]}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li key={tag}>
                    <Chip className={featured ? 'text-sm' : undefined}>{t.tags[tag]}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
