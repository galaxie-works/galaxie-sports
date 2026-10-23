import { ArrowUpRight, Trophy, UserRound, Users, type LucideIcon } from 'lucide-react';

import type { Dictionary } from '@/lib/i18n/dictionary';

import { ExampleDialog } from './example-dialog';

type AppText = Dictionary['landing']['app'];

const PAGES = [
  { key: 'team', path: '/exemplo/time', icon: Users, hue: 279 },
  { key: 'competition', path: '/exemplo/campeonato', icon: Trophy, hue: 300 },
  { key: 'player', path: '/exemplo/jogador', icon: UserRound, hue: 248 },
] as const satisfies readonly { key: keyof AppText['pages']; path: string; icon: LucideIcon; hue: number }[];

/**
 * "Por dentro do app": as páginas do time, do campeonato e do jogador, navegáveis no exemplo público
 * (cópia gravada dos dados, sem a API). Cada cartão abre a página numa janela.
 */
export function AppPages({ t }: { t: AppText }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {PAGES.map(({ key, path, icon: Icon, hue }) => {
        const page = t.pages[key];
        return (
          <li key={key} className="h-full">
            <ExampleDialog
              src={path}
              title={page.title}
              description={page.body}
              closeLabel={t.close}
              fullScreenLabel={t.fullScreen}
              triggerClassName="explore-card group focus-visible:ring-ring flex h-full w-full flex-col gap-4 rounded-2xl border p-6 text-left outline-none focus-visible:ring-2"
            >
              <span
                style={{ '--hue': hue } as React.CSSProperties}
                className="bg-primary/15 text-primary grid size-12 place-items-center rounded-xl"
              >
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="text-lg font-semibold tracking-tight">{page.title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed">{page.body}</span>
              </span>
              <span className="text-primary inline-flex items-center gap-1 text-sm font-medium">
                {t.explore}
                <ArrowUpRight
                  className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </span>
            </ExampleDialog>
          </li>
        );
      })}
    </ul>
  );
}
