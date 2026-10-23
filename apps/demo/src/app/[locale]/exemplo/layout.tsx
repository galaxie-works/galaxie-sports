import { ExampleProvider } from '@/components/example/example-provider';
import { buttonVariants } from '@/components/ui/button';
import { SidebarProvider } from '@/components/ui/sidebar';
import { getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { LOGO_PATH } from '@/lib/site';
import { cn } from '@/lib/utils';

/** Data da cópia gravada (`lib/example/snapshot.json`). */
const SNAPSHOT_DATE = '2026-10-23';

/** Bandeiras que o exemplo serve de /public/flags (os países da navegação; os demais mostram o código). */
const FLAGS = Object.fromEntries(
  ['br', 'ar', 'uy', 'cl', 'co', 'py', 'pe', 'ec', 'bo', 've', 'mx'].map((c) => [
    c.toUpperCase(),
    `/flags/${c}.svg`,
  ]),
);

/**
 * Exemplo público: as páginas do app com a cópia gravada dos dados, sem login e sem a API. Uma barra no
 * topo diz o que é e leva de volta à apresentação ou ao login (`target="_top"`: o exemplo também abre
 * dentro do modal da apresentação). Sem barra lateral (o botão dela fica escondido), sem busca e sem
 * os botões "Ver código".
 */
export default async function ExampleLayout({ children }: LayoutProps<'/[locale]/exemplo'>) {
  const { locale, t } = await getI18n();
  const e = t.landing.example;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(SNAPSHOT_DATE),
  );
  return (
    <SidebarProvider className="flex-col [&_[data-sidebar=trigger]]:hidden [&_[data-sidebar=trigger]+[data-slot=separator]]:hidden">
      <ExampleProvider flags={FLAGS} locked={e.locked} signIn={e.signIn}>
        <div className="bg-primary/10 border-primary/20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 text-sm">
          <a href="/sobre" target="_top" className="shrink-0" aria-label={e.back}>
            <img src={LOGO_PATH} alt="" width={88} height={24} className="h-5 w-auto object-contain" />
          </a>
          <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
            {e.badge}
          </span>
          <span className="text-muted-foreground min-w-0 flex-1 text-xs sm:text-sm">
            {fill(e.note, { date })}
          </span>
          <a href="/login" target="_top" className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
            {e.signIn}
          </a>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </ExampleProvider>
    </SidebarProvider>
  );
}
