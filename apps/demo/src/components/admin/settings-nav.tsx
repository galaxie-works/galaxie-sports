'use client';

import { SlidersHorizontal, Users } from 'lucide-react';
import Link from 'next/link';

import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'users', href: '/ajustes/usuarios', icon: Users },
  { id: 'operations', href: '/ajustes/operacao', icon: SlidersHorizontal },
] as const;

/** Abas das áreas de Ajustes (só admin): usuários e convites, e o painel de Operação. */
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
