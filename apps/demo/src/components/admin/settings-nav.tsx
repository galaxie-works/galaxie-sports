'use client';

import {
  Activity,
  Bot,
  ListChecks,
  Server,
  Shield,
  SlidersHorizontal,
  Trophy,
  Tv,
  Users,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  GroupedNavSheet,
  GroupedSideNav,
  type NavGroup,
  type NavIcon,
} from '@/components/settings/grouped-nav';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionary';

/** Grupos do menu de Ajustes (#1001), em ordem alfabética nos três idiomas. */
export const SETTINGS_NAV_GROUPS = ['clients', 'data', 'platform'] as const;
export type SettingsNavGroupId = (typeof SETTINGS_NAV_GROUPS)[number];

/**
 * Áreas de Ajustes (só a equipe Galaxie). O Sistema de antes (saúde, jobs, IA, fornecedor…) virou quatro áreas da
 * Plataforma, cada uma com as seções empilhadas; as Carteiras da Cosmos entram em Clientes com o #1002.
 */
export const SETTINGS_NAV = [
  { id: 'users', href: '/ajustes/usuarios', icon: Users, group: 'clients' },
  { id: 'webhooks', href: '/ajustes/webhooks', icon: Webhook, group: 'clients' },
  { id: 'crests', href: '/ajustes/escudos', icon: Shield, group: 'data' },
  { id: 'features', href: '/ajustes/esportes', icon: Trophy, group: 'data' },
  { id: 'lineup', href: '/ajustes/grades', icon: Tv, group: 'data' },
  { id: 'review', href: '/ajustes/revisao', icon: ListChecks, group: 'data' },
  { id: 'ai', href: '/ajustes/ia', icon: Bot, group: 'platform' },
  { id: 'operation', href: '/ajustes/operacao', icon: Activity, group: 'platform' },
  { id: 'provider', href: '/ajustes/fornecedor', icon: Server, group: 'platform' },
  { id: 'system', href: '/ajustes/sistema', icon: SlidersHorizontal, group: 'platform' },
] as const satisfies readonly { id: string; href: string; icon: NavIcon; group: SettingsNavGroupId }[];

export type SettingsSectionId = (typeof SETTINGS_NAV)[number]['id'];

/** Grupos com as áreas no idioma da tela, em ordem alfabética; grupo vazio fica de fora. */
export function settingsNavGroups(nav: Dictionary['ops']['nav']): NavGroup[] {
  return SETTINGS_NAV_GROUPS.map((group) => ({
    id: group,
    label: nav.groups[group],
    items: sortByLabel(
      SETTINGS_NAV.filter((i) => i.group === group).map(({ id, href, icon }) => ({
        id,
        href,
        icon,
        label: nav[id],
      })),
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Moldura das páginas de Ajustes: o menu agrupado ao lado no computador (o mesmo do painel do cliente) e numa
 * gaveta no celular, com o conteúdo da área.
 */
export function SettingsArea({ active, children }: { active: SettingsSectionId; children: ReactNode }) {
  const { t } = useI18n();
  const groups = settingsNavGroups(t.ops.nav);
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <GroupedSideNav
        groups={groups}
        active={active}
        label={t.ops.nav.label}
        className="hidden lg:sticky lg:top-18 lg:block"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <GroupedNavSheet
          groups={groups}
          active={active}
          label={t.ops.nav.label}
          title={t.ops.nav.title}
          className="self-start lg:hidden"
        />
        {children}
      </div>
    </div>
  );
}
