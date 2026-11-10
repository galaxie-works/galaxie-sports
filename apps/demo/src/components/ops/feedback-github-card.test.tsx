// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { FeedbackPanelState, OpsSetting, OpsSnapshot } from '@/lib/ops/types';

const saveFeedbackGithub = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/ajustes/operacao/actions', () => ({
  checkFeedbackProgressNow: vi.fn(),
  clearFeedbackToken: vi.fn(),
  resetSetting: vi.fn(),
  saveSetting: vi.fn(),
  saveFeedbackGithub: (input: unknown) => saveFeedbackGithub(input),
}));

const { FeedbackGithubCard } = await import('./feedback-github-card');

const T = clientDictionary('pt-BR');
const S = T.ops.suggestions;
const NOW = '2026-11-09T12:00:00.000Z';

function snapshot(feedback: Partial<FeedbackPanelState> = {}, repo: Partial<OpsSetting> = {}) {
  return {
    generatedAt: NOW,
    feedback: {
      tokenInPanel: false,
      tokenUnreadable: false,
      envTokenConfigured: false,
      kekConfigured: true,
      tokenChangedBy: null,
      tokenChangedAt: null,
      progress: null,
      ...feedback,
    },
    settings: [{ key: 'FEEDBACK_GITHUB_REPO', source: 'default', value: null, envValue: null, ...repo }],
  } as unknown as OpsSnapshot;
}

function show(s: OpsSnapshot) {
  render(
    <I18nProvider locale="pt-BR" messages={T}>
      <FeedbackGithubCard snapshot={s} timeZone="America/Sao_Paulo" />
    </I18nProvider>,
  );
}

const tokenInput = () => screen.getByLabelText(S.token) as HTMLInputElement;

beforeEach(() => saveFeedbackGithub.mockReset());
afterEach(cleanup);

describe('FeedbackGithubCard', () => {
  it.each([
    [{ tokenInPanel: true }, S.status.panel],
    [{ envTokenConfigured: true }, S.status.env],
    [{}, S.status.none],
    [{ tokenInPanel: true, tokenUnreadable: true }, S.status.unreadable],
  ])('mostra só o estado do token: %j', (state, label) => {
    show(snapshot(state));
    expect(screen.getByText(label)).toBeTruthy();
    expect(tokenInput().value).toBe('');
    expect(tokenInput().type).toBe('password');
  });

  it('sem a KEK o campo do token fica travado e explica o motivo', () => {
    show(snapshot({ kekConfigured: false }));
    expect(tokenInput().disabled).toBe(true);
    expect(screen.getByText(S.noKek, { exact: false })).toBeTruthy();
  });

  it('o token digitado some do campo depois de salvo', async () => {
    saveFeedbackGithub.mockResolvedValue({ ok: true });
    show(snapshot());
    fireEvent.change(screen.getByLabelText(S.repo), { target: { value: 'o/r' } });
    fireEvent.change(tokenInput(), { target: { value: 'github_pat_abcdefghijklmnop' } });
    await act(async () => {
      fireEvent.submit(tokenInput().closest('form')!);
    });
    expect(saveFeedbackGithub).toHaveBeenCalledWith({ repo: 'o/r', token: 'github_pat_abcdefghijklmnop' });
    expect(tokenInput().value).toBe('');
  });

  it('recusado pelo servidor: o token fica no campo para corrigir', async () => {
    saveFeedbackGithub.mockResolvedValue({ ok: false, error: 'x' });
    show(snapshot());
    fireEvent.change(tokenInput(), { target: { value: 'github_pat_abcdefghijklmnop' } });
    await act(async () => {
      fireEvent.submit(tokenInput().closest('form')!);
    });
    expect(tokenInput().value).toBe('github_pat_abcdefghijklmnop');
  });

  it('andamento: nunca conferido', () => {
    show(snapshot());
    expect(screen.getByText(S.progress.never)).toBeTruthy();
    expect(screen.getByRole('button', { name: S.progress.run })).toBeTruthy();
  });

  it('andamento: a última falha aparece no lugar da última conferência boa', () => {
    show(
      snapshot({
        progress: {
          okAt: '2026-11-08T12:00:00.000Z',
          finishedAt: '2026-11-09T11:00:00.000Z',
          error: 'graphql: x',
          issues: 0,
          notices: 0,
        },
      }),
    );
    expect(screen.getByText(/A última tentativa falhou/)).toBeTruthy();
  });

  it('andamento: conferência boa mostra lidas e avisos', () => {
    show(
      snapshot({
        progress: { okAt: NOW, finishedAt: NOW, error: null, issues: 3, notices: 1 },
      }),
    );
    expect(screen.getByText(/3 sugestões lidas, 1 avisos novos/)).toBeTruthy();
  });
});
