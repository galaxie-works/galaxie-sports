'use client';

import { ChevronRightIcon, Menu } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemActions, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useLocalStorage } from '@/hooks/use-local-storage';
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
  /** Área planejada (Ajustes, "Em breve"): texto apagado; segue clicável. */
  muted?: boolean;
  /** Selo à direita: "Em breve" ou a contagem do que espera ação (padrão c-sidebar-1). */
  badge?: ReactNode;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavLeaf[];
}

/**
 * Grupos abertos (decisão A6 do #1066): só o da página atual abre sozinho, e ele fica sempre aberto (um "fechado"
 * lembrado não esconde o item aceso); os outros que a pessoa abre ficam lembrados no navegador e valem nas próximas
 * páginas. Sem `storageKey`, todos nascem abertos (painel do cliente, #991).
 */
function useGroupsOpen(storageKey: string | undefined, groups: readonly NavGroup[], active: string) {
  const [raw, setRaw] = useLocalStorage(storageKey ?? 'galaxie:menu', '{}');
  const saved = useMemo<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }, [raw]);
  if (!storageKey) return null;
  return {
    isOpen: (group: NavGroup) => group.items.some((i) => i.id === active) || saved[group.id] === true,
    setOpen: (group: NavGroup, open: boolean) => setRaw(JSON.stringify({ ...saved, [group.id]: open })),
  };
}

function Leaf({
  leaf,
  active,
  indent,
  onNavigate,
}: {
  leaf: NavLeaf;
  active: boolean;
  indent: number;
  onNavigate?: () => void;
}) {
  const { href, icon: Icon, label, muted, badge } = leaf;
  return (
    <Item
      size="xs"
      render={
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          onClick={(e) => {
            topLevelClick(href)(e);
            onNavigate?.();
          }}
        />
      }
      className="hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-foreground group/item cursor-pointer flex-nowrap py-1.25"
      data-active={active}
      style={{ paddingLeft: `${indent}px` }}
    >
      <ItemMedia variant="icon">
        <div className="text-muted-foreground group-hover/item:text-foreground group-data-[active=true]/item:text-foreground size-3.5">
          <Icon aria-hidden="true" />
        </div>
      </ItemMedia>
      <ItemTitle
        className={cn(
          'min-w-0 truncate text-sm',
          muted && 'text-muted-foreground group-data-[active=true]/item:text-foreground font-normal',
        )}
      >
        {label}
      </ItemTitle>
      {badge ? <ItemActions className="ml-auto">{badge}</ItemActions> : null}
    </Item>
  );
}

/**
 * Menu agrupado do exemplo ReUI c-collapsible-9 (cópia fiel em `components/examples/c-collapsible-9.tsx`),
 * com os ajustes que o próprio ReUI aponta: cada folha é um link de verdade (`next/link`, com
 * `aria-current`), os grupos são botões que abrem e fecham pelo teclado, para o Tab chegar a todas as áreas.
 * Serve ao painel do cliente (#991) e a Ajustes (#1001, #1066): `pinned` são as folhas fixas no topo (Início),
 * fora dos grupos, e `bare` tira o cartão (na coluna de Ajustes, que já tem a borda dela).
 */
function GroupedNavMenu({
  groups,
  pinned,
  active,
  storageKey,
  bare,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  pinned?: readonly NavLeaf[];
  active: string;
  storageKey?: string;
  bare?: boolean;
  onNavigate?: () => void;
}) {
  const remembered = useGroupsOpen(storageKey, groups, active);
  const menu = (
    <div className="flex flex-col gap-0.5">
      {pinned?.map((leaf) => (
        <Leaf key={leaf.id} leaf={leaf} active={active === leaf.id} indent={8} onNavigate={onNavigate} />
      ))}
      {groups.map((group) => (
        <Collapsible
          key={group.id}
          {...(remembered
            ? {
                open: remembered.isOpen(group),
                onOpenChange: (open: boolean) => remembered.setOpen(group, open),
              }
            : { defaultOpen: true })}
        >
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
              {group.items.map((leaf) => (
                <Leaf
                  key={leaf.id}
                  leaf={leaf}
                  active={active === leaf.id}
                  indent={20}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
  if (bare) return menu;
  return (
    <Card className="p-0">
      <CardContent className="p-1">{menu}</CardContent>
    </Card>
  );
}

/** Menu lateral no computador (coluna de 240 px). */
export function GroupedSideNav({
  groups,
  pinned,
  active,
  label,
  storageKey,
  bare,
  className,
}: {
  groups: readonly NavGroup[];
  pinned?: readonly NavLeaf[];
  active: string;
  /** Nome do `nav` para leitores de tela. */
  label: string;
  storageKey?: string;
  bare?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(bare ? 'w-full' : 'w-60 shrink-0', className)}>
      <GroupedNavMenu groups={groups} pinned={pinned} active={active} storageKey={storageKey} bare={bare} />
    </nav>
  );
}

/** O mesmo menu no celular, numa gaveta aberta pelo botão do topo (fecha ao navegar). */
export function GroupedNavSheet({
  groups,
  pinned,
  active,
  label,
  title,
  storageKey,
  header,
  className,
}: {
  groups: readonly NavGroup[];
  pinned?: readonly NavLeaf[];
  active: string;
  label: string;
  /** Título da gaveta (a área: Painel do cliente, Ajustes). */
  title: string;
  storageKey?: string;
  /** Acima do menu, na gaveta (a busca de Ajustes). Recebe como fechar a gaveta. */
  header?: (close: () => void) => ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = [...(pinned ?? []), ...groups.flatMap((g) => g.items)].find((i) => i.id === active);
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
        {header?.(() => setOpen(false))}
        <nav aria-label={label} className="min-h-0 flex-1 overflow-y-auto">
          <GroupedNavMenu
            groups={groups}
            pinned={pinned}
            active={active}
            storageKey={storageKey}
            onNavigate={() => setOpen(false)}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
