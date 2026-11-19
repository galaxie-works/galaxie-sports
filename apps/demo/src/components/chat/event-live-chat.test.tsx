// @vitest-environment happy-dom
import { DEFAULT_THEMES } from '@galaxie/widgets';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

vi.mock('@/lib/auth/client', () => ({
  authClient: { useSession: () => ({ data: null, refetch: vi.fn() }) },
}));
vi.mock('@/lib/fan/client', () => ({ getDemoFanToken: async () => null }));
vi.mock('@/components/app-shell/fan-profile-dialog', () => ({ FanProfileDialog: () => null }));

const { EventLiveChat } = await import('./event-live-chat');

const EVENT = '0190f000-0000-7000-8000-00000000f001';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EventLiveChat (#1389)', () => {
  it('usa o tema escuro da demo: um erro da API fica no card escuro, não numa caixa branca', async () => {
    // erro passageiro da sala (a demo só monta o chat com o módulo; aqui é a API fora do ar)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ title: 'indisponível' }, { status: 502 })),
    );
    render(
      <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
        <EventLiveChat eventId={EVENT} market="BR" />
      </I18nProvider>,
    );
    const alert = await screen.findByRole('alert');
    const root = alert.closest<HTMLElement>('.gs-root')!;
    expect(root.dataset.gsMode).toBe('dark');
    expect(root.style.getPropertyValue('--gs-surface')).toBe(DEFAULT_THEMES.dark.surface);
    expect(root.style.getPropertyValue('--gs-surface')).not.toBe('#ffffff');
  });
});
