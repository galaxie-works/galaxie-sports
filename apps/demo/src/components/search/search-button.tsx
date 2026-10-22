'use client';

import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { useSearch, useShortcutLabel } from './search-provider';

/** Botão de busca no topo da sidebar (recolhida, vira só o ícone com tooltip). */
export function SidebarSearchButton() {
  const T = useI18n().t.search;
  const { setOpen } = useSearch();
  const { isMobile, setOpenMobile } = useSidebar();
  const shortcut = useShortcutLabel();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={shortcut ? fill(T.withShortcut, { shortcut }) : T.button}
          onClick={() => {
            // No celular a sidebar é uma gaveta: fecha antes de abrir a busca.
            if (isMobile) setOpenMobile(false);
            setOpen(true);
          }}
          className="text-muted-foreground border-sidebar-border bg-sidebar-accent/40 hover:text-foreground border"
        >
          <Search />
          <span className="flex-1 truncate">{T.buttonHint}</span>
          {shortcut ? (
            <kbd className="bg-background/60 text-muted-foreground rounded border px-1.5 font-mono text-[10px] group-data-[collapsible=icon]:hidden">
              {shortcut}
            </kbd>
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Lupa no cabeçalho das páginas, para o celular (a sidebar fica numa gaveta). */
export function HeaderSearchButton({ className }: { className?: string }) {
  const T = useI18n().t.search;
  const { setOpen } = useSearch();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setOpen(true)}
      aria-label={T.button}
    >
      <Search aria-hidden />
    </Button>
  );
}
