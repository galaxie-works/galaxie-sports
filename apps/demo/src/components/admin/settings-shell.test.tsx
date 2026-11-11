// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

vi.mock('next/navigation', () => ({ usePathname: () => '/ajustes/usuarios/1' }));
vi.mock('@/components/search/search-provider', () => ({
  useSearch: () => ({ setOpen: vi.fn() }),
  useShortcutLabel: () => null,
}));
vi.mock('@/components/settings/grouped-nav', () => ({
  GroupedSideNav: () => <nav aria-label="menu" />,
  GroupedNavSheet: () => null,
}));

const { SettingsShell } = await import('./settings-shell');

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const nav = clientDictionary('pt-BR').ops.nav;
const counts = Promise.resolve({ home: null, review: null, lineup: null });

/** Uma página sem `SettingsArea` (detalhe de usuário, item da revisão). */
function renderShell() {
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <SettingsShell counts={counts}>
        <p>detalhe</p>
      </SettingsShell>
    </I18nProvider>,
  );
}

describe('coluna de Ajustes (#1067)', () => {
  it('⇤ esconde a coluna, o foco vai para o botão que mostra; ele traz a coluna de volta', () => {
    renderShell();
    act(() => screen.getByRole('button', { name: nav.hide }).click());
    const show = screen.getByRole('button', { name: nav.show });
    expect(document.activeElement).toBe(show);
    expect(screen.queryByRole('button', { name: nav.hide })).toBeNull();

    act(() => show.click());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: nav.hide }));
    expect(screen.queryByRole('button', { name: nav.show })).toBeNull();
  });

  it('escondida e lembrada, a página sem SettingsArea ainda tem como mostrar a coluna', () => {
    window.localStorage.setItem('galaxie:ajustes:coluna', 'hidden');
    renderShell();
    expect(screen.getByText('detalhe')).toBeTruthy();
    expect(screen.getByRole('button', { name: nav.show })).toBeTruthy();
    // sem clique, o foco fica onde estava
    expect(document.activeElement).toBe(document.body);
  });
});
