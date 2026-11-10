// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { Inbox } from '@/lib/notifications/store';

const loadInbox = vi.fn();
const markRead = vi.fn();
const answerNotice = vi.fn();
vi.mock('@/lib/notifications/actions', () => ({
  loadInbox: () => loadInbox(),
  markRead: (ids?: string[]) => markRead(ids),
  answerNotice: (id: string, text: string) => answerNotice(id, text),
}));

const { NotificationsAlert, NotificationsButton, NotificationsProvider } = await import('./notifications');

const T = clientDictionary('pt-BR');
const N = T.notifications;

const inbox = (over: Partial<Inbox> = {}): Inbox => ({
  unread: 1,
  items: [
    {
      id: '2',
      status: 'needsInfo',
      snippet: 'O placar ficou errado',
      body: 'Em qual tela?',
      createdAt: '2026-11-09T12:00:00.000Z',
      read: false,
      canAnswer: true,
      answered: false,
    },
    {
      id: '1',
      status: 'review',
      snippet: 'O placar ficou errado',
      body: null,
      createdAt: '2026-11-08T12:00:00.000Z',
      read: true,
      canAnswer: false,
      answered: false,
    },
  ],
  ...over,
});

async function show() {
  await act(async () => {
    render(
      <I18nProvider locale="pt-BR" messages={T}>
        <NotificationsProvider>
          <NotificationsButton />
          <NotificationsAlert />
        </NotificationsProvider>
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  loadInbox.mockReset();
  markRead.mockReset().mockResolvedValue(true);
  answerNotice.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('caixa de entrada', () => {
  it('sem sessão: nem sino nem faixa', async () => {
    loadInbox.mockResolvedValue(null);
    await show();
    expect(screen.queryByRole('button', { name: /Notificações/ })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('aviso novo: sino com contador e faixa com a resposta da equipe', async () => {
    loadInbox.mockResolvedValue(inbox());
    await show();
    expect(screen.getByRole('button', { name: 'Notificações (1 novas)' })).toBeTruthy();
    const alert = screen.getByRole('status');
    expect(alert.textContent).toContain(N.status.needsInfo);
    expect(alert.textContent).toContain('Em qual tela?');
  });

  it('o X dispensa a faixa sem marcar como lido', async () => {
    loadInbox.mockResolvedValue(inbox());
    await show();
    fireEvent.click(screen.getByRole('button', { name: N.alertDismiss }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notificações (1 novas)' })).toBeTruthy();
  });

  it('abrir a caixa marca como lido, some a faixa e mostra o campo de resposta', async () => {
    loadInbox.mockResolvedValue(inbox());
    await show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: N.alertOpen }));
    });
    // só o que está na lista: aviso mais antigo que os 30 carregados não é marcado
    expect(markRead).toHaveBeenCalledWith(['2']);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(N.title)).toBeTruthy();
    expect(screen.getByLabelText(N.answer)).toBeTruthy();
  });

  it('responder: manda o texto e troca o campo pela confirmação', async () => {
    loadInbox.mockResolvedValue(inbox());
    answerNotice.mockResolvedValue({ ok: true });
    await show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    });
    const field = screen.getByLabelText(N.answer);
    fireEvent.change(field, { target: { value: 'Na página do jogo, no celular.' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(answerNotice).toHaveBeenCalledWith('2', 'Na página do jogo, no celular.');
    expect(screen.queryByLabelText(N.answer)).toBeNull();
    expect(screen.getByText(N.answered)).toBeTruthy();
  });

  it('resposta curta demais nem sai do navegador', async () => {
    loadInbox.mockResolvedValue(inbox());
    await show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    });
    const field = screen.getByLabelText(N.answer);
    fireEvent.change(field, { target: { value: 'curta' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(answerNotice).not.toHaveBeenCalled();
    expect(screen.getByText('Escreva pelo menos 10 caracteres.')).toBeTruthy();
  });
});
