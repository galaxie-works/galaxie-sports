// @vitest-environment happy-dom
import {
  APISPORTS_APIS,
  POSTGAME_APIS,
  SCHEDULED_JOBS,
  planKey,
  postgameIntervalKey,
  postgameModeKey,
  scheduleKey,
  settingDef,
} from '@galaxie/runtime-config';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting, OpsSnapshot } from '@/lib/ops/types';

const saveSetting = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const resetSetting = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/ajustes/operacao/actions', () => ({
  resetSetting: (key: string) => resetSetting(key),
  checkAiCreditNow: vi.fn(),
  checkFeedbackProgressNow: vi.fn(),
  clearFeedbackToken: vi.fn(),
  saveFeedbackGithub: vi.fn(),
  saveSetting: (key: string, value: string) => saveSetting(key, value),
}));

const { SettingRow } = await import('./setting-row');
const { StatusList } = await import('./status-list');
const { CredentialsList } = await import('./status-panels');
const { PostgameTable, PlanTable } = await import('./sport-tables');
const { JobsGrid } = await import('./jobs-grid');
const { GithubIntegration } = await import('./integrations');

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

beforeEach(() => {
  saveSetting.mockClear();
  resetSetting.mockClear();
  push.mockClear();
});
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

  it('com rascunho sem salvar, "Desligar/Ligar todos" ficam desligados e dizem por quê', () => {
    show(<PostgameTable settings={settings} />);
    const off = screen.getByRole('button', { name: B.sports.turnAllOff }) as HTMLButtonElement;
    expect(off.disabled).toBe(false);
    const sport = T.ops.apis[POSTGAME_APIS[2]!]!;
    fireEvent.change(screen.getByLabelText(fill(B.sports.interval, { sport })), { target: { value: '20' } });
    expect(off.disabled).toBe(true);
    expect((screen.getByRole('button', { name: B.sports.turnAllOn }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(B.sports.bulkBlocked)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: B.undo }));
    expect(off.disabled).toBe(false);
  });

  it('menu ⋮ da linha: "Voltar ao padrão do .env" apaga só as chaves com sobrescrita; selo "inválido"', async () => {
    const api = POSTGAME_APIS[3]!;
    const sport = T.ops.apis[api]!;
    const withOverride = settings.map((s) =>
      s.key === postgameModeKey(api)
        ? { ...s, source: 'db' as const, value: 'live' }
        : s.key === postgameIntervalKey(api)
          ? { ...s, overrideInvalid: true, override: 'x' }
          : s,
    );
    const { container } = show(<PostgameTable settings={withOverride} />);
    const row = container.querySelector(`[data-sport="${api}"]`)!;
    expect(row.textContent).toContain(B.invalid);
    fireEvent.click(screen.getByRole('button', { name: fill(B.rowMenu, { name: sport }) }));
    fireEvent.click(await screen.findByText(B.resetToEnv));
    expect(resetSetting).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.ops.actions.confirm }));
    });
    expect(resetSetting.mock.calls.map(([k]) => k)).toEqual([postgameModeKey(api), postgameIntervalKey(api)]);
    expect(saveSetting).not.toHaveBeenCalled();
  });

  it('menu ⋮ da linha: "Ver no histórico" abre o histórico filtrado na chave da linha', async () => {
    const api = POSTGAME_APIS[0]!;
    show(<PostgameTable settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: fill(B.rowMenu, { name: T.ops.apis[api]! }) }));
    fireEvent.click(await screen.findByText(B.viewHistory));
    expect(push).toHaveBeenCalledWith(`/ajustes/historico?chave=${postgameModeKey(api)}`);
  });
});

describe('PlanTable', () => {
  it('cada esporte tem o menu ⋮; sem sobrescrita, "Voltar ao padrão do .env" fica desligado', async () => {
    const plans = APISPORTS_APIS.map((api) => setting(planKey(api), { value: '' }));
    show(<PlanTable settings={plans} inheritPlan="pro" />);
    const api = APISPORTS_APIS[0]!;
    fireEvent.click(screen.getByRole('button', { name: fill(B.rowMenu, { name: T.ops.apis[api]! }) }));
    const item = (await screen.findByText(B.resetToEnv)).closest('[role="menuitem"]')!;
    expect(item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled')).not.toBeNull();
  });
});

describe('GithubIntegration', () => {
  const snapshot = (value: string, connected: boolean) =>
    ({
      generatedAt: NOW,
      settings: [
        setting('FEEDBACK_ENABLED', { value, source: 'db', updatedBy: 'ana', updatedAt: NOW }),
        setting('FEEDBACK_GITHUB_REPO', { value: connected ? 'org/repo' : null }),
      ],
      feedback: {
        tokenInPanel: false,
        tokenUnreadable: false,
        envTokenConfigured: connected,
        kekConfigured: true,
        tokenChangedBy: null,
        tokenChangedAt: null,
        progress: null,
      },
    }) as unknown as OpsSnapshot;

  it('desconectado e desligado: a linha continua (âncora), travada e com o aviso', () => {
    const { container } = show(<GithubIntegration snapshot={snapshot('off', false)} timeZone="UTC" />);
    expect(container.querySelector('#FEEDBACK_ENABLED')).not.toBeNull();
    expect(screen.getByRole('switch').hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText(B.integrations.github.feedbackLocked)).toBeTruthy();
  });

  it('desconectado mas ligado: dá para desligar', () => {
    show(<GithubIntegration snapshot={snapshot('on', false)} timeZone="UTC" />);
    expect(screen.getByRole('switch').hasAttribute('data-disabled')).toBe(false);
    expect(screen.queryByText(B.integrations.github.feedbackLocked)).toBeNull();
  });

  it('conectado: sem trava', () => {
    show(<GithubIntegration snapshot={snapshot('off', true)} timeZone="UTC" />);
    expect(screen.getByRole('switch').hasAttribute('data-disabled')).toBe(false);
  });
});

describe('JobsGrid', () => {
  const rows = SCHEDULED_JOBS.map((j) => ({
    job: j.name,
    key: scheduleKey(j.name),
    label: j.name,
    setting: setting(scheduleKey(j.name)),
    status: {
      name: j.name,
      service: j.service,
      runNow: j.runNow,
      last: null,
      lastOkAt: null,
      errors24h: 0,
      queued: null,
    },
  }));
  const grid = () =>
    show(<JobsGrid rows={rows} timeZone="UTC" now={NOW} lastRun={() => null} runNow={() => null} />);

  it('todos os jobs, agrupados nas cinco áreas', () => {
    const { container } = grid();
    const areas = [...container.querySelectorAll('[data-job-area]')].map((e) =>
      e.getAttribute('data-job-area'),
    );
    expect(areas).toEqual(['live', 'data', 'ai', 'content', 'maintenance']);
    for (const j of SCHEDULED_JOBS) expect(screen.getAllByText(j.name).length).toBeGreaterThan(0);
  });

  it('a busca filtra as linhas e some com as áreas vazias', () => {
    const { container } = grid();
    fireEvent.change(screen.getByLabelText(B.jobs.searchLabel), { target: { value: 'wtw-rights' } });
    const areas = [...container.querySelectorAll('[data-job-area]')].map((e) =>
      e.getAttribute('data-job-area'),
    );
    expect(areas).toEqual(['ai']);
    fireEvent.change(screen.getByLabelText(B.jobs.searchLabel), { target: { value: 'nada-disso' } });
    expect(screen.getByText(B.jobs.empty)).toBeTruthy();
  });

  it('o hash abre o editor; fechar tira o hash, e o mesmo link abre de novo', async () => {
    const job = rows[0]!;
    const title = fill(B.jobs.editTitle, { name: job.label });
    window.history.replaceState(null, '', `/ajustes/agenda#${job.key}`);
    grid();
    expect(await screen.findByText(title)).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await vi.waitFor(() => expect(screen.queryByText(title)).toBeNull());
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/ajustes/agenda');
    await act(async () => {
      window.location.hash = job.key;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByText(title)).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });
});
