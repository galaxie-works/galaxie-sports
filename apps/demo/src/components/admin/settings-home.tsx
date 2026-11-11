'use client';

import Link from 'next/link';

import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

import { settingsNavGroups } from './settings-nav';

/**
 * Mapa dos 9 grupos de Ajustes (o mesmo menu, em cartões), abaixo dos cartões do que pede ação no Início (#1073):
 * quem chega por `/ajustes` no celular, sem a coluna do menu, vê todas as áreas.
 */
export function SettingsGroupsMap() {
  const { t } = useI18n();
  const nav = t.ops.nav;
  return (
    <section aria-labelledby="ajustes-areas" className="flex flex-col gap-3">
      <h2 id="ajustes-areas" className="text-base font-semibold">
        {t.ops.home.groupsTitle}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {settingsNavGroups(nav).map((group) => (
          <Frame key={group.id}>
            <FramePanel className="p-0">
              <FrameHeader className="px-4 pt-4">
                <FrameTitle>{group.label}</FrameTitle>
              </FrameHeader>
              <ul className="flex flex-col pb-1">
                {group.items.map(({ id, href, icon: Icon, label, muted, badge }) => (
                  <li key={id}>
                    <Link
                      href={href}
                      onClick={topLevelClick(href)}
                      className="hover:bg-muted flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                    >
                      <Icon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                      <span className={cn('min-w-0 flex-1 truncate', muted && 'text-muted-foreground')}>
                        {label}
                      </span>
                      {badge}
                    </Link>
                  </li>
                ))}
              </ul>
            </FramePanel>
          </Frame>
        ))}
      </div>
    </section>
  );
}
