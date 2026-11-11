'use client';

import type { TenantAction } from '@galaxie/engage';
import { Blocks, KeyRound, LayoutDashboard, ListVideo, Palette, Tv, Users, Webhook } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import { CosmosIcon } from '@/components/cosmos/cosmos-icon';
import { GroupedNavSheet, GroupedSideNav } from '@/components/settings/grouped-nav';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import type { ClientDictionary } from '@/lib/i18n/dictionary';

/** Grupos do menu do cliente, na ordem do estudo do Cosmos AI (seção 5). */
export const CLIENT_NAV_GROUPS = [
  'account',
  'content',
  'engagement',
  'intelligence',
  'integrations',
] as const;
export type ClientNavGroupId = (typeof CLIENT_NAV_GROUPS)[number];

/** Ícone de uma área: lucide ou um desenho próprio (a marca da Cosmos AI). */
export type ClientNavIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Áreas do painel do cliente que já existem. Os produtos novos (Chat ao vivo, Comunidades, Gamificação,
 * Shop the game, Cobrança e créditos) entram aqui quando tiverem página; grupo sem área não aparece.
 * `action`: ação da matriz de cargos (#1019) que a área exige; `module`: módulo que o tenant precisa ter (#1018).
 * Sem a permissão ou o módulo, a área some do menu e a página mostra o aviso.
 */
export const CLIENT_NAV = [
  { id: 'overview', href: '/cliente', icon: LayoutDashboard, group: 'account' },
  { id: 'members', href: '/cliente/usuarios', icon: Users, group: 'account', action: 'members.view' },
  { id: 'keys', href: '/cliente/chaves', icon: KeyRound, group: 'account', action: 'settings.manage' },
  { id: 'builder', href: '/cliente/builder', icon: Blocks, group: 'content', action: 'settings.manage' },
  { id: 'themes', href: '/cliente/temas', icon: Palette, group: 'content', action: 'settings.manage' },
  { id: 'lineup', href: '/cliente/grade', icon: Tv, group: 'content', action: 'settings.manage' },
  { id: 'channels', href: '/cliente/canais', icon: ListVideo, group: 'content', action: 'settings.manage' },
  { id: 'cosmos', href: '/cliente/cosmos', icon: CosmosIcon, group: 'intelligence' },
  {
    id: 'webhooks',
    href: '/cliente/webhooks',
    icon: Webhook,
    group: 'integrations',
    action: 'settings.manage',
  },
] as const satisfies readonly {
  id: string;
  href: string;
  icon: ClientNavIcon;
  group: ClientNavGroupId;
  action?: TenantAction;
  module?: string;
}[];

export type ClientSection = (typeof CLIENT_NAV)[number]['id'];

export interface ClientNavLeaf {
  id: ClientSection;
  href: string;
  icon: ClientNavIcon;
  label: string;
}

export interface ClientNavGroup {
  id: ClientNavGroupId;
  label: string;
  items: ClientNavLeaf[];
}

/** Requisitos de uma área (cargo e módulo), para a moldura decidir o que aparece. */
export const navRequirement = (id: ClientSection): { action?: TenantAction; module?: string } => {
  const item = CLIENT_NAV.find((i) => i.id === id) as { action?: TenantAction; module?: string } | undefined;
  return {
    ...(item?.action ? { action: item.action } : {}),
    ...(item?.module ? { module: item.module } : {}),
  };
};

/**
 * Grupos com as áreas no idioma da tela, em ordem alfabética; grupo vazio fica de fora. `visible` = só essas áreas
 * (as que o cargo e os módulos do tenant abrem); ausente = todas.
 */
export function clientNavGroups(
  nav: ClientDictionary['client']['nav'],
  visible?: readonly ClientSection[],
): ClientNavGroup[] {
  return CLIENT_NAV_GROUPS.map((group) => ({
    id: group,
    label: nav.groups[group],
    items: sortByLabel(
      CLIENT_NAV.filter((i) => i.group === group && (!visible || visible.includes(i.id))).map(
        ({ id, href, icon }) => ({
          id,
          href,
          icon,
          label: nav[id],
        }),
      ),
    ),
  })).filter((g) => g.items.length > 0);
}

/** Menu lateral do painel do cliente no computador (coluna de 240 px). */
export function ClientSideNav({
  active,
  visible,
  className,
}: {
  active: ClientSection;
  visible?: readonly ClientSection[];
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <GroupedSideNav
      groups={clientNavGroups(t.client.nav, visible)}
      active={active}
      label={t.client.nav.label}
      className={className}
    />
  );
}

/** O mesmo menu no celular, numa gaveta aberta pelo botão do topo (fecha ao navegar). */
export function ClientNavSheet({
  active,
  visible,
  className,
}: {
  active: ClientSection;
  visible?: readonly ClientSection[];
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <GroupedNavSheet
      groups={clientNavGroups(t.client.nav, visible)}
      active={active}
      label={t.client.nav.label}
      title={t.client.title}
      className={className}
    />
  );
}
