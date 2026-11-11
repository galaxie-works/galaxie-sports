'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { CosmosAssistant } from './cosmos-assistant';

interface CosmosAssistantControl {
  openAssistant: () => void;
}

const Ctx = createContext<CosmosAssistantControl | null>(null);

/**
 * Painel do assistente da Cosmos no layout da área logada, fora do cabeçalho de cada página: trocar de tela não
 * desmonta o painel, então a resposta em andamento não é cortada e a conversa continua. O painel só monta na
 * primeira abertura (quem nunca abre não paga nada) e fica guardado ao fechar.
 */
export function CosmosAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const openAssistant = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openAssistant }), [openAssistant]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted ? <CosmosAssistant open={open} onOpenChange={setOpen} /> : null}
    </Ctx.Provider>
  );
}

/** Controle do painel do layout; null fora da área logada (o botão monta o próprio painel). */
export const useCosmosAssistant = () => useContext(Ctx);
