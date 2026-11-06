import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsEventStats, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { MatchStats, matchStatRows } from './widgets/match-stats.js';

afterEach(cleanup);

function setup(ui: ReactNode, { locale = 'pt-BR', fetchImpl = vi.fn(createPreviewFetch()) } = {}) {
  const view = render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.light}
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

const team = (side: 'home' | 'away') => ({ team: { id: side, side } });
const stat = (code: string | null, value: number | string | null, type = code ?? '?') => ({
  code,
  value,
  type,
  label: type,
});
const stats = (home: ReturnType<typeof stat>[], away: ReturnType<typeof stat>[]): GsEventStats => ({
  event_id: 'e1',
  available: true,
  teams: [
    { ...team('home'), statistics: home },
    { ...team('away'), statistics: away },
  ],
});

describe('matchStatRows', () => {
  it('ordem padrão, destaque no maior e no menor onde menor é melhor, zero nas contagens sem valor', () => {
    const rows = matchStatRows(
      stats(
        [stat('fouls', 14), stat('possession_pct', '58%'), stat('red_cards', null)],
        [stat('fouls', 9), stat('possession_pct', '42%'), stat('red_cards', 1)],
      ),
    );
    expect(rows.map((r) => r.key)).toEqual(['possession_pct', 'fouls', 'red_cards']);
    expect(rows[0]).toMatchObject({ home: 58, away: 42, best: 'home', share: 0.58, percent: true });
    expect(rows[1]).toMatchObject({ best: 'away' }); // menos faltas
    expect(rows[2]).toMatchObject({ home: 0, away: 1, best: 'home' });
  });

  it('a escolha manda na ordem e no que aparece; limite corta; 0 = todas', () => {
    const data = stats(
      [stat('possession_pct', 50), stat('corners', 5), stat('fouls', 10), stat('shots_total', 7)],
      [stat('possession_pct', 50), stat('corners', 2), stat('fouls', 12), stat('shots_total', 9)],
    );
    expect(matchStatRows(data, { stats: 'corners,possession_pct' }).map((r) => r.key)).toEqual([
      'corners',
      'possession_pct',
    ]);
    expect(matchStatRows(data, { limit: 2 })).toHaveLength(2);
    expect(matchStatRows(data, { limit: 0 })).toHaveLength(4);
    expect(matchStatRows(data, { stats: 'possession_pct' })[0]).toMatchObject({ best: null });
  });

  it('outros esportes: estatísticas do fornecedor sem código entram depois, pelo nome cru', () => {
    const rows = matchStatRows(
      stats(
        [stat(null, 42, 'Rebounds'), stat(null, '48%', 'Field Goals %')],
        [stat(null, 38, 'Rebounds'), stat(null, '51%', 'Field Goals %')],
      ),
    );
    expect(rows.map((r) => r.label)).toEqual(['Rebounds', 'Field Goals %']);
    expect(rows[1]).toMatchObject({ home: 48, away: 51, percent: true, best: 'away' });
  });

  it('sem estatística (indisponível ou um time só): nenhuma linha', () => {
    expect(matchStatRows(null)).toEqual([]);
    expect(matchStatRows({ event_id: 'e', available: false, teams: [] })).toEqual([]);
  });
});

describe('MatchStats', () => {
  it('mostra as barras do jogo ao vivo com os rótulos no idioma', async () => {
    const { container, fetchImpl } = setup(<MatchStats eventId={PREVIEW_IDS.liveEvent} />);
    expect(await screen.findByText('Posse de bola')).toBeTruthy();
    expect(screen.getByText('Estatísticas do jogo')).toBeTruthy();
    expect(screen.getByText('54%')).toBeTruthy();
    expect(container.querySelectorAll('.gs-mstat')).toHaveLength(8); // padrão: 8 linhas
    expect(container.querySelectorAll('.gs-mstat .gs-bar')).toHaveLength(8);
    expect(container.querySelector('.gs-mstats-teams')?.textContent).toContain('Aurora');
    const paths = vi.mocked(fetchImpl).mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(paths).toContain(`/v1/events/${PREVIEW_IDS.liveEvent}/stats`);
  });

  it('respeita a escolha, a ordem e as opções de visual', async () => {
    const { container } = setup(
      <MatchStats
        eventId={PREVIEW_IDS.liveEvent}
        stats="corners,possession_pct"
        showBars={false}
        showTeams={false}
        highlightBest={false}
      />,
      { locale: 'en' },
    );
    await waitFor(() => expect(container.querySelectorAll('.gs-mstat')).toHaveLength(2));
    const labels = [...container.querySelectorAll('.gs-statrow > span:nth-child(2)')].map(
      (n) => n.textContent,
    );
    expect(labels).toEqual(['Corners', 'Ball possession']);
    expect(container.querySelector('.gs-bar')).toBeNull();
    expect(container.querySelector('.gs-mstats-teams')).toBeNull();
    expect(container.querySelector('[data-best]')).toBeNull();
  });

  it('jogo que não começou: aviso, sem buscar estatística', async () => {
    const { fetchImpl } = setup(<MatchStats eventId={PREVIEW_IDS.scheduledEvent} />, { locale: 'es' });
    expect(await screen.findByText('Las estadísticas aparecen cuando empiece el partido.')).toBeTruthy();
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(1);
  });

  it('sem estatística na API: estado vazio', async () => {
    const preview = createPreviewFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/stats')
        ? new Response(JSON.stringify({ event_id: 'x', available: false, teams: [], players: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        : preview(input, init),
    );
    setup(<MatchStats eventId={PREVIEW_IDS.liveEvent} />, { fetchImpl });
    expect(await screen.findByText('Sem estatísticas para este jogo.')).toBeTruthy();
  });
});

describe('opções do widget de estatísticas', () => {
  it('a escolha das estatísticas guarda a ordem do cliente e descarta códigos desconhecidos', () => {
    expect(parseWidgetOptions('match_stats', { stats: 'fouls,possession_pct,xyz,fouls' })).toEqual({
      stats: 'fouls,possession_pct',
    });
    expect(optionProps('match_stats', { limit: 0, showBars: false })).toEqual({ limit: 0, showBars: false });
    // outras listas continuam em ordem alfabética
    expect(parseWidgetOptions('related_videos', { types: 'goal,highlights,analysis' })).toEqual({
      types: 'analysis,goal,highlights',
    });
  });

  it('vale nos esportes coletivos e pede o jogo', () => {
    expect(WIDGET_CATALOG.match_stats.sports).toContain('football');
    expect(WIDGET_CATALOG.match_stats.sports).toContain('basketball');
    expect(WIDGET_CATALOG.match_stats.requiredProps).toEqual(['eventId']);
  });
});
