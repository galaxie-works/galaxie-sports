'use client';

import { Globe, ListChecks, Shield, SlidersHorizontal, Trophy, Tv, Users, Webhook } from 'lucide-react';
import Link from 'next/link';

import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'users', href: '/ajustes/usuarios', icon: Users },
  { id: 'system', href: '/ajustes/sistema', icon: SlidersHorizontal },
  { id: 'features', href: '/ajustes/esportes', icon: Trophy },
  { id: 'review', href: '/ajustes/revisao', icon: ListChecks },
  { id: 'lineup', href: '/ajustes/grades', icon: Tv },
  { id: 'crests', href: '/ajustes/escudos', icon: Shield },
  { id: 'webhooks', href: '/ajustes/webhooks', icon: Webhook },
  { id: 'engage', href: '/ajustes/engajamento', icon: Globe },
] as const;

/**
 * Abas das áreas de Ajustes (só admin): usuários e convites, o Sistema (saúde, jobs, IA, fornecedor), Esportes
 * e features (plano por esporte, vídeos relacionados com o controle dos canais, onde assistir), a revisão
 * semântica, as grades e ofertas das operadoras, os escudos de times e competições e o controle dos webhooks para
 * clientes.
 */
export function SettingsNav({ active }: { active: (typeof ITEMS)[number]['id'] }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t.ops.nav.label}
      className="bg-muted inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg p-1"
    >
      {ITEMS.map(({ id, href, icon: Icon }) => (
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
          {t.ops.nav[id]}
        </Link>
      ))}
    </nav>
  );
}
