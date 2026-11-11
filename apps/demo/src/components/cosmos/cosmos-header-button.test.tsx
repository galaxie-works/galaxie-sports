// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: () => ({ data: session.role ? { user: { role: session.role } } : null }),
  },
}));

import { CosmosHeaderButton } from './cosmos-header-button';

afterEach(cleanup);

const view = () =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <TooltipProvider>
        <CosmosHeaderButton />
      </TooltipProvider>
    </I18nProvider>,
  );

describe('CosmosHeaderButton', () => {
  it.each(['admin', 'client'])('%s: link para a Cosmos AI com rótulo e ícone em currentColor', (role) => {
    session.role = role;
    view();
    const link = screen.getByRole('link', { name: 'Cosmos AI' });
    expect(link.getAttribute('href')).toBe('/cliente/cosmos');
    expect(link.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    // o traço vertical que separa da lupa vem antes do botão
    expect(document.querySelector('[data-slot="separator"]')).not.toBeNull();
  });

  it.each([null, 'user'])('sessão %s: não aparece', (role) => {
    session.role = role;
    const { container } = view();
    expect(container.innerHTML).toBe('');
  });
});
