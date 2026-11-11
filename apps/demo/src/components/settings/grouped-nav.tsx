'use client';

import { ChevronRightIcon, Menu } from 'lucide-react';
import Link from 'next/link';
import { useState, type ComponentType, type SVGProps } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

/** Ícone de uma área do menu: lucide ou um desenho próprio (a marca da Cosmos AI). */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavLeaf {
  id: string;
  href: string;
  icon: NavIcon;
  label: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavLeaf[];
}

/**
 * Menu agrupado do exemplo ReUI c-collapsible-9 (cópia fiel em `components/examples/c-collapsible-9.tsx`),
 * com os ajustes que o próprio ReUI aponta: cada folha é um link de verdade (`next/link`, com
 * `aria-current`), os grupos são botões que abrem e fecham pelo teclado e nascem abertos, para o Tab
 * chegar a todas as áreas. Serve ao painel do cliente (#991) e a Ajustes (#1001).
 */
function GroupedNavMenu({
  groups,
  active,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  active: string;
  onNavigate?: () => void;
}) {
  return (
    <Card className="p-0">
      <CardContent className="p-1">
        <div className="flex flex-col gap-0.5">
          {groups.map((group) => (
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

/** Menu lateral no computador (coluna de 240 px). */
export function GroupedSideNav({
  groups,
  active,
  label,
  className,
}: {
  groups: readonly NavGroup[];
  active: string;
  /** Nome do `nav` para leitores de tela. */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('w-60 shrink-0', className)}>
      <GroupedNavMenu groups={groups} active={active} />
    </nav>
  );
}

/** O mesmo menu no celular, numa gaveta aberta pelo botão do topo (fecha ao navegar). */
export function GroupedNavSheet({
  groups,
  active,
  label,
  title,
  className,
}: {
  groups: readonly NavGroup[];
  active: string;
  label: string;
  /** Título da gaveta (a área: Painel do cliente, Ajustes). */
  title: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = groups.flatMap((g) => g.items).find((i) => i.id === active);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" className={className} />}>
        <Menu aria-hidden="true" />
        <span className="sr-only">{t.settings.menu.open}: </span>
        {current?.label ?? title}
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-2 p-3">
        <SheetHeader className="p-1">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <nav aria-label={label}>
          <GroupedNavMenu groups={groups} active={active} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
