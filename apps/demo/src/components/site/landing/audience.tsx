import { Clapperboard, Network, Newspaper, type LucideIcon } from 'lucide-react';

import type { Dictionary } from '@/lib/i18n/dictionary';

type Text = Dictionary['landing']['audience'];

const SEGMENTS = [
  { key: 'portals', icon: Newspaper },
  { key: 'media', icon: Clapperboard },
  { key: 'networks', icon: Network },
] as const satisfies readonly { key: keyof Text['segments']; icon: LucideIcon }[];

/** Para quem é: os três tipos de cliente e o que cada um ganha com a camada. */
export function Audience({ t }: { t: Text }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {SEGMENTS.map(({ key, icon: Icon }) => {
        const segment = t.segments[key];
        return (
          <li key={key} className="bg-card/60 flex flex-col gap-4 rounded-2xl border p-6 backdrop-blur-sm">
            <span className="bg-primary/15 text-primary grid size-12 place-items-center rounded-xl">
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-lg font-semibold tracking-tight">{segment.title}</span>
              <span className="text-muted-foreground text-sm leading-relaxed text-pretty">
                {segment.body}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
