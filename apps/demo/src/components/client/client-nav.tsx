'use client';

import {
  Blocks,
  ChevronRightIcon,
  KeyRound,
  LayoutDashboard,
  ListVideo,
  Menu,
  Palette,
  Tv,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ComponentType, type SVGProps } from 'react';

import { CosmosIcon } from '@/components/cosmos/cosmos-icon';
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

/** Ícone de uma área: lucide ou um desenho próprio (a marca da Cosmos AI). */
export type ClientNavIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Áreas do painel do cliente que já existem. Os produtos novos (Chat ao vivo, Comunidades, Gamificação,
 * Shop the game, Cobrança e créditos, Usuários e cargos) entram aqui quando tiverem página;
 * grupo sem área não aparece.
 */
export const CLIENT_NAV = [
  { id: 'overview', href: '/cliente', icon: LayoutDashboard, group: 'account' },
  { id: 'keys', href: '/cliente/chaves', icon: KeyRound, group: 'account' },
  { id: 'builder', href: '/cliente/builder', icon: Blocks, group: 'content' },
  { id: 'themes', href: '/cliente/temas', icon: Palette, group: 'content' },
  { id: 'lineup', href: '/cliente/grade', icon: Tv, group: 'content' },
  { id: 'channels', href: '/cliente/canais', icon: ListVideo, group: 'content' },
  { id: 'cosmos', href: '/cliente/cosmos', icon: CosmosIcon, group: 'intelligence' },
  { id: 'webhooks', href: '/cliente/webhooks', icon: Webhook, group: 'integrations' },
] as const satisfies readonly { id: string; href: string; icon: ClientNavIcon; group: ClientNavGroupId }[];

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

/** Grupos com as áreas no idioma da tela, em ordem alfabética; grupo vazio fica de fora. */
export function clientNavGroups(nav: ClientDictionary['client']['nav']): ClientNavGroup[] {
  return CLIENT_NAV_GROUPS.map((group) => ({
    id: group,
    label: nav.groups[group],
    items: sortByLabel(
      CLIENT_NAV.filter((i) => i.group === group).map(({ id, href, icon }) => ({
        id,
        href,
        icon,
        label: nav[id],
      })),
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Menu agrupado do exemplo ReUI c-collapsible-9 (cópia fiel em `components/examples/c-collapsible-9.tsx`),
 * com os ajustes que o próprio ReUI aponta: cada folha é um link de verdade (`next/link`, com
 * `aria-current`), os grupos vêm das rotas e são botões que abrem e fecham pelo teclado. Os grupos
 * nascem abertos (o da rota atual sempre), para o Tab chegar a todas as áreas.
 */
function ClientNavMenu({ active, onNavigate }: { active: ClientSection; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="p-0">
      <CardContent className="p-1">
        <div className="flex flex-col gap-0.5">
          {clientNavGroups(t.client.nav).map((group) => (
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
export function ClientSideNav({ active, className }: { active: ClientSection; className?: string }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.client.nav.label} className={cn('w-60 shrink-0', className)}>
      <ClientNavMenu active={active} />
    </nav>
  );
}

/** O mesmo menu no celular, numa gaveta aberta pelo botão do topo (fecha ao navegar). */
export function ClientNavSheet({ active, className }: { active: ClientSection; className?: string }) {
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
          <ClientNavMenu active={active} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
