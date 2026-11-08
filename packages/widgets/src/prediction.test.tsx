import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsEventPredictions, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { MatchPrediction } from './widgets/match-prediction.js';

afterEach(cleanup);

function setup(
  ui: ReactNode,
  locale: WidgetLocale = 'pt-BR',
  calls: string[] = [],
  override?: (url: string) => unknown,
) {
  const preview = createPreviewFetch();
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={(input, init) => {
        calls.push(String(input));
        const body = override?.(String(input));
        return body ? Promise.resolve(Response.json(body)) : preview(input, init);
      }}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

describe('palpite do jogo', () => {
  it('chances, favorito, linhas de gols e comparação, com o texto montado no idioma', async () => {
    const calls: string[] = [];
    const { container } = setup(<MatchPrediction eventId={PREVIEW_IDS.scheduledEvent} />, 'pt-BR', calls);
    expect(await screen.findByText('Palpite do jogo')).toBeTruthy();
    await screen.findByText('Chances de cada resultado');
    const probs = container.querySelector('[data-gs-probabilities]')!;
    expect(probs.textContent).toContain('48%');
    expect(probs.textContent).toContain('Empate');
    expect(probs.textContent).toContain('22%');
    expect(container.querySelector('[data-gs-winner]')!.textContent).toMatch(/ vence ou empata$/);
    const goals = [...container.querySelectorAll('[data-gs-goals] li')].map((li) => li.textContent);
    expect(goals[0]).toBe('Menos de 3,5 gols');
    expect(goals[1]).toMatch(/: menos de 2,5 gols$/);
    expect(container.querySelectorAll('[data-gs-compare]')).toHaveLength(7);
    expect(container.querySelector('[data-gs-compare="total"]')!.textContent).toContain('57%');
    expect(container.querySelector('[data-gs-updated]')!.textContent).toContain('Palpite estatístico');
    expect(calls[0]).toContain(`/v1/events/${PREVIEW_IDS.scheduledEvent}/predictions`);
  });

  it('em inglês, sem comparação nem aviso', async () => {
    const { container } = setup(
      <MatchPrediction eventId={PREVIEW_IDS.scheduledEvent} showComparison={false} showNote={false} />,
      'en',
    );
    expect(await screen.findByText('Match prediction')).toBeTruthy();
    await screen.findByText('Under 3.5 goals');
    expect(container.querySelector('[data-gs-comparison]')).toBeNull();
    expect(container.textContent).not.toContain('Statistical prediction');
  });

  it('sem palpite ainda: estado vazio, sem rodapé', async () => {
    const empty: GsEventPredictions = {
      event_id: 'x',
      sport: 'football',
      home: { id: 'a', name: 'Clube A', short_name: null, logo: null },
      away: { id: 'b', name: 'Clube B', short_name: null, logo: null },
      prediction: null,
      updated_at: null,
    };
    const { container } = setup(<MatchPrediction eventId="x" />, 'es', [], (u) =>
      u.includes('/predictions') ? empty : undefined,
    );
    expect(await screen.findByText('Pronóstico aún no disponible para este partido.')).toBeTruthy();
    expect(container.querySelector('[data-gs-updated]')).toBeNull();
  });

  it('sem favorito e sem empate nas chances', async () => {
    const body: GsEventPredictions = {
      event_id: 'x',
      sport: 'football',
      home: { id: 'a', name: 'Clube A', short_name: 'CLA', logo: null },
      away: { id: 'b', name: 'Clube B', short_name: null, logo: null },
      prediction: {
        winner: null,
        probabilities: { home: 50, draw: null, away: 50 },
        goals: { total: { side: 'over', line: 2 }, home: null, away: null },
        comparison: [],
      },
      updated_at: '2026-11-07T08:00:00Z',
    };
    const { container } = setup(<MatchPrediction eventId="x" />, 'pt-BR', [], (u) =>
      u.includes('/predictions') ? body : undefined,
    );
    expect(await screen.findByText('Jogo sem favorito')).toBeTruthy();
    expect(
      container.querySelector('[data-gs-probabilities] .gs-prediction-odds[data-no-draws]'),
    ).toBeTruthy();
    expect(screen.getByText('Mais de 2 gols')).toBeTruthy();
    expect(container.querySelector('[data-gs-comparison]')).toBeNull();
  });

  it('opções: o padrão não é salvo', () => {
    expect(parseWidgetOptions('match_prediction', { showGoals: true, showComparison: false })).toEqual({
      showComparison: false,
    });
    expect(optionProps('match_prediction', { showNote: false })).toEqual({ showNote: false });
  });

  it('catálogo: só futebol, com o jogo obrigatório', () => {
    const entry = WIDGET_CATALOG.match_prediction;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['eventId']);
    expect(entry.registryComponent).toBe('GalaxieMatchPrediction');
  });
});
