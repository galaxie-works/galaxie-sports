// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { CreditRequestView } from '@/lib/cosmos/credit-request-data';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const decide = vi.fn();
const ask = vi.fn();
vi.mock('@/lib/cosmos/credit-request-actions', () => ({
  requestCosmosCredits: (...a: unknown[]) => ask(...a),
  decideCosmosCreditRequest: (...a: unknown[]) => decide(...a),
  cancelCosmosCreditRequest: vi.fn(),
}));
vi.mock('@/lib/cosmos/actions', () => ({ startCosmosCheckout: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreditRequests } from './credit-requests';

afterEach(cleanup);
beforeEach(() => {
  decide.mockReset();
  ask.mockReset();
});

const T = clientDictionary('pt-BR').cosmos.creditRequests;
const req = (patch: Partial<CreditRequestView> = {}): CreditRequestView => ({
  id: '0190f000-0000-7000-8000-000000000001',
  status: 'open',
  reason: 'Clássico no domingo',
  requester: 'Ana',
  mine: false,
  decider: null,
  decisionNote: null,
  createdAt: '2026-11-11T12:00:00Z',
  decidedAt: null,
  ...patch,
});
const packages = [{ id: 'p1', name: 'Inicial', credits: 1000, priceCents: 5000, currency: 'BRL' }] as never;

const view = (requests: CreditRequestView[], canManage: boolean) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <CreditRequests requests={requests} canManage={canManage} packages={packages} />
    </I18nProvider>,
  );

describe('pedido de créditos ao dono (#996)', () => {
  it('quem não compra vê "Pedir ao dono"; com pedido aberto, vê o estado e pode cancelar', () => {
    view([], false);
    expect(screen.getByRole('button', { name: T.ask })).toBeTruthy();
    cleanup();
    view([req({ mine: true })], false);
    expect(screen.queryByRole('button', { name: T.ask })).toBeNull();
    expect(screen.getByText(T.status.open)).toBeTruthy();
    expect(screen.getByRole('button', { name: T.cancel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.approve })).toBeNull();
  });

  it('quem compra aprova (e a compra abre) ou recusa', async () => {
    decide.mockResolvedValue({ ok: true });
    view([req()], true);
    expect(screen.queryByRole('button', { name: T.ask })).toBeNull();
    await act(async () => screen.getByRole('button', { name: T.approve }).click());
    expect(decide).toHaveBeenCalledWith(req().id, 'approved');
  });

  it('pedido decidido mostra quem respondeu e a nota', () => {
    view(
      [
        req({
          status: 'declined',
          decider: 'Bia',
          decisionNote: 'Saldo dá para o mês',
          decidedAt: '2026-11-11T13:00:00Z',
          mine: true,
        }),
      ],
      false,
    );
    expect(screen.getByText(T.status.declined)).toBeTruthy();
    expect(screen.getByText(/Bia.*Saldo dá para o mês/)).toBeTruthy();
  });
});
