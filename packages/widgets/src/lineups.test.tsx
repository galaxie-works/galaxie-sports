import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { parseEmbedConfig } from './embed/element.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { WIDGET_OPTIONS, optionProps, parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/index.js';
import { Lineups, pitchRows, shortName } from './widgets/lineups.js';

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

const names = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((n) => n.textContent);

describe('Escalações', () => {
  it('campo: os 22 titulares, os dois times com a formação, reservas e técnico', async () => {
    const { container } = setup(<Lineups eventId={PREVIEW_IDS.liveEvent} />);
    await screen.findByText('Escalações');
    expect(container.querySelector('[data-gs-widget="lineups"]')).toBeTruthy();
    await screen.findByRole('group', { name: 'Escalação no campo: Clube Aurora x Estrela do Sul' });
    expect(container.querySelectorAll('.gs-lu-spot')).toHaveLength(22);
    expect(names(container, '.gs-lu-bar .gs-lu-formation')).toEqual(['4-3-3', '4-4-2']);
    // nome curto no campo: até dois nomes inteiros
    expect(names(container, '.gs-lu-name')).toContain('Vitor');
    expect(screen.getAllByText('Reservas')).toHaveLength(2);
    expect(screen.getByText('Paulo Azevedo')).toBeTruthy();
    expect(screen.getByText('Ricardo Gomes')).toBeTruthy();
    expect(screen.getAllByText('Técnico')).toHaveLength(2);
  });

  it('mandante em cima (goleiro no topo), visitante embaixo', async () => {
    const { container } = setup(<Lineups eventId={PREVIEW_IDS.liveEvent} />);
    await screen.findByRole('group');
    const top = (name: string) =>
      Number.parseFloat((container.querySelector(`.gs-lu-spot[title="${name}"]`) as HTMLElement).style.top);
    expect(top('Rafael Lima')).toBeLessThan(10);
    expect(top('Marcos Pereira')).toBeGreaterThan(90);
    expect(top('Matheus Reis')).toBeLessThan(50);
    expect(top('Wesley Barros')).toBeGreaterThan(50);
  });

  it('lista, um time só, sem reservas e sem técnico', async () => {
    const { container } = setup(
      <Lineups
        eventId={PREVIEW_IDS.liveEvent}
        view="list"
        team="away"
        showSubstitutes={false}
        showCoach={false}
      />,
    );
    await screen.findByText('Titulares');
    expect(container.querySelector('.gs-lu-pitch')).toBeNull();
    expect(container.querySelectorAll('.gs-lu-player')).toHaveLength(11);
    expect(screen.getByText('Estrela do Sul')).toBeTruthy();
    expect(screen.queryByText('Clube Aurora')).toBeNull();
    expect(screen.queryByText('Reservas')).toBeNull();
    expect(screen.queryByText('Técnico')).toBeNull();
    expect(names(container, '.gs-lu-pos').slice(0, 2)).toEqual(['GOL', 'DEF']);
  });

  it('campo com um time só: meio-campo, goleiro embaixo', async () => {
    const { container } = setup(
      <Lineups eventId={PREVIEW_IDS.liveEvent} team="home" showSubstitutes={false} />,
    );
    await screen.findByRole('group', { name: 'Escalação no campo: Clube Aurora' });
    expect(container.querySelector('.gs-lu-pitch[data-half]')).toBeTruthy();
    expect(container.querySelectorAll('.gs-lu-spot')).toHaveLength(11);
    const gk = container.querySelector('.gs-lu-spot[title="Rafael Lima"]') as HTMLElement;
    expect(Number.parseFloat(gk.style.top)).toBeGreaterThan(90);
  });

  it('sem posição no campo (grid), cai para a lista', async () => {
    const base = createPreviewFetch();
    const noGrid: typeof fetch = async (input, init) => {
      const res = await base(input, init);
      if (!String(input).includes('/lineups')) return res;
      const body = await res.json();
      for (const l of body.lineups) for (const p of l.start_xi) p.grid = null;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    const { container } = setup(<Lineups eventId={PREVIEW_IDS.liveEvent} />, 'pt-BR', noGrid);
    await screen.findAllByText('Titulares');
    expect(container.querySelector('.gs-lu-pitch')).toBeNull();
    expect(container.querySelectorAll('.gs-lu-player').length).toBeGreaterThanOrEqual(22);
  });

  it('antes do jogo: "escalação ainda não divulgada", com os times e o horário', async () => {
    setup(<Lineups eventId={PREVIEW_IDS.scheduledEvent} />);
    expect(await screen.findByText('Escalação ainda não divulgada.')).toBeTruthy();
    expect(await screen.findByText('Atlético Serra x União Litoral')).toBeTruthy();
  });

  it('um time divulgado: o visitante escolhido continua pendente, os dois mostram o que saiu', async () => {
    const base = createPreviewFetch();
    const onlyHome: typeof fetch = async (input, init) => {
      const res = await base(input, init);
      if (!String(input).includes('/lineups')) return res;
      const body = await res.json();
      body.lineups[1].start_xi = [];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    setup(<Lineups eventId={PREVIEW_IDS.liveEvent} team="away" />, 'pt-BR', onlyHome);
    expect(await screen.findByText('Escalação ainda não divulgada.')).toBeTruthy();
    expect(screen.queryByText('Rafael Lima')).toBeNull();
    cleanup();
    const { container } = setup(<Lineups eventId={PREVIEW_IDS.liveEvent} view="list" />, 'pt-BR', onlyHome);
    await screen.findByText('Titulares');
    expect(container.querySelectorAll('.gs-lu-team-head')).toHaveLength(1);
    expect(screen.getByText('Rafael Lima')).toBeTruthy();
  });

  it('só o visitante divulgado e "só o mandante": continua pendente, sem pegar o outro pela posição', async () => {
    const base = createPreviewFetch();
    const onlyAway: typeof fetch = async (input, init) => {
      const res = await base(input, init);
      if (!String(input).includes('/lineups')) return res;
      const body = await res.json();
      body.lineups = [body.lineups[1]];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    setup(<Lineups eventId={PREVIEW_IDS.liveEvent} team="home" />, 'pt-BR', onlyAway);
    expect(await screen.findByText('Escalação ainda não divulgada.')).toBeTruthy();
    expect(screen.queryByText('Marcos Pereira')).toBeNull();
  });

  it('textos em espanhol e inglês', async () => {
    setup(<Lineups eventId={PREVIEW_IDS.scheduledEvent} />, 'es');
    expect(await screen.findByText('Alineación aún no confirmada.')).toBeTruthy();
    cleanup();
    setup(<Lineups eventId={PREVIEW_IDS.liveEvent} view="list" />, 'en');
    expect(await screen.findByText('Lineups')).toBeTruthy();
    expect(screen.getAllByText('Starting XI')).toHaveLength(2);
    expect(screen.getAllByText('Head coach')).toHaveLength(2);
  });

  it('fileiras do campo pelo grid e nome curto', () => {
    const rows = pitchRows([
      { person: { id: null, name: 'B' }, number: 2, position: 'D', grid: '2:2' },
      { person: { id: null, name: 'A' }, number: 1, position: 'G', grid: '1:1' },
      { person: { id: null, name: 'C' }, number: 3, position: 'D', grid: '2:1' },
      { person: { id: null, name: 'X' }, number: 4, position: 'M', grid: null },
    ]);
    expect(rows.map((r) => r.map((p) => p.person.name))).toEqual([['A'], ['C', 'B']]);
    expect(shortName('Vinícius José Júnior')).toBe('Vinícius');
    expect(shortName('Bruno Costa')).toBe('Bruno Costa');
  });
});

describe('Escalações no Builder, no embed e no registry', () => {
  it('catálogo: só futebol, com o jogo obrigatório', () => {
    const entry = WIDGET_CATALOG.lineups;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['eventId']);
    expect(entry.name.es).toBe('Alineaciones');
  });

  it('opções: guarda só o que difere do padrão e vira props', () => {
    expect(WIDGET_OPTIONS.lineups.map((o) => o.key)).toEqual([
      'view',
      'team',
      'showSubstitutes',
      'showCoach',
    ]);
    const saved = parseWidgetOptions('lineups', {
      view: 'list',
      team: 'both',
      showCoach: false,
      showSubstitutes: true,
      team2: 'x',
    });
    expect(saved).toEqual({ view: 'list', showCoach: false });
    expect(parseWidgetOptions('lineups', { view: 'mosaico' })).toBeUndefined();
    expect(optionProps('lineups', saved)).toMatchObject({ view: 'list', showCoach: false });
  });

  it('embed aceita o tipo', () => {
    const config = parseEmbedConfig({
      id: 'w1',
      kind: 'lineups',
      theme: DEFAULT_THEMES.dark,
      locale: 'pt-BR',
      market: 'BR',
      apiBaseUrl: 'https://api.exemplo.test',
      defaults: { eventId: PREVIEW_IDS.liveEvent },
      options: { view: 'list' },
    });
    expect(config?.kind).toBe('lineups');
    expect(config?.options).toEqual({ view: 'list' });
  });

  it('registry: arquivo com o componente e o jogo salvo', () => {
    const item = buildRegistryItem({
      kind: 'lineups',
      name: 'Escalações do clássico',
      theme: DEFAULT_THEMES.light,
      apiBaseUrl: 'https://api.exemplo.test',
      defaults: { eventId: PREVIEW_IDS.liveEvent },
      options: { team: 'home' },
    });
    const widget = item.files.find((f) => f.content.includes('GalaxieLineups'));
    expect(widget?.content).toContain('export function Lineups(');
    expect(widget?.content).toContain(PREVIEW_IDS.liveEvent);
    expect(widget?.content).toContain('"home"');
  });
});
