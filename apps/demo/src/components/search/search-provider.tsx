'use client';

import { createContext, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { DocGuideRef } from '@/lib/docs';
import type { ApiOperationSummary } from '@/lib/search/entries';

import { CommandPalette } from './command-palette';

interface SearchContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearch(): SearchContextValue {
  const ctx = use(SearchContext);
  if (!ctx) throw new Error('useSearch fora do SearchProvider');
  return ctx;
}

const noopSubscribe = () => () => {};

/** Atalho do sistema: `⌘K` no Mac, `Ctrl K` nos outros (null no servidor e na hidratação). */
export function useShortcutLabel(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    () => null,
  );
}

/**
 * Busca global do app e da documentação: abre com ⌘K / Ctrl+K (de qualquer página, até dentro de
 * um campo de texto) e pelos botões de busca. Guias e operações da referência vêm do servidor, no idioma.
 */
export function SearchProvider({
  guides,
  operations,
  children,
}: {
  guides: DocGuideRef[];
  operations: ApiOperationSummary[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <SearchContext value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} guides={guides} operations={operations} />
    </SearchContext>
  );
}
