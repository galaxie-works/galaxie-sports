import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/build-registry-item.js';
import { ChampionsGallery } from './widgets/champions-gallery.js';

afterEach(cleanup);

function setup(
  ui: ReactNode,
  locale: WidgetLocale = 'pt-BR',
  fetchImpl: typeof fetch = createPreviewFetch(),
) {
  return render(
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
}

const editions = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-gs-champions] li')].map((li) => li.getAttribute('data-gs-season'));

describe('Galeria de campeões (#831)', () => {
  it('lista as edições da mais recente para trás até o limite, com o ranking de títulos', async () => {
    const { container } = setup(<ChampionsGallery competitionId={PREVIEW_IDS.competition} limit={5} />);
    expect(await screen.findByText('Liga Exemplo')).toBeTruthy();
    expect(editions(container)).toEqual(['2025', '2024', '2023', '2022', '2021']);
    expect(screen.getByText('Mais títulos')).toBeTruthy();
    const rows = container.querySelectorAll('[data-gs-champions-ranking] tr');
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toBe('1Clube Aurora5 títulos');
    expect(screen.getByText('Últimas 5 de 12 edições')).toBeTruthy();
    // o vice fica desligado por padrão (e nem é pedido à API)
    expect(container.querySelector('[data-gs-runner-up]')).toBeNull();
  });

  it('com o vice ligado, pede runner_up à API e mostra o vice de cada edição', async () => {
    const urls: string[] = [];
    const preview = createPreviewFetch();
    const spy: typeof fetch = (input, init) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return preview(input, init);
    };
    const { container } = setup(
      <ChampionsGallery competitionId={PREVIEW_IDS.competition} limit={2} showRunnerUp showRanking={false} />,
      'pt-BR',
      spy,
    );
    expect(await screen.findByText('Vice: Estrela do Sul')).toBeTruthy();
    expect(container.querySelectorAll('[data-gs-runner-up]')).toHaveLength(2);
    // troféu dourado em cada campeão e prateado em cada vice
    expect(container.querySelectorAll('[data-gs-runner-up] [data-gs-trophy="silver"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-gs-champion] [data-gs-trophy="gold"]').length).toBeGreaterThan(
      0,
    );
    expect(container.querySelector('[data-gs-champions-ranking]')).toBeNull();
    expect(urls.some((u) => u.includes('/champions') && u.includes('runner_up=true'))).toBe(true);
  });

  it('textos em espanhol e inglês', async () => {
    setup(<ChampionsGallery competitionId={PREVIEW_IDS.competition} showRunnerUp />, 'es');
    expect(await screen.findByText('Más títulos')).toBeTruthy();
    expect(screen.getByText('Galería de campeones')).toBeTruthy();
    cleanup();
    setup(<ChampionsGallery competitionId={PREVIEW_IDS.competition} rankingLimit={1} />, 'en');
    expect(await screen.findByText('Most titles')).toBeTruthy();
    expect(screen.getByText('5 titles')).toBeTruthy();
  });

  it('sem lista de campeões: mensagem de vazio; ranking incompleto não aparece', async () => {
    const empty: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          competition: { id: 'x', slug: 'x', sport: 'football', name: 'Copa Nova', logo: null },
          editions: [],
          total_editions: 0,
          ranking: [],
          ranking_complete: false,
          coverage: null,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    setup(<ChampionsGallery competitionId="copa-nova" />, 'pt-BR', empty);
    expect(await screen.findByText('Ainda não temos a lista de campeões desta competição.')).toBeTruthy();
    expect(screen.queryByText('Mais títulos')).toBeNull();
  });

  it('catálogo, opções e registry: competição obrigatória, opções conferidas e a competição gravada', () => {
    const entry = WIDGET_CATALOG.champions_gallery;
    expect(entry.requiredProps).toEqual(['competitionId']);
    expect(entry.sports).toContain('football');
    expect(
      parseWidgetOptions('champions_gallery', { limit: 500, showRunnerUp: true, showRanking: true }),
    ).toEqual({
      limit: 200,
      showRunnerUp: true,
    });
    const item = buildRegistryItem({
      kind: 'champions_gallery',
      name: 'Campeões da Liga',
      theme: DEFAULT_THEMES.dark,
      apiBaseUrl: 'https://api.exemplo.test',
      locale: 'pt-BR',
      market: 'BR',
      defaults: { competitionId: 'liga-exemplo' },
      options: { showRunnerUp: true },
    });
    const file = item.files.map((f) => f.content).join('\n');
    expect(file).toContain('export function GalaxieChampionsGallery');
    expect(file).toMatch(/competitionId[^\n]*liga-exemplo/);
    expect(file).toMatch(/showRunnerUp[^\n]*true/);
  });
});
