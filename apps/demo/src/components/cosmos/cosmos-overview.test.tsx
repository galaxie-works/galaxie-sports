// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { CosmosOverviewData } from '@/lib/cosmos/data';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/cosmos/actions', () => ({
  saveAutoRecharge: vi.fn(),
  enableCosmosAction: vi.fn(),
  disableCosmosAction: vi.fn(),
  startCosmosCheckout: vi.fn(),
  cosmosPurchaseStatus: vi.fn(),
}));

import { AutoRechargeOption } from './cosmos-overview';

afterEach(cleanup);

const T = clientDictionary('pt-BR').cosmos.autoRecharge;

// recarga automática já ligada: as travas (pacote, limite, aceite e Salvar) aparecem abertas
const data = {
  wallet: null,
  trial: { credits: 100, days: 14 },
  packages: [
    { id: 'p1', name: 'Inicial', credits: 1000, priceCents: 5000, currency: 'BRL' },
    { id: 'p2', name: 'Maior', credits: 5000, priceCents: 20000, currency: 'BRL' },
  ],
  autoRecharge: {
    enabled: true,
    packageId: 'p1',
    thresholdCredits: 100,
    hasCard: true,
    acceptedAt: '2026-11-01T12:00:00Z',
    lastFailureReason: null,
  },
  week: [],
} as unknown as CosmosOverviewData;

const view = (readOnly: boolean) => {
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <AutoRechargeOption data={data} readOnly={readOnly} />
    </I18nProvider>,
  );
  // abre o detalhe (engrenagem) onde ficam as travas
  act(() => screen.getByRole('button', { expanded: false }).click());
};

describe('recarga automática (#1019)', () => {
  it('quem gerencia mexe no pacote, no limite e no aceite e vê o Salvar', () => {
    view(false);
    expect(screen.getByRole('spinbutton', { name: T.threshold }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('checkbox', { name: T.consent }).getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByRole('button', { name: T.save })).toBeTruthy();
  });

  it('só leitura (cosmos.view sem cosmos.manage): campos travados e sem o Salvar', () => {
    view(true);
    expect(screen.getByRole('spinbutton', { name: T.threshold }).hasAttribute('disabled')).toBe(true);
    const consent = screen.getByRole('checkbox', { name: T.consent });
    expect(
      consent.hasAttribute('disabled') ||
        consent.getAttribute('aria-disabled') === 'true' ||
        consent.hasAttribute('data-disabled'),
    ).toBe(true);
    const select = screen.getByRole('combobox', { name: T.package });
    expect(
      select.hasAttribute('disabled') ||
        select.getAttribute('aria-disabled') === 'true' ||
        select.hasAttribute('data-disabled'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
    // o interruptor da recarga também fica travado
    expect(screen.getByRole('switch').hasAttribute('data-disabled')).toBe(true);
  });
});
