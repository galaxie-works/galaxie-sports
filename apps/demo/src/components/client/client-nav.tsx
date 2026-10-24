'use client';

import { Blocks, KeyRound, LayoutDashboard, Tv } from 'lucide-react';
import Link from 'next/link';

import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

export const CLIENT_NAV = [
  { id: 'overview', href: '/cliente', icon: LayoutDashboard },
  { id: 'keys', href: '/cliente/chaves', icon: KeyRound },
  { id: 'builder', href: '/cliente/builder', icon: Blocks },
  { id: 'lineup', href: '/cliente/grade', icon: Tv },
] as const;

export type ClientSection = (typeof CLIENT_NAV)[number]['id'];

/** Abas do painel do cliente (mesmo desenho das abas de Ajustes). */
export function ClientNav({ active }: { active: ClientSection }) {
  const { t } = useI18n();
  return (
    // no celular as abas rolam na horizontal, sem alargar a página
    <nav
      aria-label={t.client.nav.label}
      className="bg-muted inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg p-1"
    >
      {CLIENT_NAV.map(({ id, href, icon: Icon }) => (
        <Link
          key={id}
          href={href}
          onClick={topLevelClick(href)}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            active === id && 'bg-background text-foreground shadow-sm',
          )}
        >
          <Icon className="size-4" />
          {t.client.nav[id]}
        </Link>
      ))}
    </nav>
  );
}
