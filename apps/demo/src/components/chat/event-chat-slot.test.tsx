// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDictionary } from '@/lib/i18n/dictionary';

const state = vi.hoisted(() => ({
  access: null as { tenantName: string; modules: string[] } | null,
  role: null as string | null,
}));

vi.mock('@/lib/galaxie/demo-modules', () => ({ demoKeyAccess: async () => state.access }));
vi.mock('@/lib/client/session', () => ({
  readClientContext: async () => (state.role ? { role: state.role } : null),
}));
vi.mock('@/lib/i18n/server', () => ({
  getI18n: async () => ({ locale: 'pt-BR', t: getDictionary('pt-BR') }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// o widget de verdade fala com a API: aqui só importa se ele monta
vi.mock('./event-live-chat', () => ({
  EventLiveChat: ({ eventId }: { eventId: string }) => <div data-testid="live-chat">{eventId}</div>,
}));

const { EventChatSlot } = await import('./event-chat-slot');

const T = getDictionary('pt-BR').event.chat.moduleOff;
const EVENT = '0190f000-0000-7000-8000-00000000f001';

async function view() {
  const node = await EventChatSlot({ eventId: EVENT, market: 'BR' });
  return render(<div data-testid="slot">{node}</div>);
}

beforeEach(() => {
  state.access = null;
  state.role = null;
});
afterEach(cleanup);

describe('chat na página do jogo (#1389)', () => {
  it('com o live_chat na chave da demo, o chat monta', async () => {
    state.access = { tenantName: 'Demo', modules: ['core_data', 'live_chat'] };
    await view();
    expect(screen.getByTestId('live-chat').textContent).toBe(EVENT);
  });

  it.each([null, 'client'])(
    'sem o módulo, sessão %s: o chat não monta e não há caixa de erro',
    async (role) => {
      state.access = { tenantName: 'Demo', modules: ['core_data', 'where_to_watch'] };
      state.role = role;
      await view();
      expect(screen.queryByTestId('live-chat')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByTestId('slot').innerHTML).toBe('');
    },
  );

  it.each(['admin', 'support'])(
    'sem o módulo, a equipe (%s) vê o aviso discreto apontando para Planos e módulos',
    async (role) => {
      state.access = { tenantName: 'Demo', modules: ['core_data'] };
      state.role = role;
      await view();
      expect(screen.queryByTestId('live-chat')).toBeNull();
      const notice = screen.getByRole('status');
      expect(notice.textContent).toContain(T.title);
      expect(notice.textContent).toContain('A chave da demo é da marca Demo');
      // nada do texto de integração do widget
      expect(notice.textContent).not.toContain('Esta chave não libera');
      // o botão do app (Base UI) sobre o link: `role="button"`, com o href
      expect(screen.getByRole('button', { name: T.action }).getAttribute('href')).toBe('/client/plans');
    },
  );

  it('sem resposta da API, nada aparece (nem para a equipe)', async () => {
    state.role = 'admin';
    await view();
    expect(screen.getByTestId('slot').innerHTML).toBe('');
  });
});
