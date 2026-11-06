import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, textsFor, WIDGET_LOCALES } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { UpcomingDerbies } from './widgets/upcoming-derbies.js';

afterEach(cleanup);

function setup(ui: ReactNode, fetchImpl: typeof fetch = createPreviewFetch()) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale="pt-BR"
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const paths = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map(([input]) => new URL(String(input)).pathname);

describe('clássicos da semana', () => {
  it('lista os clássicos com nome, rivalidade, times, campeonato, retrospecto e onde assistir', async () => {
    const { container } = setup(<UpcomingDerbies />);
    expect(await screen.findByText('Clássicos da semana')).toBeTruthy();
    expect(await screen.findByText('Clássico da Serra')).toBeTruthy();
    const rows = container.querySelectorAll('[data-gs-derby]');
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.getAttribute('data-gs-event')).toBe(PREVIEW_IDS.scheduledEvent);
    expect(first.textContent).toContain('Estadual');
    expect(first.querySelector('[role=img][aria-label="Rivalidade 4 de 5"]')).toBeTruthy();
    expect(first.querySelectorAll('.gs-intensity [data-on]')).toHaveLength(4);
    expect(first.textContent).toContain('Atlético Serra');
    expect(first.textContent).toContain('União Litoral');
    expect(first.querySelector('[data-gs-meta=competition]')?.textContent).toBe('Liga Exemplo');
    // histórico geral curado do clássico, mandante à esquerda
    await waitFor(() => expect(first.querySelector('[data-gs-history]')).toBeTruthy());
    expect(first.querySelector('[data-gs-history]')?.textContent).toContain('Histórico geral: 214 jogos');
    expect(first.querySelector('[data-gs-history]')?.textContent).toContain('61 empates');
    await waitFor(() => expect(first.querySelector('[data-gs-watch]')).toBeTruthy());
    expect(first.querySelectorAll('[data-gs-watch] .gs-chip').length).toBeGreaterThan(0);
  });

  it('sem os dois times na resposta do confronto, o retrospecto não aparece', async () => {
    const { container } = setup(<UpcomingDerbies showWhereToWatch={false} />);
    expect(await screen.findByText('Clássico do Vale')).toBeTruthy();
    const second = container.querySelectorAll('[data-gs-derby]')[1]!;
    // o jogo fora da lista de exemplo fica com os nomes da própria rota
    expect(second.textContent).toContain('Real Planalto');
    await waitFor(() => expect(container.querySelector('[data-gs-derby] [data-gs-history]')).toBeTruthy());
    expect(second.querySelector('[data-gs-history]')).toBeNull();
  });

  it('país, dias e quantidade vão para a rota; histórico e onde assistir desligados não buscam nada', async () => {
    const preview = createPreviewFetch();
    const spy = vi.fn(preview);
    const { container } = setup(
      <UpcomingDerbies
        country="ar"
        days={10}
        limit={1}
        showHistory={false}
        showWhereToWatch={false}
        showCompetition={false}
      />,
      spy as unknown as typeof fetch,
    );
    expect(await screen.findByText('Clássicos dos próximos 10 dias')).toBeTruthy();
    expect(await screen.findByText('Clássico do Vale')).toBeTruthy();
    const list = spy.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((u) => u.pathname.endsWith('/v1/derbies/upcoming'))!;
    expect(list.searchParams.get('country')).toBe('AR');
    expect(list.searchParams.get('days')).toBe('10');
    expect(container.querySelectorAll('[data-gs-derby]')).toHaveLength(1);
    expect(container.querySelector('[data-gs-meta=competition]')).toBeNull();
    expect(paths(spy).some((p) => p.endsWith('/h2h') || p.endsWith('/where-to-watch'))).toBe(false);
  });

  it('janela sem clássicos: aviso com os dias', async () => {
    setup(<UpcomingDerbies country="IT" days={2} />);
    expect(await screen.findByText('Nenhum clássico nos próximos 2 dias.')).toBeTruthy();
  });

  it('catálogo, opções e textos nos três idiomas', () => {
    const entry = WIDGET_CATALOG.upcoming_derbies;
    expect(entry.requiredProps).toEqual([]);
    expect(entry.sports).toEqual(['football']);
    for (const locale of WIDGET_LOCALES) {
      expect(entry.name[locale]).toBeTruthy();
      const t = textsFor(locale).derbies;
      expect(t.title).toBeTruthy();
      expect(Object.keys(t.scopes)).toHaveLength(5);
    }
    expect(
      parseWidgetOptions('upcoming_derbies', {
        country: 'GB-ENG',
        limit: 50,
        days: 0,
        showHistory: false,
        showWhereToWatch: true,
      }),
    ).toEqual({ country: 'GB-ENG', limit: 20, days: 1, showHistory: false });
    expect(parseWidgetOptions('upcoming_derbies', { country: 'XX', days: 7 })).toBeUndefined();
  });
});
