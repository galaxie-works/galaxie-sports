// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

vi.mock('@/lib/feedback/actions', () => ({ sendFeedback: vi.fn() }));

const { FeedbackButton, FeedbackEnabledProvider } = await import('./feedback-button');

afterEach(cleanup);

const T = clientDictionary('pt-BR');

async function show(enabled: boolean) {
  await act(async () => {
    render(
      <I18nProvider locale="pt-BR" messages={T}>
        <TooltipProvider>
          <FeedbackEnabledProvider enabled={Promise.resolve(enabled)}>
            <FeedbackButton />
          </FeedbackEnabledProvider>
        </TooltipProvider>
      </I18nProvider>,
    );
  });
}

describe('FeedbackButton', () => {
  it('ligado: o botão aparece', async () => {
    await show(true);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('desligado no painel: o botão some', async () => {
    await show(false);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
