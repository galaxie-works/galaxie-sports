// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSidebar } from '@/components/ui/sidebar';

import { AppSidebarStateProvider, appSidebarOpen, useSettingsSidebarMode } from './app-sidebar-state';

/** O estado do menu do app e um botão que faz o mesmo que o ⇤ do trilho (ou o ⌘B). */
function Probe() {
  const { open, setOpen } = useSidebar();
  return (
    <button type="button" onClick={() => setOpen(!open)}>
      {open ? 'aberto' : 'recolhido'}
    </button>
  );
}

/** O layout de Ajustes: enquanto montado, o menu do app fica no trilho. */
function SettingsLayout() {
  useSettingsSidebarMode();
  return null;
}

/** Navegação: dentro ou fora de /ajustes. */
let navigate: (inSettings: boolean) => void = () => {};
function App({ start }: { start: boolean }) {
  const [inSettings, setInSettings] = useState(start);
  navigate = setInSettings;
  return (
    <AppSidebarStateProvider>
      <Probe />
      {inSettings ? <SettingsLayout /> : null}
    </AppSidebarStateProvider>
  );
}

const state = () => screen.getByRole('button').textContent;
const toggle = async () => {
  await act(async () => {
    screen.getByRole('button').click();
    await Promise.resolve();
  });
};
const go = (inSettings: boolean) => act(() => navigate(inSettings));
const cookie = () => /sidebar_state=(\w+)/.exec(document.cookie)?.[1];

afterEach(() => {
  cleanup();
  document.cookie = 'sidebar_state=; max-age=0; path=/';
});

describe('menu do app por rota (#1067)', () => {
  it('regra pura: fora de Ajustes vale o da pessoa; em Ajustes, o da visita', () => {
    expect(appSidebarOpen(true, null)).toBe(true);
    expect(appSidebarOpen(false, null)).toBe(false);
    expect(appSidebarOpen(true, false)).toBe(false);
    expect(appSidebarOpen(false, true)).toBe(true);
  });

  it('entrar em Ajustes recolhe; sair devolve aberto', () => {
    render(<App start={false} />);
    expect(state()).toBe('aberto');
    go(true);
    expect(state()).toBe('recolhido');
    go(false);
    expect(state()).toBe('aberto');
  });

  it('quem tinha deixado recolhido volta recolhido, e abrir em Ajustes vale só lá', async () => {
    render(<App start={false} />);
    await toggle();
    expect(state()).toBe('recolhido');
    expect(cookie()).toBe('false');
    go(true);
    expect(state()).toBe('recolhido');
    await toggle();
    expect(state()).toBe('aberto');
    // a visita a Ajustes não sobrescreve o cookie da pessoa
    expect(cookie()).toBe('false');
    go(false);
    expect(state()).toBe('recolhido');
  });

  it('abrir direto numa página de Ajustes já começa recolhido', () => {
    render(<App start />);
    expect(state()).toBe('recolhido');
    go(false);
    expect(state()).toBe('aberto');
  });
});
