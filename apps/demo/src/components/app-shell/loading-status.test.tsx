// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';

import { LoadingAnnouncer, LoadingStatus } from './loading-status';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (locale: Locale, node: React.ReactElement) => (
  <I18nProvider locale={locale} messages={clientDictionary(locale)}>
    {node}
  </I18nProvider>
);

const EXPECTED: Record<Locale, string> = { 'pt-BR': 'Carregando…', en: 'Loading…', 'es-AR': 'Cargando…' };

describe('LoadingStatus', () => {
  it.each(LOCALES)('%s: o aviso entra na região viva depois de montada, no idioma da página', (locale) => {
    render(wrap(locale, <LoadingStatus>blocos</LoadingStatus>));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    act(() => vi.advanceTimersByTime(150));
    expect(status.textContent).toBe(EXPECTED[locale]);
  });

  it('LoadingAnnouncer inativo fica vazio, e liga e desliga sem trocar a região', () => {
    const { rerender } = render(wrap('pt-BR', <LoadingAnnouncer active={false} />));
    act(() => vi.advanceTimersByTime(150));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    rerender(wrap('pt-BR', <LoadingAnnouncer active />));
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Carregando…');
    rerender(wrap('pt-BR', <LoadingAnnouncer active={false} />));
    expect(status.textContent).toBe('');
  });
});
