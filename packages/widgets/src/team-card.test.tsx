import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsTeamCompetition, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { EMBED_TAG, defineGalaxieWidgetElement, type EmbedConfig } from './embed/element.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions, widgetOptionsFor } from './options.js';
import { TeamCard, pickCompetitions } from './widgets/team-card.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
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

const block = (container: HTMLElement, name: string) => container.querySelector(`[data-gs-block="${name}"]`);

describe('TeamCard', () => {
  it('escudo, forma recente, jogo ao vivo e campeonatos, numa chamada só ao overview', async () => {
    const { container, fetchImpl } = setup(<TeamCard teamId={PREVIEW_IDS.team} />);
    expect(await screen.findByRole('heading', { name: 'Clube Aurora' })).toBeTruthy();
    expect(screen.getByText('Brasil · Estádio Aurora')).toBeTruthy();
    // a forma lê do mais antigo ao último: derrota, empate e a vitória mais recente
    const form = [...block(container, 'form')!.querySelectorAll('.gs-result')];
    expect(form.map((n) => n.textContent)).toEqual(['D', 'E', 'V']);
    expect(form[2]!.getAttribute('title')).toBe('V · 3-1');
    // há jogo ao vivo: o bloco vira "Ao vivo", com o placar
    const next = block(container, 'next')!;
    expect(next.textContent).toContain('Ao vivo');
    expect(next.textContent).toContain('Estrela');
    expect(next.textContent).toContain('2 – 1');
    // campeonatos em ordem alfabética, com a situação de cada um
    const comps = [...block(container, 'competitions')!.querySelectorAll('li')].map((li) => li.textContent);
    expect(comps).toEqual([
      'CECopa ExemploNas quartas de final',
      'EEEstadual ExemploCampeão',
      expect.stringMatching(/^LELiga Exemplo\dº lugar$/),
    ]);
    const calls = vi.mocked(fetchImpl).mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(calls).toEqual([`/v1/teams/${PREVIEW_IDS.team}/overview`]);
  });

  it('opções: menos jogos na forma, sem próximo jogo e só um campeonato', async () => {
    const { container } = setup(
      <TeamCard teamId={PREVIEW_IDS.team} formCount={2} showNext={false} competitionsLimit={1} />,
    );
    await screen.findByRole('heading', { name: 'Clube Aurora' });
    expect([...block(container, 'form')!.querySelectorAll('.gs-result')].map((n) => n.textContent)).toEqual([
      'E',
      'V',
    ]);
    expect(block(container, 'next')).toBeNull();
    // o limite pega o primeiro da API (a liga, em disputa), não o primeiro do alfabeto
    expect(block(container, 'competitions')!.querySelectorAll('li')).toHaveLength(1);
    expect(block(container, 'competitions')!.textContent).toContain('Liga Exemplo');
  });

  it('esconde a forma e os campeonatos', async () => {
    const { container } = setup(
      <TeamCard teamId={PREVIEW_IDS.team} showForm={false} showCompetitions={false} />,
    );
    await screen.findByRole('heading', { name: 'Clube Aurora' });
    expect(block(container, 'form')).toBeNull();
    expect(block(container, 'competitions')).toBeNull();
    expect(block(container, 'next')).toBeTruthy();
  });

  it('sem jogo ao vivo, mostra o próximo com data e hora; sem nenhum, o aviso', async () => {
    const preview = createPreviewFetch();
    const withoutLive: typeof fetch = async (input, init) => {
      const res = await preview(input, init);
      const body = await res.json();
      return Response.json({ ...body, live_event: null });
    };
    const { container } = setup(<TeamCard teamId={PREVIEW_IDS.team} />, { fetchImpl: withoutLive });
    await screen.findByRole('heading', { name: 'Clube Aurora' });
    const next = block(container, 'next')!;
    expect(next.textContent).toContain('Próximo jogo');
    expect(next.textContent).toContain('Planalto');
    expect(next.querySelector('time')!.textContent).toMatch(/\d{2}:\d{2}/);
    cleanup();

    const none: typeof fetch = async (input, init) => {
      const body = await (await preview(input, init)).json();
      return Response.json({ ...body, live_event: null, next_event: null });
    };
    const empty = setup(<TeamCard teamId={PREVIEW_IDS.team} />, { fetchImpl: none });
    expect(await screen.findByText('Nenhum jogo marcado.')).toBeTruthy();
    expect(empty.container.querySelector('[data-gs-block="next"] li')).toBeNull();
  });

  it('com jogo ao vivo atualiza a cada 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<TeamCard teamId={PREVIEW_IDS.team} />);
    await screen.findByRole('heading', { name: 'Clube Aurora' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['en', 'Recent form', 'Live', 'Competitions', ['L', 'D', 'W'], 'Champion'],
    ['es', 'Forma reciente', 'En vivo', 'Competiciones', ['P', 'E', 'G'], 'Campeón'],
  ] as const)('%s', async (locale, form, live, comps, letters, champion) => {
    const { container } = setup(<TeamCard teamId={PREVIEW_IDS.team} />, { locale });
    expect(await screen.findByText(form)).toBeTruthy();
    expect(block(container, 'next')!.querySelector('.gs-group-title')!.textContent).toBe(live);
    expect(screen.getByText(comps)).toBeTruthy();
    expect(screen.getByText(champion)).toBeTruthy();
    expect([...block(container, 'form')!.querySelectorAll('.gs-result')].map((n) => n.textContent)).toEqual(
      letters,
    );
  });

  it('funciona nos outros esportes coletivos (placar do esporte no jogo ao vivo)', async () => {
    const { container } = setup(<TeamCard teamId={PREVIEW_IDS.team} />, {
      fetchImpl: vi.fn(createPreviewFetch({ sport: 'basketball' })),
    });
    await screen.findByRole('heading', { name: 'Clube Aurora' });
    expect(block(container, 'form')!.querySelectorAll('.gs-result')).toHaveLength(3);
    expect(block(container, 'next')!.querySelector('.gs-line-score')!.textContent).toMatch(/^\d+ – \d+$/);
  });

  it('sem teamId não chama a API', () => {
    const { fetchImpl } = setup(<TeamCard teamId="" />);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('pickCompetitions', () => {
  const c = (name: string): GsTeamCompetition => ({
    competition: { id: name, slug: name, name, logo: null },
    season: { year: 2026, label: '2026' },
    campaign: { status: 'league', label: {}, ongoing: true, rank: null },
  });
  it('limite na ordem da API, exibição em ordem alfabética sem acento nem caixa', () => {
    const list = [c('Paulista'), c('Copa do Brasil'), c('Brasileirão'), c('Libertadores')];
    expect(pickCompetitions(list, 3, 'pt-BR').map((x) => x.competition.name)).toEqual([
      'Brasileirão',
      'Copa do Brasil',
      'Paulista',
    ]);
    expect(pickCompetitions(list, 0, 'pt-BR')).toHaveLength(4);
    // não muda a lista recebida
    expect(list[0]!.competition.name).toBe('Paulista');
  });
});

describe('catálogo e opções do cartão do time', () => {
  it('vale para todos os esportes coletivos e exige o time', () => {
    expect(WIDGET_CATALOG.team_card.sports).toEqual(WIDGET_CATALOG.team_schedule.sports);
    expect(WIDGET_CATALOG.team_card.requiredProps).toEqual(['teamId']);
    expect(WIDGET_CATALOG.team_card.name).toEqual({
      'pt-BR': 'Cartão do time',
      es: 'Ficha del equipo',
      en: 'Team card',
    });
  });

  it('guarda só o que difere do padrão, com a forma entre 1 e 5', () => {
    expect(parseWidgetOptions('team_card', { showForm: true, formCount: 5, competitionsLimit: 4 })).toBe(
      undefined,
    );
    expect(
      parseWidgetOptions('team_card', { formCount: 9, showNext: false, competitionsLimit: '0' }),
    ).toEqual({ showNext: false, competitionsLimit: 0 });
    expect(parseWidgetOptions('team_card', { formCount: 0 })).toEqual({ formCount: 1 });
    expect(widgetOptionsFor('team_card', 'volleyball').map((o) => o.key)).toEqual([
      'showForm',
      'formCount',
      'showNext',
      'showCompetitions',
      'competitionsLimit',
    ]);
  });
});

describe('<galaxie-widget> com o cartão do time', () => {
  const ID = '01a16029-9283-77d0-b2e5-1d89336b2dc0';
  const preview = createPreviewFetch();
  const config: EmbedConfig = {
    id: ID,
    kind: 'team_card',
    version: 1,
    theme: DEFAULT_THEMES.light,
    locale: 'pt-BR',
    market: 'BR',
    defaults: { teamId: 'time-salvo-no-builder' },
    options: { showCompetitions: false },
    apiBaseUrl: 'https://api.exemplo.test',
  };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) =>
    String(input).includes('/e/') ? Response.json(config) : preview(input, init),
  );
  defineGalaxieWidgetElement({ origin: 'https://sports.exemplo.test', fetch: fetchMock });

  it('lê o time do atributo team-id e aplica as opções salvas', async () => {
    document.body.innerHTML = `<${EMBED_TAG} widget="${ID}" key="k" team-id="${PREVIEW_IDS.team}"></${EMBED_TAG}>`;
    const el = document.querySelector(EMBED_TAG)!;
    await waitFor(() => expect(el.shadowRoot?.textContent).toContain('Clube Aurora'));
    expect(el.shadowRoot!.querySelector('[data-gs-block="form"]')).toBeTruthy();
    expect(el.shadowRoot!.querySelector('[data-gs-block="competitions"]')).toBeNull();
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes(`/v1/teams/${PREVIEW_IDS.team}/overview`))).toBe(true);
    expect(calls.some((u) => u.includes('time-salvo-no-builder'))).toBe(false);
  });
});
