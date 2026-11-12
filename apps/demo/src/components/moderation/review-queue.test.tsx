// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/cliente/moderacao',
  useSearchParams: () => new URLSearchParams(),
}));
const decide = vi.fn();
vi.mock('@/lib/moderation/queue-actions', () => ({
  decideCase: (...a: unknown[]) => decide(...a),
  moreDecisions: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReviewQueue, type QueueRow } from './review-queue';

afterEach(cleanup);
beforeEach(() => decide.mockReset().mockResolvedValue({ ok: true }));

const T = clientDictionary('pt-BR').moderation.queue;
const row = (patch: Partial<QueueRow> = {}): QueueRow => ({
  id: '0190f000-0000-7000-8000-000000000001',
  source: 'cosmos',
  targetType: 'message',
  module: 'chat',
  room: 'sala-1',
  community: null,
  reasons: ['hate'],
  severity: 75,
  reportCount: 0,
  hidden: true,
  content: 'texto do torcedor',
  author: 'Torcedor1',
  hasAuthor: true,
  createdAt: '2026-11-11T12:00:00Z',
  dueAt: null,
  suggestion: {
    by: 'cosmos',
    category: 'hate',
    severity: 3,
    actions: ['hide', 'mute'],
    steps: { hide: 'auto', mute: 'notify' },
    reason: 'ofensa racial',
    level: 2,
    credits: 0.4,
    fallback: null,
  },
  automatic: true,
  decisions: ['approve', 'remove', 'undo', 'mute'],
  ...patch,
});

const view = (items: QueueRow[]) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <ReviewQueue items={items} module={null} />
    </I18nProvider>,
  );

describe('fila de revisão', () => {
  it('mostra a sugestão da Cosmos com o degrau de cada ação, e o que o cargo pode decidir', () => {
    view([row()]);
    expect(screen.getByText('texto do torcedor')).toBeTruthy();
    expect(
      screen.getByText(/A Cosmos sugere: esconder: agiu sozinha, silenciar: agiu e avisou/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: T.decisions.undo })).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.decisions.ban })).toBeNull();
  });

  it('sem decisão permitida, avisa que o cargo só vê', () => {
    view([row({ decisions: [] })]);
    expect(screen.getByText(T.readOnly)).toBeTruthy();
  });

  it('desfazer pede confirmação e manda o motivo', async () => {
    view([row()]);
    fireEvent.click(screen.getByRole('button', { name: T.decisions.undo }));
    fireEvent.change(screen.getByLabelText(T.note), { target: { value: 'era ironia' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: T.confirm })));
    expect(decide).toHaveBeenCalledWith({
      caseId: '0190f000-0000-7000-8000-000000000001',
      decision: 'undo',
      note: 'era ironia',
    });
  });

  it('fila vazia explica o que aparece aqui', () => {
    view([]);
    expect(screen.getByText(T.empty)).toBeTruthy();
  });
});
