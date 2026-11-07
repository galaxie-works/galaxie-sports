import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG, widgetKindSupportsSport } from './catalog.js';
import {
  DEFAULT_THEMES,
  WIDGET_CSS,
  countdownParts,
  watchRefreshMs,
  type WidgetLocale,
} from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/build-registry-item.js';
import { Countdown } from './widgets/countdown.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(ui: ReactNode, { locale = 'pt-BR', fetchImpl = vi.fn(createPreviewFetch()) } = {}) {
  const view = render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale as WidgetLocale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
  return { ...view, fetchImpl };
}

const units = (container: HTMLElement) =>
  [...container.querySelectorAll('.gs-countdown-unit')].map((u) => [
    u.getAttribute('data-unit'),
    u.querySelector('strong')?.textContent,
  ]);

const DAY = 86_400_000;

/** Fetch de prévia com campos trocados num evento (`/v1/events/:id`). */
function withPatchedEvent(base: typeof fetch, id: string, patch: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith(`/v1/events/${id}`)) return res;
    const body = (await res.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...body, ...patch }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('watchRefreshMs', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  it('5 min nas últimas 24 h; para depois do início', () => {
    expect(watchRefreshMs({ status: 'scheduled', starts_at: at(3 * 3_600_000) }, false, now)).toBe(300_000);
    expect(watchRefreshMs({ status: 'scheduled', starts_at: at(-60_000) }, false, now)).toBe(300_000);
    expect(watchRefreshMs({ status: 'live', starts_at: at(-60_000) }, false, now)).toBeNull();
  });
  it('jogo distante: acorda na janela de 24 h, no máximo a cada 6 h (1 h "a confirmar")', () => {
    expect(watchRefreshMs({ status: 'scheduled', starts_at: at(21 * DAY) }, false, now)).toBe(6 * 3_600_000);
    expect(watchRefreshMs({ status: 'scheduled', starts_at: at(21 * DAY) }, true, now)).toBe(3_600_000);
    const wake = watchRefreshMs(
      { id: 'abc', status: 'scheduled', starts_at: at(DAY + 30 * 60_000) },
      false,
      now,
    )!;
    expect(wake).toBeLessThanOrEqual(30 * 60_000);
    expect(wake).toBeGreaterThan(28 * 60_000 - 1);
  });
});

describe('countdownParts', () => {
  it('arredonda para cima: zera só na hora do jogo', () => {
    expect(countdownParts(1500)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 2 });
    expect(countdownParts(2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
    // sem segundos: 30 s ainda é 1 min; 59 min 30 s vira 1 h
    expect(countdownParts(30_000, false)).toEqual({ days: 0, hours: 0, minutes: 1, seconds: 0 });
    expect(countdownParts(59 * 60_000 + 30_000, false)).toEqual({
      days: 0,
      hours: 1,
      minutes: 0,
      seconds: 0,
    });
    expect(countdownParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('Countdown', () => {
  it('conta até o início, com escudos, campeonato e onde assistir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, fetchImpl } = setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />);
    await screen.findByText('Serra');
    expect(screen.getByText('Liga Exemplo')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Começa em' })).toBeTruthy();
    // jogo em 150 min: 02 h 30 min (00 s), sem a casa dos dias
    const first = units(container);
    expect(first.map(([u]) => u)).toEqual(['h', 'm', 's']);
    expect(first[0]![1]).toBe('02');
    // onde assistir: um chip por emissora
    const watch = await screen.findByText('Onde assistir');
    const chips = within(watch.parentElement!).getAllByRole('listitem');
    expect(chips.length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/where-to-watch?'))).toBe(true);
    // o relógio anda de segundo em segundo
    const before = units(container).at(-1)![1];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(units(container).at(-1)![1]).not.toBe(before);
  });

  it('sem segundos e sem onde assistir: não busca a rota de transmissão', async () => {
    const { container, fetchImpl } = setup(
      <Countdown eventId={PREVIEW_IDS.scheduledEvent} showSeconds={false} showWatch={false} />,
    );
    await screen.findByText('Serra');
    expect(units(container).map(([u]) => u)).toEqual(['h', 'm']);
    expect(screen.queryByText('Onde assistir')).toBeNull();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/where-to-watch'))).toBe(false);
  });

  it('jogo começou: vira o placar ao vivo', async () => {
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.liveEvent} />);
    await screen.findByText('Aurora');
    expect(container.querySelector('.gs-score')?.textContent).toContain('2 – 1');
    expect(container.querySelector('.gs-countdown')).toBeNull();
    expect(screen.queryByText('Onde assistir')).toBeNull();
  });

  it('jogo começou com "esconder": o widget some', async () => {
    const fetchImpl = vi.fn(createPreviewFetch());
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.liveEvent} onStart="hide" />, { fetchImpl });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('[data-gs-widget]')).toBeNull());
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('a hora chegou mas a API ainda diz agendado: "Vai começar"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // o jogo marcado para daqui a 3 s, e a API segue dizendo "agendado" depois disso
    const startsAt = new Date(Date.now() + 3000).toISOString();
    const preview = createPreviewFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await preview(input, init);
      if (!/\/v1\/events\/[^/?]+\?/.test(String(input))) return res;
      return new Response(JSON.stringify({ ...(await res.json()), starts_at: startsAt }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />, { fetchImpl });
    await screen.findByText('Serra');
    expect(units(container).at(-1)![1]).toBe('03');
    // um act por segundo: o React refaz o efeito (e agenda o próximo tique) ao fim de cada act
    for (let i = 0; i < 4; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    expect(container.querySelector('.gs-countdown-unit')).toBeNull();
    expect(screen.getByText('Vai começar')).toBeTruthy();
  });

  it('textos em espanhol e inglês', async () => {
    setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />, { locale: 'es' });
    expect(await screen.findByRole('timer', { name: 'Empieza en' })).toBeTruthy();
    expect(screen.getByText('horas')).toBeTruthy();
    cleanup();
    setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />, { locale: 'en' });
    expect(await screen.findByRole('timer', { name: 'Starts in' })).toBeTruthy();
    expect(screen.getByText('hrs')).toBeTruthy();
  });

  it('MMA encerrado: o método no meio, nunca "0 – 0"', async () => {
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.fightEvent} />);
    await vi.waitFor(() => expect(container.querySelector('[data-gs-fight]')).toBeTruthy());
    expect(container.querySelector('.gs-score')).toBeNull();
  });

  it('jogo a 21 dias: o onde assistir não é reconsultado em 5 minutos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startsAt = new Date(Date.now() + 21 * DAY).toISOString();
    const fetchImpl = vi.fn(
      withPatchedEvent(createPreviewFetch(), PREVIEW_IDS.scheduledEvent, { starts_at: startsAt }),
    );
    setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />, { fetchImpl });
    await screen.findByText('Onde assistir');
    const watchCalls = () =>
      fetchImpl.mock.calls.filter(([url]) => String(url).includes('/where-to-watch')).length;
    expect(watchCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    });
    expect(watchCalls()).toBe(1);
  });

  it('no máximo 4 canais na contagem', async () => {
    const base = createPreviewFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await base(input, init);
      if (!String(input).includes('/where-to-watch')) return res;
      const body = (await res.json()) as { options: Array<Record<string, unknown>> };
      const first = body.options[0]!;
      const options = Array.from({ length: 6 }, (_, i) => ({
        ...first,
        id: `opt-${i}`,
        provider: `Canal ${i + 1}`,
        provider_id: `canal_${i + 1}`,
        channel: null,
      }));
      return new Response(JSON.stringify({ ...body, options }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />, { fetchImpl });
    await screen.findByText('Onde assistir');
    const chips = container.querySelectorAll('[data-gs-countdown-watch] .gs-chip');
    expect(chips).toHaveLength(4);
    expect(screen.queryByText('Canal 5')).toBeNull();
  });

  it('onde assistir é reconsultado enquanto a contagem está na tela', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<Countdown eventId={PREVIEW_IDS.scheduledEvent} />);
    await screen.findByText('Onde assistir');
    const watchCalls = () =>
      fetchImpl.mock.calls.filter(([url]) => String(url).includes('/where-to-watch')).length;
    expect(watchCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    });
    expect(watchCalls()).toBe(2);
  });

  it('MMA: conta até a próxima luta', async () => {
    const { container } = setup(<Countdown eventId={PREVIEW_IDS.nextFightEvent} />);
    await vi.waitFor(() => expect(container.querySelector('.gs-countdown-unit[data-unit=d]')).toBeTruthy());
  });
});

describe('catálogo, opções e registry', () => {
  it('vale para os coletivos e o MMA, não para a F1', () => {
    expect(widgetKindSupportsSport('countdown', 'football')).toBe(true);
    expect(widgetKindSupportsSport('countdown', 'basketball')).toBe(true);
    expect(widgetKindSupportsSport('countdown', 'mma')).toBe(true);
    expect(widgetKindSupportsSport('countdown', 'formula-1')).toBe(false);
    expect(WIDGET_CATALOG.countdown.requiredProps).toEqual(['eventId']);
  });

  it('guarda só o que difere do padrão', () => {
    expect(parseWidgetOptions('countdown', { showWatch: true, showSeconds: true, onStart: 'score' })).toBe(
      undefined,
    );
    expect(parseWidgetOptions('countdown', { showSeconds: false, onStart: 'hide' })).toEqual({
      showSeconds: false,
      onStart: 'hide',
    });
    expect(optionProps('countdown', { onStart: 'explodir' })).toEqual({});
  });

  it('registry: componente com o evento e as opções gravadas', () => {
    const item = buildRegistryItem({
      kind: 'countdown',
      name: 'Contagem Clássico',
      theme: DEFAULT_THEMES.dark,
      locale: 'pt-BR',
      market: 'BR',
      defaults: { eventId: 'e1', teamId: 'ignorado' },
      options: { onStart: 'hide' },
      apiBaseUrl: 'https://api.galaxiesports.com',
    });
    const widget = item.files[1]!.content;
    expect(widget).toContain('export function GalaxieCountdown(');
    expect(widget).toContain(
      'const GALAXIE_DEFAULTS: Partial<CountdownProps> = {"onStart":"hide","eventId":"e1"};',
    );
  });
});
