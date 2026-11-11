// @vitest-environment happy-dom
import { SETTINGS } from '@galaxie/runtime-config';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { SETTINGS_VIEWS, type SettingsView } from '@/lib/ops/panel-tabs';
import { settingPage } from '@/lib/ops/setting-page';
import type { LlmSpend, OpsSetting, OpsSnapshot } from '@/lib/ops/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/ajustes',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/ajustes/operacao/actions', () => ({
  saveSetting: vi.fn(),
  saveAiPolicy: vi.fn(),
  resetAiPolicy: vi.fn(),
  resetSetting: vi.fn(),
  saveFeedbackGithub: vi.fn(),
  clearFeedbackToken: vi.fn(),
  checkFeedbackProgressNow: vi.fn(),
  runJobNow: vi.fn(),
  checkAiCreditNow: vi.fn(),
}));

vi.mock('@/app/[locale]/(app)/ajustes/operacao/task-actions', () => ({
  approveTaskAction: vi.fn(),
  cancelTaskAction: vi.fn(),
  enqueueTask: vi.fn(),
  loadTask: vi.fn(),
  reprocessTaskAction: vi.fn(),
}));
vi.mock('@/components/reui/code-block/code-block', () => ({ CodeBlock: () => null }));

const { OpsPanel } = await import('./ops-panel');

afterEach(cleanup);

const NOW = '2026-11-11T12:00:00.000Z';

const llm: LlmSpend = {
  totals: {} as LlmSpend['totals'],
  byAgent: [],
  status: 'on',
  agentStatus: {},
  invalid: [],
  budget: null,
  usdBudget: 10,
  budgetDay: '2026-11-11',
  day: { timeZone: 'UTC', start: '00:00' },
  bandShares: { p0: 30, reserve: 10, p1: 30, clients: 10, rest: 10, manual: 10 },
  bands: [],
  p0MinAudience: 10,
  policyOverridden: false,
  agentUsdBudgets: {},
  agentUsdOrigins: {},
  agentDefaultUsdBudget: null,
  maxSearchesPerCall: null,
};

/** Retrato mínimo com todo ajuste do registro no padrão (as páginas só de linhas de ajuste não leem mais nada). */
const snapshot = {
  generatedAt: NOW,
  dayUtc: '2026-11-11',
  settings: SETTINGS.map((def): OpsSetting => ({
    key: def.key,
    section: def.section,
    value: null,
    source: 'default',
    defaultValue: null,
    envValue: null,
    override: null,
    overrideInvalid: false,
    updatedBy: null,
    updatedAt: null,
    configured: false,
    reportedAt: null,
    nextRuns: [],
  })),
  feedback: {
    tokenInPanel: false,
    tokenUnreadable: false,
    envTokenConfigured: false,
    kekConfigured: true,
    tokenChangedBy: null,
    tokenChangedAt: null,
    progress: null,
  },
  services: [],
  jobs: [],
  quota: [],
  llm,
  credit: null,
  creditPending: false,
  history: [],
  requests: [],
  quality: null,
  youtube: null,
  tasks: null,
} as unknown as OpsSnapshot;

/** Páginas feitas só de linhas de ajuste e cartões (as outras têm painéis de status com dados próprios). */
const SETTINGS_ONLY = new Set(['status', 'quality', 'schedule', 'tasks', 'mirror', 'history']);
const views = (Object.keys(SETTINGS_VIEWS) as SettingsView[]).filter((view) =>
  SETTINGS_VIEWS[view].every((block) => !SETTINGS_ONLY.has(block)),
);

function show(view: SettingsView) {
  const t = clientDictionary('pt-BR');
  return render(
    <I18nProvider locale="pt-BR" messages={t}>
      <OpsPanel snapshot={snapshot} timeZone="UTC" view={view} />
    </I18nProvider>,
  );
}

describe('âncora de cada ajuste na página dele (#1071)', () => {
  it.each(views)('todo ajuste da página %s tem um elemento com id igual à chave', (view) => {
    show(view);
    const keys = SETTINGS.map((d) => d.key).filter((key) => settingPage(key)?.item === view);
    const missing = keys.filter((key) => !document.getElementById(key));
    expect(missing).toEqual([]);
  });

  it('os ajustes editados nos cartões (Política de IA e GitHub das sugestões) têm âncora com scroll-mt', () => {
    show('ai');
    for (const key of ['AI_BAND_SHARES', 'AI_DAILY_USD_BUDGET', 'AI_P0_MIN_AUDIENCE']) {
      expect(document.getElementById(key)?.className, key).toContain('scroll-mt-20');
    }
    // o rótulo continua ligado ao controle
    expect(document.querySelector('label[for="ai-daily-usd"]')).toBeTruthy();
    expect(document.getElementById('ai-daily-usd')).toBeTruthy();
    cleanup();
    show('suggestions');
    for (const key of ['FEEDBACK_GITHUB_REPO', 'FEEDBACK_GITHUB_TOKEN']) {
      expect(document.getElementById(key)?.className, key).toContain('scroll-mt-20');
    }
    expect((document.getElementById('feedback-repo') as HTMLInputElement).tagName).toBe('INPUT');
  });
});
