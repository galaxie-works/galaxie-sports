'use client';

import {
  createContext,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import type { DocGuideRef } from '@/lib/docs';
import type { ApiOperationSummary } from '@/lib/search/entries';

import { CommandPalette } from './command-palette';

/** `settings`: aberta pelo campo "Buscar ajuste…" do menu de Ajustes (#1071), já com os ajustes na frente. */
export type SearchMode = 'all' | 'settings';

interface SearchContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Abre a paleta já na busca de ajustes. */
  openSettings: () => void;
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
  const [open, setOpenState] = useState(false);
  const [mode, setMode] = useState<SearchMode>('all');
  // o ⌘K e os botões abrem a busca geral; só o campo do menu de Ajustes abre no modo de ajustes
  const setOpen = useCallback((next: boolean) => {
    if (next) setMode('all');
    setOpenState(next);
  }, []);
  const toggle = useCallback(() => {
    setMode('all');
    setOpenState((o) => !o);
  }, []);
  const openSettings = useCallback(() => {
    setMode('settings');
    setOpenState(true);
  }, []);

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

  const value = useMemo(
    () => ({ open, setOpen, toggle, openSettings }),
    [open, setOpen, toggle, openSettings],
  );
  return (
    <SearchContext value={value}>
      {children}
      {/* A paleta lê o caminho (dado de URL, para pôr os ajustes na frente dentro de Ajustes): atrás de Suspense
          para não bloquear o prerender das páginas. */}
      <Suspense fallback={null}>
        <CommandPalette
          open={open}
          onOpenChange={setOpenState}
          mode={mode}
          guides={guides}
          operations={operations}
        />
      </Suspense>
    </SearchContext>
  );
}
