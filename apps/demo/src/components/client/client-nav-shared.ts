/**
 * Parte pura do menu do console do cliente: áreas, grupos, o que cada estado do tenant abre e os requisitos de cada
 * área. Sem `'use client'`, para a moldura (`client-area.tsx`, componente de servidor) chamar estas funções e ler estas
 * constantes: valor importado de um módulo `'use client'` chega ao servidor como referência de cliente, e chamar
 * `sectionsForState` ou fazer `CLIENT_NAV.map` nele quebra a página no build de produção. Os menus em si
 * (`ClientSideNav`, `ClientNavSheet`) ficam em `client-nav.tsx`.
 */
import type { TenantState } from '@galaxie/db/schema';
import type { TenantAction } from '@galaxie/engage';
import {
  Blocks,
  Globe,
  Handshake,
  KeyRound,
  LayoutDashboard,
  ListVideo,
  MessagesSquare,
  Package,
  Palette,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  Tv,
  Users,
  UsersRound,
  Webhook,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import { CosmosIcon } from '@/components/cosmos/cosmos-icon';
import { sortByLabel } from '@/lib/alphabetical';
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
  { id: 'overview', href: '/client', icon: LayoutDashboard, group: 'account' },
  { id: 'members', href: '/client/users', icon: Users, group: 'account', action: 'members.view' },
  { id: 'keys', href: '/client/keys', icon: KeyRound, group: 'account', action: 'keys.view' },
  // loja de features (plataforma comercial, #1137): todo cargo vê o que o plano inclui, como a visão geral
  { id: 'plans', href: '/client/plans', icon: Package, group: 'account' },
  { id: 'builder', href: '/client/builder', icon: Blocks, group: 'content', action: 'builder.view' },
  { id: 'themes', href: '/client/themes', icon: Palette, group: 'content', action: 'builder.view' },
  { id: 'lineup', href: '/client/lineup', icon: Tv, group: 'content', action: 'settings.manage' },
  { id: 'channels', href: '/client/channels', icon: ListVideo, group: 'content', action: 'settings.manage' },
  {
    id: 'sponsors',
    href: '/client/sponsors',
    icon: Handshake,
    group: 'engagement',
    action: 'settings.manage',
  },
  {
    // Comunidades (#939): escopo e configuração de cada Comunidade
    id: 'communities',
    href: '/client/communities',
    icon: UsersRound,
    group: 'engagement',
    action: 'settings.manage',
    module: 'communities',
  },
  {
    // Gamificação (#917): programas por país, Conquistas do Catálogo e o resumo
    id: 'gamification',
    href: '/client/gamification',
    icon: Trophy,
    group: 'engagement',
    action: 'settings.manage',
    module: 'gamification',
  },
  {
    id: 'shopping',
    href: '/client/shopping',
    icon: ShoppingBag,
    group: 'engagement',
    // relatório de cliques e, com a conciliação (#929), de comissão: dinheiro do tenant
    action: 'billing.view',
    module: 'shopping',
  },
  {
    // Chat ao vivo (#973): o moderador de uma sala entra e age só na sala dele
    id: 'chat',
    href: '/client/chat',
    icon: MessagesSquare,
    group: 'engagement',
    action: 'moderation.queue.view',
    module: 'live_chat',
    scoped: true,
  },
  {
    id: 'moderation',
    href: '/client/moderation',
    icon: ShieldCheck,
    group: 'engagement',
    action: 'moderation.queue.view',
    // o moderador de uma sala entra e vê só a sala dele
    scoped: true,
  },
  { id: 'cosmos', href: '/client/cosmos', icon: CosmosIcon, group: 'intelligence', action: 'cosmos.view' },
  {
    id: 'webhooks',
    href: '/client/webhooks',
    icon: Webhook,
    group: 'integrations',
    action: 'webhooks.view',
  },
  // domínios comprovados por TXT (plataforma comercial, #1136): quem integra (Desenvolvedor, Admin, Dono)
  { id: 'domains', href: '/client/domains', icon: Globe, group: 'integrations', action: 'domains.view' },
] as const satisfies readonly {
  id: string;
  href: string;
  icon: ClientNavIcon;
  group: ClientNavGroupId;
  action?: TenantAction;
  module?: string;
  /** A área trabalha por lugar: basta a permissão numa Sala ou Comunidade do escopo. */
  scoped?: boolean;
}[];

export type ClientSection = (typeof CLIENT_NAV)[number]['id'];

/**
 * Estados em que o console não abre área nenhuma: só a tela do estado (espera da revisão, recusa, guarda do
 * cancelamento; `draft` dura a transação do provisionamento). F3, decisão 8; doc 02 "O que cada estado permite".
 */
export const STATES_WITH_NOTICE_ONLY: readonly TenantState[] = [
  'draft',
  'pending_review',
  'rejected',
  'cancelled',
];

/**
 * Áreas que o estado do tenant deixa abertas (F3, decisão 8); null = todas (o cargo e os módulos decidem). Em
 * `trial_expired` e `suspended` só o que leva à regularização: Planos e módulos (Cobrança, quando existir) e Chaves.
 */
export function sectionsForState(state: TenantState): readonly ClientSection[] | null {
  switch (state) {
    case 'trial_expired':
      return ['plans', 'keys'];
    case 'suspended':
      return ['keys', 'plans'];
    case 'draft':
    case 'pending_review':
    case 'rejected':
    case 'cancelled':
      // a visão geral fica no menu como o lugar da tela do estado; a moldura não renderiza mais nada
      return ['overview'];
    case 'trial':
    case 'active':
    case 'past_due':
      return null;
  }
}

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
export const navRequirement = (
  id: ClientSection,
): { action?: TenantAction; module?: string; scoped?: boolean } => {
  const item = CLIENT_NAV.find((i) => i.id === id) as
    { action?: TenantAction; module?: string; scoped?: boolean } | undefined;
  return {
    ...(item?.action ? { action: item.action } : {}),
    ...(item?.module ? { module: item.module } : {}),
    ...(item?.scoped ? { scoped: true } : {}),
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
