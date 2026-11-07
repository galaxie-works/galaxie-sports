import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsEventOdds, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { MatchOdds, mainLine } from './widgets/match-odds.js';

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

const odds = (container: HTMLElement, market: string) =>
  [...container.querySelectorAll(`[data-gs-market="${market}"] [data-gs-selection]`)].map((el) => ({
    sel: el.getAttribute('data-gs-selection'),
    text: el.textContent,
  }));

describe('odds do jogo', () => {
  it('consenso por mercado com média e maior odd, número de casas e aviso de jogo responsável', async () => {
    const calls: string[] = [];
    const { container } = setup(<MatchOdds eventId={PREVIEW_IDS.scheduledEvent} />, 'pt-BR', calls);
    expect(await screen.findByText('Odds do jogo')).toBeTruthy();
    await screen.findByText('Resultado final');
    expect(odds(container, 'match_winner')).toEqual([
      { sel: 'home', text: 'Mandante1,92Maior 2,00' },
      { sel: 'draw', text: 'Empate3,35Maior 3,50' },
      { sel: 'away', text: 'Visitante4,10Maior 4,40' },
    ]);
    // a linha principal do total de gols (a de mais casas), não as duas
    expect(odds(container, 'goals_over_under').map((o) => o.text)).toEqual([
      'Mais de 2,52,05Maior 2,12',
      'Menos de 2,51,76Maior 1,80',
    ]);
    expect(container.querySelector('[data-gs-updated]')!.textContent).toContain('Média de 8 casas');
    expect(container.querySelector('[data-gs-notice]')!.textContent).toBe(
      '18+ · Aposte com responsabilidade.',
    );
    expect(calls[0]).toContain(`/v1/events/${PREVIEW_IDS.scheduledEvent}/odds`);
  });

  it('em espanhol, só o resultado, sem a maior odd nem o aviso', async () => {
    const { container } = setup(
      <MatchOdds
        eventId={PREVIEW_IDS.scheduledEvent}
        showDoubleChance={false}
        showGoals={false}
        showBothTeamsScore={false}
        showBest={false}
        showNotice={false}
      />,
      'es',
    );
    expect(await screen.findByText('Cuotas del partido')).toBeTruthy();
    await screen.findByText('Resultado final');
    expect(container.querySelectorAll('[data-gs-market]')).toHaveLength(1);
    expect(odds(container, 'match_winner')[0]!.text).toBe('Local1,92');
    expect(container.querySelector('[data-gs-notice]')).toBeNull();
  });

  it('sem odds: estado vazio, e o aviso continua', async () => {
    const empty: GsEventOdds = {
      event_id: 'x',
      sport: 'football',
      home: null,
      away: null,
      markets: [],
      bookmakers: 0,
      updated_at: null,
    };
    const { container } = setup(<MatchOdds eventId="x" />, 'en', [], (u) =>
      u.includes('/odds') ? empty : undefined,
    );
    expect(await screen.findByText('Odds not available for this match yet.')).toBeTruthy();
    expect(container.querySelector('[data-gs-updated]')).toBeNull();
    expect(container.querySelector('[data-gs-notice]')!.textContent).toContain('gamble responsibly');
  });

  it('linha principal: mais casas e, no empate, a mais perto de 2,5', () => {
    const s = (line: number, bookmakers: number) => ({ key: 'over', line, average: 2, best: 2, bookmakers });
    expect(mainLine([s(1.5, 3), s(3.5, 5)])).toBe(3.5);
    expect(mainLine([s(1.5, 4), s(2.5, 4), s(3.5, 4)])).toBe(2.5);
    expect(mainLine([])).toBeNull();
  });

  it('opções: o aviso vem ligado e o padrão não é salvo', () => {
    expect(parseWidgetOptions('match_odds', { showNotice: true, showBest: false })).toEqual({
      showBest: false,
    });
    expect(optionProps('match_odds', { showNotice: false })).toEqual({ showNotice: false });
  });

  it('catálogo: só futebol, com o jogo obrigatório', () => {
    const entry = WIDGET_CATALOG.match_odds;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['eventId']);
    expect(entry.registryComponent).toBe('GalaxieMatchOdds');
  });
});
