import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG, widgetKindIsAllSports } from './catalog.js';
import { DEFAULT_THEMES, WIDGET_CSS, type GsEvent, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures } from './fixtures.js';
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
    const urls = vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]));
    // os ao vivo vêm da rota própria (o teto do dia não os corta); o dia vem do /v1/events
    expect(urls.some((u) => /\/v1\/events\/live\?.*sport=football/.test(u))).toBe(true);
    expect(urls.find((u) => /\/v1\/events\?/.test(u))).toMatch(
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
    const urls = vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/v1\/events\/live\?locale=es-AR/);
  });

  it('ao vivo de todos os campeonatos antes dos encerrados, mesmo vindo depois no dia', async () => {
    const base = createPreviewFixtures(new Date()).events;
    const [live, , finished] = base as [GsEvent, GsEvent, GsEvent];
    const otherComp = { ...live.competition!, id: 'outra', name: 'Copa Outra' };
    const lateLive: GsEvent = {
      ...live,
      id: 'late-live',
      competition: otherComp,
      starts_at: '2099-01-01T00:00:00Z',
    };
    const body = (data: GsEvent[]) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/v1/events/live') ? body([live, lateLive]) : body([finished, live]),
    ) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    await screen.findByText('Copa Outra');
    const order = [...container.querySelectorAll('.gs-ticker-items:not([aria-hidden]) [data-gs-event]')].map(
      (el) => el.getAttribute('data-gs-event'),
    );
    expect(order).toEqual([live.id, 'late-live', finished.id]);
    // o campeonato do encerrado reaparece depois do ao vivo da outra copa
    expect(screen.getAllByText('Liga Exemplo')).toHaveLength(2);
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
    const { fetchImpl } = setup(<ScoreTicker mode="live" />);
    await screen.findByText('2 – 1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('modo padrão: o ao vivo a cada 20 s, o dia no ritmo calmo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<ScoreTicker />);
    await screen.findByText('2 – 1');
    const count = (re: RegExp) => vi.mocked(fetchImpl).mock.calls.filter((c) => re.test(String(c[0]))).length;
    expect(count(/\/v1\/events\/live\?/)).toBe(1);
    expect(count(/\/v1\/events\?/)).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(count(/\/v1\/events\/live\?/)).toBe(2);
    expect(count(/\/v1\/events\?/)).toBe(1);
  });

  it('com uma consulta fora, mostra a outra; e tenta de novo a que falhou', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const preview = createPreviewFetch();
    let liveDown = true;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      liveDown && String(input).includes('/v1/events/live')
        ? new Response(JSON.stringify({ title: 'Too many requests', status: 429 }), { status: 429 })
        : preview(input, init),
    ) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    // o dia chegou: a faixa aparece mesmo com o ao vivo em 429
    await screen.findByText('2 – 1');
    expect(items(container)).toHaveLength(2);
    liveDown = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(
      vi.mocked(fetchImpl).mock.calls.filter((c) => String(c[0]).includes('/v1/events/live')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('jogo que saiu do ao vivo não volta com a cópia velha do dia', async () => {
    const [live, , finished] = createPreviewFixtures(new Date()).events as [GsEvent, GsEvent, GsEvent];
    const body = (data: GsEvent[]) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    // a rota ao vivo já não traz o jogo; o dia ainda o tem como "ao vivo"
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/v1/events/live') ? body([]) : body([live, finished]),
    ) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    await screen.findByText('0 – 0');
    expect(items(container)).toHaveLength(1);
    expect(screen.queryByText('2 – 1')).toBeNull();
  });

  it('jogo em "começando" no dia fica na faixa (a rota ao vivo só o traz depois do apito inicial)', async () => {
    const [live, upcoming] = createPreviewFixtures(new Date()).events as [GsEvent, GsEvent];
    const starting: GsEvent = { ...upcoming, status: 'starting' };
    const body = (data: GsEvent[]) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/v1/events/live') ? body([live]) : body([live, starting]),
    ) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    await screen.findByText('2 – 1');
    expect(container.querySelector(`[data-gs-event="${starting.id}"]`)).toBeTruthy();
  });

  it('apito final: o jogo some do ao vivo, o dia é buscado de novo até trazer o encerrado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const [live] = createPreviewFixtures(new Date()).events as [GsEvent];
    const ended: GsEvent = { ...live, status: 'finished', clock: null, score: { ...live.score, home: 3 } };
    const body = (data: GsEvent[]) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    let phase: 'live' | 'whistle' | 'fresh' = 'live';
    let dayCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/events/live')) return body(phase === 'live' ? [live] : []);
      dayCalls += 1;
      // o cache do dia ainda serve a cópia "ao vivo" logo depois do apito
      return body([phase === 'fresh' ? ended : live]);
    }) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    await screen.findByText('2 – 1');
    phase = 'whistle';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // a cópia velha do dia não aparece (nada de minuto ou placar voltando)
    expect(screen.queryByText('2 – 1')).toBeNull();
    expect(screen.queryByText("67'")).toBeNull();
    const before = dayCalls;
    phase = 'fresh';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(dayCalls).toBeGreaterThan(before);
    expect(await screen.findByText('3 – 1')).toBeTruthy();
    expect(items(container)[0]).toMatch(/Encerrado/);
  });

  it('dia em erro com o ao vivo ok: a faixa mostra o ao vivo', async () => {
    const preview = createPreviewFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      /\/v1\/events\?/.test(String(input))
        ? new Response(JSON.stringify({ title: 'Erro', status: 503 }), { status: 503 })
        : preview(input, init),
    ) as unknown as typeof fetch;
    const { container } = setup(<ScoreTicker />, { fetchImpl });
    await screen.findByText('2 – 1');
    expect(items(container)).toHaveLength(1);
  });

  it('erro que não passa sozinho (chave inválida) não fica tentando de novo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ title: 'Chave inválida', status: 401 }), { status: 401 }),
    ) as unknown as typeof fetch;
    setup(<ScoreTicker mode="live" />, { fetchImpl });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const first = vi.mocked(fetchImpl).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(first);
  });

  it('rolando, a faixa entra no Tab e para com o foco do teclado, como com o mouse', async () => {
    // jsdom não mede: a lista "não cabe" na largura e a faixa passa a rolar
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2000);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      const { container } = setup(<ScoreTicker />);
      await vi.waitFor(() => expect(container.querySelector('[data-running]')).toBeTruthy());
      const viewport = container.querySelector<HTMLElement>('.gs-ticker-viewport')!;
      expect(viewport.tabIndex).toBe(0);
      viewport.focus();
      expect(document.activeElement).toBe(viewport);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
    expect(WIDGET_CSS).toContain(
      '.gs-ticker-viewport:hover .gs-ticker-track,.gs-ticker-viewport:focus-within .gs-ticker-track{animation-play-state:paused}',
    );
  });

  it('cabendo na largura, a faixa não rola e não entra no Tab', async () => {
    const { container } = setup(<ScoreTicker />);
    await vi.waitFor(() => expect(container.querySelector('.gs-ticker-item')).toBeTruthy());
    expect(container.querySelector('[data-running]')).toBeNull();
    expect(container.querySelector('.gs-ticker-viewport')!.hasAttribute('tabindex')).toBe(false);
  });

  it('letra proporcional à largura, parada com "reduzir movimento" e emenda sem salto', () => {
    // fallback sem var(): navegador de TV sem cqw/clamp fica com 22px (e não com a letra herdada)
    expect(WIDGET_CSS).toMatch(/\.gs-ticker\{[^}]*font-size:22px;/);
    expect(WIDGET_CSS).toContain(
      '@supports (font-size:clamp(16px,2cqw,44px)){.gs-ticker{font-size:calc(var(--gs-scale,1)*clamp(16px,2cqw,44px))}}',
    );
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
        limit: 0,
        extra: 1,
      }),
    ).toEqual({ mode: 'live', transparent: true, limit: 1 });
    expect(parseWidgetOptions('score_ticker', { limit: 500 })).toEqual({ limit: 100 });
    expect(optionProps('score_ticker', { speed: 'fast' })).toEqual({ speed: 'fast' });
  });
});
