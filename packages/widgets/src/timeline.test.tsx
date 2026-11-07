import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { WIDGET_OPTIONS, parseWidgetOptions } from './options.js';
import { MatchTimeline } from './widgets/match-timeline.js';

afterEach(cleanup);

function setup(
  ui: ReactNode,
  { locale = 'pt-BR', fetchImpl }: { locale?: WidgetLocale; fetchImpl?: typeof fetch } = {},
) {
  const f = vi.fn(fetchImpl ?? createPreviewFetch());
  const view = render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={f as unknown as typeof fetch}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
  return { ...view, fetchImpl: f };
}

const minutes = (root: Element) =>
  [...root.querySelectorAll('.gs-tl-item .gs-tl-min')].map((n) => n.textContent);

const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));

describe('Lance a lance', () => {
  it('no catálogo: tipo de um jogo, com polling, nos esportes coletivos', () => {
    const entry = WIDGET_CATALOG.match_timeline;
    expect(entry.requiredProps).toEqual(['eventId']);
    expect(entry.polling).toBe(true);
    expect(entry.sports).toContain('football');
    expect(entry.sports).toContain('basketball');
    expect(entry.sports).not.toContain('formula-1');
    expect(entry.name.es).toBe('Minuto a minuto');
  });

  it('mais recente primeiro: gols, cartão, substituição e VAR, com os marcos do jogo', async () => {
    const { container } = setup(<MatchTimeline eventId={PREVIEW_IDS.liveEvent} />);
    await screen.findByText('Lance a lance');
    await waitFor(() => expect(container.querySelectorAll('.gs-tl-item')).toHaveLength(6));
    expect(minutes(container)).toEqual(["61'", "57'", "46'", "38'", "23'", "12'"]);
    // marcos na ordem invertida também: 2º tempo antes do intervalo, o início no fim
    const markers = [...container.querySelectorAll('.gs-tl-marker')].map((n) => n.textContent);
    expect(markers).toEqual(['Segundo tempo', 'Intervalo', 'Início do jogo']);
    expect(container.querySelector('.gs-tl > :last-child')?.textContent).toBe('Início do jogo');
    expect(screen.getAllByText('Gol')).toHaveLength(3);
    expect(screen.getByText('Cartão amarelo')).toBeTruthy();
    expect(screen.getByText('VAR · Pênalti anulado')).toBeTruthy();
    expect(screen.getByText(/^Entra: .* 17$/)).toBeTruthy();
    expect(screen.getByText(/^Sai: .* 7$/)).toBeTruthy();
    expect(screen.getAllByText(/^Assistência: /)).toHaveLength(3);
    // placar depois de cada gol e o placar do jogo no topo
    expect(
      [...container.querySelectorAll('.gs-tl-item .gs-tl-score')].map((n) => n.textContent).filter(Boolean),
    ).toEqual(['2-1', '1-1', '1-0']);
    expect(await screen.findByText('2 – 1')).toBeTruthy();
  });

  it('cronológica, só gols e cartões, com limite e sem marcos nem assistência', async () => {
    const { container } = setup(
      <MatchTimeline
        eventId={PREVIEW_IDS.liveEvent}
        order="oldest"
        types="goals,cards"
        limit={3}
        showMarkers={false}
        showAssists={false}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('.gs-tl-item')).toHaveLength(3));
    expect(minutes(container)).toEqual(["12'", "23'", "38'"]);
    expect(container.querySelector('.gs-tl-marker')).toBeNull();
    expect(screen.queryByText(/^Assistência: /)).toBeNull();
    expect(screen.queryByText('Substituição')).toBeNull();
  });

  it('sem os times no topo, uma chamada só', async () => {
    const { fetchImpl } = setup(<MatchTimeline eventId={PREVIEW_IDS.liveEvent} showMatch={false} />);
    await screen.findAllByText('Gol');
    const paths = fetchImpl.mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(paths).toEqual([`/v1/events/${PREVIEW_IDS.liveEvent}/timeline`]);
  });

  it('antes do jogo e em esporte sem lances: estado vazio', async () => {
    setup(<MatchTimeline eventId={PREVIEW_IDS.scheduledEvent} showMatch={false} />);
    expect(await screen.findByText('Os lances aparecem aqui assim que o jogo começar.')).toBeTruthy();
    cleanup();
    const empty = () =>
      json({
        event_id: 'x',
        status: 'finished',
        live: false,
        clock: null,
        score: {},
        incidents: [],
        markers: [],
      });
    setup(<MatchTimeline eventId="x" showMatch={false} />, { fetchImpl: empty as unknown as typeof fetch });
    expect(await screen.findByText('Nenhum lance registrado neste jogo.')).toBeTruthy();
  });

  it('textos em espanhol e inglês', async () => {
    setup(<MatchTimeline eventId={PREVIEW_IDS.liveEvent} showMatch={false} />, { locale: 'es' });
    expect(await screen.findByText('Minuto a minuto')).toBeTruthy();
    expect(await screen.findByText('Tarjeta amarilla')).toBeTruthy();
    expect(screen.getByText('Cambio')).toBeTruthy();
    cleanup();
    setup(<MatchTimeline eventId={PREVIEW_IDS.liveEvent} showMatch={false} />, { locale: 'en' });
    expect(await screen.findByText('Play by play')).toBeTruthy();
    expect(await screen.findByText('Half-time')).toBeTruthy();
    expect(screen.getByText('Substitution')).toBeTruthy();
  });

  it('opções: padrão não é salvo; tipos conhecidos, em ordem', () => {
    expect(WIDGET_OPTIONS.match_timeline.map((o) => o.key)).toEqual([
      'order',
      'types',
      'limit',
      'showMarkers',
      'showAssists',
      'showMatch',
    ]);
    expect(
      parseWidgetOptions('match_timeline', { order: 'newest', limit: 0, showMarkers: true }),
    ).toBeUndefined();
    expect(
      parseWidgetOptions('match_timeline', { order: 'oldest', types: 'var,goals,xyz', limit: 500 }),
    ).toEqual({
      order: 'oldest',
      types: 'goals,var',
      limit: 100,
    });
  });
});
