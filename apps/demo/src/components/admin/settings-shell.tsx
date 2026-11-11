'use client';

import { PanelLeftClose } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { useSettingsSidebarMode } from '@/components/app-shell/app-sidebar-state';
import { GroupedSideNav } from '@/components/settings/grouped-nav';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useI18n } from '@/lib/i18n/client';
import { settingsNavIdOf } from '@/lib/ops/settings-items';

import {
  SETTINGS_MENU_STORAGE,
  SettingsColumnProvider,
  SettingsCountsProvider,
  SettingsSearchField,
  settingsNavGroups,
  settingsNavPinned,
  type SettingsNavCounts,
} from './settings-nav';

/** Onde fica lembrado o ⇤ da coluna de Ajustes. */
const COLUMN_STORAGE = 'galaxie:ajustes:coluna';

function SettingsNav({ active }: { active: string }) {
  const { t } = useI18n();
  const nav = t.ops.nav;
  return (
    <GroupedSideNav
      groups={settingsNavGroups(nav)}
      pinned={settingsNavPinned(nav)}
      active={active}
      label={nav.label}
      storageKey={SETTINGS_MENU_STORAGE}
      bare
    />
  );
}

/**
 * O item aceso vem do caminho (dado de URL, atrás de Suspense), lido só depois de hidratar: a rota alcançada pela
 * reescrita do proxy tem outro caminho no HTML prerenderizado (o mesmo cuidado do menu do app).
 */
function CurrentSettingsNav() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  return <SettingsNav active={(hydrated ? settingsNavIdOf(pathname) : null) ?? ''} />;
}

/**
 * Moldura de Ajustes (bloco `app-shell-14`, montado com componentes gratuitos, #1067): o menu do app recolhe para o
 * trilho de ícones e o menu de Ajustes vira a segunda coluna, com a altura da tela e rolagem própria. No topo dela, o
 * título, a busca e o ⇤ que esconde a coluna (lembrado no navegador). No celular a coluna some e o menu vai para a
 * gaveta, no topo de cada página (`SettingsArea`).
 */
export function SettingsShell({
  counts,
  children,
}: {
  counts: Promise<SettingsNavCounts>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const nav = t.ops.nav;
  useSettingsSidebarMode();
  const [column, setColumn] = useLocalStorage(COLUMN_STORAGE, 'visible');
  const hidden = column === 'hidden';
  return (
    <SettingsCountsProvider value={counts}>
      <SettingsColumnProvider value={{ hidden, setHidden: (h) => setColumn(h ? 'hidden' : null) }}>
        <div className="flex min-h-svh min-w-0">
          {hidden ? null : (
            <aside className="bg-background sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r md:flex">
              <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
                <span className="truncate text-sm font-semibold">{nav.title}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={nav.hide}
                  title={nav.hide}
                  onClick={() => setColumn('hidden')}
                >
                  <PanelLeftClose aria-hidden="true" />
                </Button>
              </div>
              <div className="shrink-0 px-2 pt-2">
                <SettingsSearchField />
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-2">
                  <Suspense fallback={<SettingsNav active="" />}>
                    <CurrentSettingsNav />
                  </Suspense>
                </div>
              </ScrollArea>
            </aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </SettingsColumnProvider>
    </SettingsCountsProvider>
  );
}
