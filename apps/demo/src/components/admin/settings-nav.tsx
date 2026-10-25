'use client';

import { Clapperboard, ListChecks, SlidersHorizontal, Tv, Users } from 'lucide-react';
import Link from 'next/link';

import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'users', href: '/ajustes/usuarios', icon: Users },
  { id: 'operations', href: '/ajustes/operacao', icon: SlidersHorizontal },
  { id: 'review', href: '/ajustes/revisao', icon: ListChecks },
  { id: 'lineup', href: '/ajustes/grades', icon: Tv },
  { id: 'related', href: '/ajustes/videos', icon: Clapperboard },
] as const;

/**
 * Abas das áreas de Ajustes (só admin): usuários e convites, o painel de Operação, a revisão semântica, as
 * grades e ofertas das operadoras e o bloqueio dos canais nos vídeos relacionados.
 */
export function SettingsNav({ active }: { active: (typeof ITEMS)[number]['id'] }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.ops.nav.label} className="bg-muted inline-flex w-fit gap-1 rounded-lg p-1">
      {ITEMS.map(({ id, href, icon: Icon }) => (
        <Link
          key={id}
          href={href}
          onClick={topLevelClick(href)}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            active === id && 'bg-background text-foreground shadow-sm',
          )}
        >
          <Icon className="size-4" />
          {t.ops.nav[id]}
        </Link>
      ))}
    </nav>
  );
}
