'use client';

import type { TenantAction } from '@galaxie/engage';
import {
  Blocks,
  ChevronRightIcon,
  KeyRound,
  LayoutDashboard,
  ListVideo,
  Menu,
  Palette,
  Tv,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import type { ClientDictionary } from '@/lib/i18n/dictionary';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

/** Grupos do menu do cliente, na ordem do estudo do Cosmos AI (seção 5). */
export const CLIENT_NAV_GROUPS = [
  'account',
  'content',
  'engagement',
  'intelligence',
  'integrations',
] as const;
export type ClientNavGroupId = (typeof CLIENT_NAV_GROUPS)[number];

/**
 * Áreas do painel do cliente que já existem. Os produtos novos (Chat ao vivo, Comunidades, Gamificação,
 * Shop the game, Cosmos AI, Cobrança e créditos) entram aqui quando tiverem página; grupo sem área não aparece.
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
  icon: LucideIcon;
  group: ClientNavGroupId;
  action?: TenantAction;
  module?: string;
}[];

export type ClientSection = (typeof CLIENT_NAV)[number]['id'];

export interface ClientNavLeaf {
  id: ClientSection;
  href: string;
  icon: LucideIcon;
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

/**
 * Menu agrupado do exemplo ReUI c-collapsible-9 (cópia fiel em `components/examples/c-collapsible-9.tsx`),
 * com os ajustes que o próprio ReUI aponta: cada folha é um link de verdade (`next/link`, com
 * `aria-current`), os grupos vêm das rotas e são botões que abrem e fecham pelo teclado. Os grupos
 * nascem abertos (o da rota atual sempre), para o Tab chegar a todas as áreas.
 */
function ClientNavMenu({
  active,
  visible,
  onNavigate,
}: {
  active: ClientSection;
  visible?: readonly ClientSection[] | undefined;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card className="p-0">
      <CardContent className="p-1">
        <div className="flex flex-col gap-0.5">
          {clientNavGroups(t.client.nav, visible).map((group) => (
            <Collapsible key={group.id} defaultOpen>
              <CollapsibleTrigger
                render={
                  <Item
                    render={<button type="button" />}
                    size="xs"
                    className="hover:bg-accent aria-expanded:bg-accent group/item cursor-pointer py-1.25 focus-visible:ring-inset"
                    style={{ paddingLeft: '8px' }}
                  />
                }
              >
                <ItemTitle className="text-sm in-aria-expanded:font-semibold">{group.label}</ItemTitle>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground ml-auto size-4 transition-transform in-aria-expanded:rotate-90"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
                <div className="flex flex-col gap-0.5 pt-0.5">
                  {group.items.map(({ id, href, icon: Icon, label }) => {
                    const isActive = active === id;
                    return (
                      <Item
                        key={id}
                        size="xs"
                        render={
                          <Link
                            href={href}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={(e) => {
                              topLevelClick(href)(e);
                              onNavigate?.();
                            }}
                          />
                        }
                        className="hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-foreground group/item cursor-pointer py-1.25"
                        data-active={isActive}
                        style={{ paddingLeft: '20px' }}
                      >
                        <ItemMedia variant="icon">
                          <div className="text-muted-foreground group-hover/item:text-foreground group-data-[active=true]/item:text-foreground size-3.5">
                            <Icon aria-hidden="true" />
                          </div>
                        </ItemMedia>
                        <ItemTitle className="text-sm">{label}</ItemTitle>
                      </Item>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CardContent>
    </Card>
  );
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
    <nav aria-label={t.client.nav.label} className={cn('w-60 shrink-0', className)}>
      <ClientNavMenu active={active} visible={visible} />
    </nav>
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
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" className={className} />}>
        <Menu aria-hidden="true" />
        <span className="sr-only">{t.settings.menu.open}: </span>
        {t.client.nav[active]}
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-2 p-3">
        <SheetHeader className="p-1">
          <SheetTitle>{t.client.title}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t.client.nav.label}>
          <ClientNavMenu active={active} visible={visible} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
