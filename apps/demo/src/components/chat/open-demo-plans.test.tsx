// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const selectTenant = vi.hoisted(() => vi.fn(async (_id: string, _reason?: string) => ({ ok: true })));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/client/actions', () => ({ selectTenant }));

const { OpenDemoPlans } = await import('./open-demo-plans');

const LABEL = 'Abrir Planos e módulos';

const view = (tenant: { id: string; name: string; isGalaxie: boolean }, focused: boolean) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <OpenDemoPlans tenant={tenant} focused={focused} label={LABEL} />
    </I18nProvider>,
  );

beforeEach(() => {
  router.push.mockClear();
  selectTenant.mockClear();
});
afterEach(cleanup);

describe('OpenDemoPlans (#1389)', () => {
  it('tenant da chave já em foco: só o link para Planos e módulos', () => {
    view({ id: 't-demo', name: 'Demo', isGalaxie: true }, true);
    expect(screen.getByRole('button', { name: LABEL }).getAttribute('href')).toBe('/client/plans');
    expect(selectTenant).not.toHaveBeenCalled();
  });

  it('outra marca em foco, tenant da Galaxie: põe o tenant da chave em foco e só então abre', async () => {
    view({ id: 't-demo', name: 'Demo', isGalaxie: true }, false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: LABEL })));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/client/plans'));
    expect(selectTenant).toHaveBeenCalledWith('t-demo');
  });

  it('a troca falhou: não abre Planos e módulos', async () => {
    selectTenant.mockResolvedValueOnce({ ok: false });
    view({ id: 't-demo', name: 'Demo', isGalaxie: true }, false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: LABEL })));
    expect(selectTenant).toHaveBeenCalledWith('t-demo');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('marca de cliente: pede o motivo da equipe antes de trocar (nada muda só com o clique)', async () => {
    view({ id: 't-cliente', name: 'Cliente', isGalaxie: false }, false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: LABEL })));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(selectTenant).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
