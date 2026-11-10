/**
 * Para onde foi cada aba do Sistema de antes (#1001): os links antigos `/ajustes/sistema?aba=<aba>` redirecionam
 * para a área nova do menu de Ajustes.
 */
const VIEW_ROUTES = {
  operation: '/ajustes/operacao',
  provider: '/ajustes/fornecedor',
  ai: '/ajustes/ia',
  system: '/ajustes/sistema',
} as const;

const TAB_VIEW: Record<string, keyof typeof VIEW_ROUTES> = {
  status: 'operation',
  quality: 'operation',
  live: 'operation',
  schedule: 'operation',
  tasks: 'operation',
  provider: 'provider',
  mirror: 'provider',
  ai: 'ai',
  assets: 'system',
  suggestions: 'system',
  cosmos: 'system',
  history: 'system',
};

/** Rota nova da aba antiga; null quando a aba não existe (fica no Sistema). */
export function systemTabRoute(tab: string | undefined): string | null {
  if (!tab) return null;
  const view = TAB_VIEW[tab];
  return view ? VIEW_ROUTES[view] : null;
}
