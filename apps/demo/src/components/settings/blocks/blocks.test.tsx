// @vitest-environment happy-dom
import { POSTGAME_APIS, postgameIntervalKey, postgameModeKey, settingDef } from '@galaxie/runtime-config';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { OpsSetting } from '@/lib/ops/types';

const saveSetting = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/ajustes/operacao/actions', () => ({
  resetSetting: vi.fn(),
  checkAiCreditNow: vi.fn(),
  saveSetting: (key: string, value: string) => saveSetting(key, value),
}));

const { SettingRow } = await import('./setting-row');
const { StatusList } = await import('./status-list');
const { CredentialsList } = await import('./status-panels');
const { PostgameTable } = await import('./sport-tables');

const T = clientDictionary('pt-BR');
const B = T.ops.blocks;
const NOW = '2026-11-11T12:00:00.000Z';

const setting = (key: string, over: Partial<OpsSetting> = {}): OpsSetting => ({
  key,
  section: settingDef(key)!.section,
  value: settingDef(key)!.default,
  source: 'default',
  defaultValue: settingDef(key)!.default,
  envValue: null,
  override: null,
  overrideInvalid: false,
  updatedBy: null,
  updatedAt: null,
  configured: false,
  reportedAt: null,
  nextRuns: [],
  ...over,
});

const show = (node: ReactNode) =>
  render(
    <I18nProvider locale="pt-BR" messages={T}>
      {node}
    </I18nProvider>,
  );

beforeEach(() => saveSetting.mockClear());
afterEach(cleanup);

describe('SettingRow', () => {
  it('a linha tem a chave como id e mostra "alterado" quando o valor vem do painel', () => {
    const { container } = show(
      <SettingRow
        setting={setting('FEEDBACK_ENABLED', {
          source: 'db',
          value: 'off',
          updatedBy: 'ana',
          updatedAt: NOW,
        })}
        timeZone="UTC"
        now={NOW}
      />,
    );
    expect(container.querySelector('#FEEDBACK_ENABLED')).not.toBeNull();
    expect(screen.getByText(B.changed)).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('sem sobrescrita, sem selo', () => {
    show(
      <SettingRow
        setting={setting('FEEDBACK_ENABLED', { source: 'env', value: 'on' })}
        timeZone="UTC"
        now={NOW}
      />,
    );
    expect(screen.queryByText(B.changed)).toBeNull();
  });
});

describe('StatusList e Credenciais', () => {
  it('mostra só os 4 últimos caracteres da dica', () => {
    const { container } = show(
      <StatusList
        sections={[
          {
            id: 's',
            title: 'Seção',
            items: [
              { id: 'X', icon: 'X', name: 'Chave', tone: 'ok', statusLabel: 'ok', hint: 'segredo-abcd' },
            ],
          },
        ]}
      />,
    );
    expect(container.textContent).toContain('•••• abcd');
    expect(container.innerHTML).not.toContain('segredo');
  });

  it('configurada ou faltando, nas seções certas', () => {
    show(
      <CredentialsList
        settings={[
          setting('APISPORTS_KEY', { configured: true }),
          setting('GEMINI_API_KEY', { configured: false }),
          setting('SMTP_HOST', { configured: true }),
        ]}
      />,
    );
    expect(screen.getByText(B.status.groups.sports.title)).toBeTruthy();
    expect(screen.getByText(B.status.groups.ai.title)).toBeTruthy();
    expect(screen.getByText(B.status.groups.infra.title)).toBeTruthy();
    expect(screen.getAllByText(B.status.configured)).toHaveLength(2);
    expect(screen.getAllByText(B.status.missing)).toHaveLength(1);
  });
});

describe('PostgameTable', () => {
  const settings = POSTGAME_APIS.flatMap((api, i) => [
    setting(postgameModeKey(api), { value: i < 2 ? 'off' : 'fechamento' }),
    setting(postgameIntervalKey(api), { value: '15' }),
  ]);

  it('uma linha por esporte, sem a Fórmula 1', () => {
    const { container } = show(<PostgameTable settings={settings} />);
    expect(container.querySelectorAll('[data-sport]')).toHaveLength(11);
    expect(container.querySelector('[data-sport="formula-1"]')).toBeNull();
  });

  it('"Desligar todos" pede confirmação e grava off nas chaves ligadas, uma por vez', async () => {
    show(<PostgameTable settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: B.sports.turnAllOff }));
    expect(saveSetting).not.toHaveBeenCalled();
    expect(screen.getByText(B.sports.allOffTitle)).toBeTruthy();
    const confirm = screen.getAllByRole('button', { name: B.sports.turnAllOff }).at(-1)!;
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(saveSetting).toHaveBeenCalledTimes(9);
    expect(saveSetting.mock.calls.every(([, v]) => v === 'off')).toBe(true);
  });
});
