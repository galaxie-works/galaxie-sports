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
 * Recursos da camada em duas faixas que correm em sentidos opostos. Cada faixa leva a lista duas vezes (a
 * segunda escondida dos leitores de tela) para o loop emendar.
 */
function FeatureMarquee({ features }: { features: string[] }) {
  const half = Math.ceil(features.length / 2);
  const rows = [features.slice(0, half), features.slice(half)];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row, r) => (
        <div key={r} className="landing-marquee overflow-hidden">
          <div
            className="landing-marquee-track flex w-max gap-2.5"
            data-reverse={r === 1 ? '' : undefined}
            style={{ '--marquee-duration': `${row.length * 4}s` } as React.CSSProperties}
          >
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1 || undefined}
                data-copy={copy === 1 ? '' : undefined}
                className="flex shrink-0 gap-2.5"
              >
                {row.map((feature) => (
                  <li key={feature}>
                    <Chip tone="brand" className="px-4 py-1.5 text-sm">
                      {feature}
                    </Chip>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A camada Galaxie: o dado, a camada e onde o cliente usa; embaixo, todos os recursos numa faixa em
 * movimento, os quatro pilares e uma chamada em destaque.
 */
export function Layer({ t }: { t: Text }) {
  return (
    <div className="flex flex-col gap-10">
      <ol className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
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
              </div>
            </li>
          );
        })}
      </ol>

      <FeatureMarquee features={Object.values(t.features)} />

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
