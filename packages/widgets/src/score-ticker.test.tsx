import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG, widgetKindIsAllSports } from './catalog.js';
import { DEFAULT_THEMES, WIDGET_CSS, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { WIDGET_OPTIONS, optionProps, parseWidgetOptions } from './options.js';
import { ScoreTicker } from './widgets/score-ticker.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(
  ui: ReactNode,
  {
    fetchImpl = vi.fn(createPreviewFetch()),
    locale = 'pt-BR',
  }: { fetchImpl?: typeof fetch; locale?: WidgetLocale } = {},
) {
  const view = render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
  return { ...view, fetchImpl };
}

const items = (container: HTMLElement) =>
  [...container.querySelectorAll('.gs-ticker-items:not([aria-hidden]) [data-gs-event]')].map((el) =>
    el.textContent?.replace(/\s+/g, ' ').trim(),
  );

describe('ScoreTicker (faixa de placares para TV)', () => {
  it('no catálogo vale para todos os esportes, com o componente do registry', () => {
    expect(WIDGET_CATALOG.score_ticker.registryComponent).toBe('GalaxieScoreTicker');
    expect(widgetKindIsAllSports('score_ticker')).toBe(true);
    expect(WIDGET_CATALOG.score_ticker.polling).toBe(true);
  });

  it('padrão: ao vivo e encerrados do dia, o ao vivo primeiro, pelo /v1/events do dia', async () => {
    const { container, fetchImpl } = setup(<ScoreTicker sport="football" />);
    await screen.findByText('2 – 1');
    expect(screen.getByText('Jogos do dia')).toBeTruthy();
    expect(screen.getByText('Liga Exemplo')).toBeTruthy();
    const rows = items(container);
    // o agendado fica de fora; o ao vivo vem antes do encerrado
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/67'.*2 – 1/);
    expect(rows[1]).toMatch(/Encerrado.*0 – 0/);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(
      /\/v1\/events\?.*sport=football&market=BR&date=\d{4}-\d{2}-\d{2}&status=starting%2Clive%2Cbreak%2Cfinished&limit=100/,
    );
    // o perdedor fica apagado
    expect(container.querySelectorAll('.gs-ticker-team[data-lost]')).toHaveLength(1);
  });

  it('só ao vivo usa /v1/events/live, com o rótulo e o ponto pulsando', async () => {
    const { container, fetchImpl } = setup(<ScoreTicker mode="live" />, { locale: 'es' });
    await screen.findByText('2 – 1');
    expect(screen.getByText('En vivo ahora')).toBeTruthy();
    expect(container.querySelector('.gs-ticker-label .gs-dot')).toBeTruthy();
    expect(items(container)).toHaveLength(1);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(/\/v1\/events\/live\?locale=es-AR/);
  });

  it('"todos do dia" inclui os próximos com o horário no lugar do placar', async () => {
    const { container } = setup(<ScoreTicker mode="all" />);
    await screen.findByText('2 – 1');
    const rows = items(container);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatch(/\d{2}:\d{2}.*×/);
  });

  it('nome curto por padrão, completo quando pedido; escudos e campeonato desligáveis', async () => {
    const short = setup(<ScoreTicker />);
    await screen.findByText('2 – 1');
    expect(screen.queryByText('Clube Aurora')).toBeNull();
    expect(short.container.querySelectorAll('.gs-ticker .gs-crest').length).toBeGreaterThan(0);
    short.unmount();

    const full = setup(<ScoreTicker teamName="full" showCrests={false} showCompetition={false} />);
    expect(await screen.findByText('Clube Aurora')).toBeTruthy();
    expect(full.container.querySelector('.gs-ticker .gs-crest')).toBeNull();
    expect(screen.queryByText('Liga Exemplo')).toBeNull();
  });

  it('com um campeonato só, não repete o nome dele na faixa', async () => {
    setup(<ScoreTicker competitionId={PREVIEW_IDS.competition} />);
    await screen.findByText('2 – 1');
    expect(screen.queryByText('Liga Exemplo')).toBeNull();
  });

  it('fundo transparente e rótulo desligado', async () => {
    const { container } = setup(<ScoreTicker transparent showLabel={false} />);
    await screen.findByText('2 – 1');
    expect(container.querySelector('.gs-ticker[data-transparent]')).toBeTruthy();
    expect(container.querySelector('.gs-ticker-label')).toBeNull();
  });

  it('sem jogos: mensagem de vazio no lugar da faixa', async () => {
    const empty = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    setup(<ScoreTicker mode="live" />, { fetchImpl: empty });
    expect(await screen.findByText('Nenhum jogo ao vivo agora.')).toBeTruthy();
  });

  it('atualiza a cada 20 s enquanto há jogo ao vivo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<ScoreTicker />);
    await screen.findByText('2 – 1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('letra proporcional à largura, parada com "reduzir movimento" e emenda sem salto', () => {
    expect(WIDGET_CSS).toContain('font-size:clamp(16px,2cqw,44px)');
    expect(WIDGET_CSS).toMatch(
      /prefers-reduced-motion:reduce\)\{\.gs-ticker-track\[data-running\]\{animation:none/,
    );
    expect(WIDGET_CSS).toContain('@keyframes gs-ticker{to{transform:translateX(-50%)}}');
  });

  it('opções: só valores conhecidos e diferentes do padrão', () => {
    expect(WIDGET_OPTIONS.score_ticker.map((o) => o.key)).toEqual([
      'mode',
      'speed',
      'transparent',
      'showLabel',
      'showCompetition',
      'showCrests',
      'teamName',
      'limit',
    ]);
    expect(
      parseWidgetOptions('score_ticker', {
        mode: 'live',
        speed: 'turbo',
        transparent: true,
        showLabel: true,
        limit: 500,
        extra: 1,
      }),
    ).toEqual({ mode: 'live', transparent: true, limit: 100 });
    expect(optionProps('score_ticker', { speed: 'fast' })).toEqual({ speed: 'fast' });
  });
});
