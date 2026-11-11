'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentProps,
} from 'react';

import { SidebarProvider } from '@/components/ui/sidebar';
import { useHydrated } from '@/hooks/use-hydrated';

/** O mesmo cookie do `SidebarProvider` (shadcn): o estado que a pessoa escolheu para o menu do app. */
const SIDEBAR_COOKIE = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Menu do app aberto ou recolhido (#1067). Fora de Ajustes vale o que a pessoa escolheu; em Ajustes (`inSettings` não
 * nulo) o menu abre recolhido no trilho de ícones e o que se mexe lá vale só até sair. Puro, para o teste.
 */
export function appSidebarOpen(userOpen: boolean, inSettings: boolean | null): boolean {
  return inSettings ?? userOpen;
}

/** Entra em Ajustes: recolhe o menu do app; a função devolvida sai e volta ao estado de antes. */
type EnterSettings = () => () => void;
const SettingsModeContext = createContext<EnterSettings | null>(null);

/**
 * `SidebarProvider` com o estado controlado pela rota: as páginas de Ajustes (o layout delas chama
 * `useSettingsSidebarMode`) recolhem o menu do app para dar lugar à coluna de Ajustes, e ao sair ele volta como a
 * pessoa tinha deixado. A visita a Ajustes não sobrescreve o cookie `sidebar_state`. O caminho da URL não é lido aqui,
 * para o shell do app seguir prerenderizado (usePathname suspenderia nas rotas com parâmetro).
 */
export function AppSidebarStateProvider({
  children,
  ...props
}: Omit<ComponentProps<typeof SidebarProvider>, 'open' | 'onOpenChange' | 'defaultOpen'>) {
  const [userOpen, setUserOpen] = useState(true);
  const [inSettings, setInSettings] = useState<boolean | null>(null);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (inSettings === null) {
        setUserOpen(open);
        return;
      }
      setInSettings(open);
      // o SidebarProvider grava o cookie logo depois desta chamada: devolve o valor de fora de Ajustes
      queueMicrotask(() => {
        document.cookie = `${SIDEBAR_COOKIE}=${userOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      });
    },
    [inSettings, userOpen],
  );

  const enter = useCallback<EnterSettings>(() => {
    setInSettings(false);
    return () => setInSettings(null);
  }, []);

  return (
    <SettingsModeContext.Provider value={enter}>
      <SidebarProvider {...props} open={appSidebarOpen(userOpen, inSettings)} onOpenChange={onOpenChange}>
        {children}
      </SidebarProvider>
    </SettingsModeContext.Provider>
  );
}

/** Chamado pelo layout de Ajustes: enquanto ele estiver montado, o menu do app fica no trilho de ícones. */
export function useSettingsSidebarMode(): void {
  const enter = useContext(SettingsModeContext);
  // antes de pintar, para a navegação até Ajustes não mostrar o menu aberto por um quadro
  useLayoutEffect(() => enter?.(), [enter]);
}

/**
 * Recolhe o menu do app no HTML, antes de hidratar: o shell do app é prerenderizado sem saber a rota (o estado só
 * muda no `useLayoutEffect` de `useSettingsSidebarMode`), então a carga completa de uma página de Ajustes pintaria o
 * menu aberto e recolheria depois. Muda só os atributos que o CSS do `Sidebar` lê; depois de hidratar o estado do
 * React assume e diz o mesmo.
 */
export const SETTINGS_SIDEBAR_PREPAINT = `(function(){var c=document.querySelector('[data-app-sidebar]');var s=c&&c.closest('[data-slot=sidebar]');if(s&&s.getAttribute('data-state')==='expanded'){s.setAttribute('data-state','collapsed');s.setAttribute('data-collapsible','icon')}})()`;

/**
 * O script acima, no HTML do servidor e na hidratação (o mesmo elemento, sem diferença); some depois de hidratar e
 * não é criado na navegação pelo navegador, quando o `useLayoutEffect` já recolhe o menu antes de pintar.
 */
export function SettingsSidebarPrepaint() {
  const hydrated = useHydrated();
  if (hydrated) return null;
  return <script dangerouslySetInnerHTML={{ __html: SETTINGS_SIDEBAR_PREPAINT }} />;
}
