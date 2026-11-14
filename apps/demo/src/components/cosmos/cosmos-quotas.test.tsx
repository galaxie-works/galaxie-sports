// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/cosmos/quota-actions', () => ({ saveCosmosQuotas: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CosmosQuotas, quotaTotal } from './cosmos-quotas';

afterEach(cleanup);
const T = clientDictionary('pt-BR').cosmos.quotas;

const data = (quotas: { scope: string; percent: number }[]) => ({
  quotas: quotas.map((q) => ({ ...q, credits: q.percent * 10, used: 0, remaining: q.percent * 10 })),
  totalPercent: quotas.reduce((n, q) => n + q.percent, 0),
  unassignedPercent: 0,
  cycleBase: 1000,
  scopes: ['chat', 'community', 'pool'],
});

const view = (d: ReturnType<typeof data>, canManage = true) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <CosmosQuotas data={d} canManage={canManage} />
    </I18nProvider>,
  );

describe('cotas por sala (#1116)', () => {
  it('soma só as % válidas', () => {
    expect(quotaTotal([{ percent: '10,5' }, { percent: 'x' }])).toBe(10.5);
  });

  it('avisa quando passa de 100% e mostra o que ficou sem destino', () => {
    view(
      data([
        { scope: 'chat', percent: 70 },
        { scope: 'pool', percent: 40 },
      ]),
    );
    expect(screen.getByText(T.overTitle)).toBeTruthy();
    cleanup();
    view(data([{ scope: 'chat', percent: 30 }]));
    expect(screen.queryByText(T.overTitle)).toBeNull();
    expect(screen.getByText('70% do saldo sem destino.')).toBeTruthy();
  });

  it('sem cosmos.manage não mostra salvar nem adicionar', () => {
    view(data([{ scope: 'chat', percent: 30 }]), false);
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
    expect(screen.queryByRole('button', { name: T.add })).toBeNull();
    expect(screen.getByText(T.readOnly)).toBeTruthy();
  });
});
