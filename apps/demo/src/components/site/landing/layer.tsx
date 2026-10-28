import {
  ArrowDown,
  ArrowRight,
  Database,
  Flag,
  LayoutTemplate,
  PlayCircle,
  Sparkles,
  Tv,
  type LucideIcon,
} from 'lucide-react';

import type { Dictionary } from '@/lib/i18n/dictionary';
import { cn } from '@/lib/utils';

import { Chip } from './parts';

type Text = Dictionary['landing']['layer'];

const FLOW = [
  { key: 'source', icon: Database },
  { key: 'galaxie', icon: Sparkles },
  { key: 'product', icon: LayoutTemplate },
] as const satisfies readonly { key: keyof Text['flow']; icon: LucideIcon }[];

const PILLARS = [
  { key: 'watch', icon: Tv, hue: 279 },
  { key: 'semantic', icon: Flag, hue: 300 },
  { key: 'context', icon: Sparkles, hue: 248 },
  { key: 'related', icon: PlayCircle, hue: 320 },
] as const satisfies readonly { key: keyof Text['pillars']; icon: LucideIcon; hue: number }[];

/**
 * A camada Galaxie: o dado, tudo o que a Galaxie põe por cima (a lista de recursos no cartão do meio) e onde
 * o cliente usa, seguido dos quatro pilares e de uma chamada em destaque.
 */
export function Layer({ t }: { t: Text }) {
  return (
    <div className="flex flex-col gap-10">
      <ol className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1.8fr_auto_1fr]">
        {FLOW.map(({ key, icon: Icon }, i) => {
          const step = t.flow[key];
          const core = key === 'galaxie';
          return (
            <li key={key} className="contents">
              {i > 0 ? (
                <span aria-hidden className="text-primary grid place-items-center">
                  <ArrowRight className="hidden size-5 lg:block" />
                  <ArrowDown className="size-5 lg:hidden" />
                </span>
              ) : null}
              <div
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border p-5 backdrop-blur-sm sm:p-6',
                  core ? 'explore-card border-primary/40' : 'bg-card/60',
                )}
              >
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-xl',
                    core ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="text-lg font-semibold tracking-tight">{step.title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed text-pretty">{step.body}</span>
                {core ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {Object.values(t.features).map((feature) => (
                      <li key={feature}>
                        <Chip tone="brand">{feature}</Chip>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <ul className="grid gap-4 sm:grid-cols-2">
        {PILLARS.map(({ key, icon: Icon, hue }) => {
          const pillar = t.pillars[key];
          return (
            <li
              key={key}
              style={{ '--hue': hue } as React.CSSProperties}
              className="explore-card flex gap-4 rounded-2xl border p-5 sm:p-6"
            >
              <span className="bg-primary/15 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex flex-col gap-1.5">
                <span className="text-lg font-semibold tracking-tight">{pillar.title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed text-pretty">
                  {pillar.body}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="explore-card rounded-3xl border px-6 py-10 text-center text-2xl font-semibold tracking-tight text-balance sm:px-12 sm:text-4xl">
        <span className="from-foreground to-primary bg-gradient-to-r bg-clip-text text-transparent">
          {t.note}
        </span>
      </p>
    </div>
  );
}
