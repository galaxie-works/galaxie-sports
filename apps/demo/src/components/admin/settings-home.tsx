'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, use } from 'react';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n/client';
import { settingsHref } from '@/lib/ops/settings-items';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

import { settingsNavGroups, useSettingsCounts } from './settings-nav';

function Pending() {
  const { t } = useI18n();
  const T = t.ops.home;
  const promise = useSettingsCounts();
  const counts = promise ? use(promise) : null;
  const rows = [
    { n: counts?.review ?? null, label: T.review, href: settingsHref('review') },
    { n: counts?.lineup ?? null, label: T.requests, href: `${settingsHref('lineup')}?aba=pedidos` },
  ];
  if (!counts || rows.every((r) => r.n === null)) {
    return <p className="text-muted-foreground px-4 pb-4 text-sm">{T.unavailable}</p>;
  }
  const open = rows.filter((r) => r.n);
  if (!open.length) return <p className="text-muted-foreground px-4 pb-4 text-sm">{T.nothing}</p>;
  return (
    <ul className="flex flex-col">
      {open.map((r) => (
        <li key={r.href} className="border-t">
          <Link
            href={r.href}
            onClick={topLevelClick(r.href)}
            className="hover:bg-muted flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
          >
            <span>{r.label}</span>
            <span className="flex items-center gap-2">
              <Badge variant="warning-light" radius="full" className="tabular-nums">
                {r.n}
              </Badge>
              <ArrowRight aria-hidden="true" className="text-muted-foreground size-4" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Início de Ajustes (fixo no topo do menu, A2): o que espera ação, com link, e o mapa dos 9 grupos (o mesmo menu, em
 * cartões). A página completa, com jobs com falha, alertas e credenciais faltando, vem com o #1073.
 */
export function SettingsHome() {
  const { t } = useI18n();
  const nav = t.ops.nav;
  const T = t.ops.home;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground max-w-3xl text-sm">{T.description}</p>
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.pendingTitle}</FrameTitle>
          </FrameHeader>
          <Suspense
            fallback={
              <div className="px-4 pb-4">
                <Skeleton className="h-5 w-64" />
              </div>
            }
          >
            <Pending />
          </Suspense>
        </FramePanel>
      </Frame>
      <section aria-labelledby="ajustes-areas" className="flex flex-col gap-3">
        <h2 id="ajustes-areas" className="text-base font-semibold">
          {T.groupsTitle}
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
    </div>
  );
}
